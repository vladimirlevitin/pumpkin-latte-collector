'use strict';
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {test}=require('node:test');
const path=require('node:path');
const dir=path.join(__dirname,'../longrun-extension');
const read=file=>readFileSync(path.join(dir,file),'utf8');
test('manifest has only expected scripts',()=>{
 const m=JSON.parse(read('manifest.json'));
 assert.equal(m.manifest_version,3);
 assert.deepEqual(m.content_scripts[0].js,['core.js','content.js']);
 assert.equal(m.background.service_worker,'background.js');
 assert.equal(m.content_scripts[0].matches[0],'https://www.facebook.com/groups/pumpkinlatte*');
});
test('collector saves before it counts post as completed',()=>{
 const source=read('core.js');
 assert.match(source,/const result=await persistBundle\(post,comments,media\);\s*seenSession.add\(post.key\)/);
 assert.match(source,/const failedPosts=new Map\(\)/);
});
test('media failures do not stop post parsing',()=>{
 const source=read('core.js');
 assert.match(source,/stage:'post_media'/);
 assert.match(source,/stage:'comment_media'/);
});
test('direct uploads have an explicit timeout, retries and no popup dependency',()=>{
 const source=read('core.js');
 const block=source.slice(source.indexOf('async function submitPayloadsAndWait'),source.indexOf('async function drainSyncQueue'));
 assert.match(block,/AbortController/);
 assert.match(block,/attempt<=3/);
 assert.match(block,/body\.saved===payloads\.length/);
 assert.doesNotMatch(block,/window\.open/);
});
test('long idle periods pause only after checkpointing',()=>{
 const source=read('core.js');
 assert.match(source,/15\*60\*1000/);
 assert.match(source,/function stop\(/);
 assert.match(source,/saveCrawlState\(\{status:'stopped'\}\)/);
});
test('background heartbeat and recovery state are persistent',()=>{
 const source=read('background.js');
 assert.match(source,/chrome\.storage\.local/);
 assert.match(source,/chrome\.alarms\.create/);
 assert.match(source,/coreStopped/);
});
test('no backend service role credential or disabled authentication',()=>{
 const source=read('core.js')+read('background.js');
 assert.doesNotMatch(source,/SERVICE_ROLE_KEY/);
 assert.match(source,/PUBLISHABLE_KEY/);
});


test('sync failures counter initialized and queue is recoverable',()=>{
 const s=read('core.js');
 assert.match(s,/syncSubmitted=0,syncFailed=0/);
 assert.match(s,/syncPaused=true,syncEpoch=0/);
 assert.match(s,/async function drainSyncQueue\(\)/);
 assert.match(s,/finally\{[\s\S]*syncBusy=false;/);
 assert.match(s,/stage:'sync_queue'/);
});
test('IndexedDB connection is cached for long sessions',()=>{
 const s=read('core.js');
 assert.match(s,/let dbPromise=null;/);
 assert.match(s,/if\(dbPromise\)return dbPromise;/);
 assert.match(s,/db\.onversionchange/);
});
test('resuming does not instantly exhaust the target',()=>{
 const s=read('core.js');
 assert.match(s,/targetNew=stats\.posts_new\+Math\.max/);
});
test('watchdog does not hide the active panel',()=>{
 const s=read('core.js');
 assert.match(s,/panel\.style\.display='block';/);
 assert.doesNotMatch(s,/document\.body\.appendChild\(panel\);panel\.style\.display='none'/);
});


test('only newly marked local posts may be retried',async()=>{
 const vm=require('node:vm'),s=read('core.js');
 const code=s.slice(s.indexOf('async function retryLocalPendingSync(){'),s.indexOf('async function syncAllLocal(){'));
 const queued=[];
 const posts=[
  {key:'fb:pumpkinlatte:post:1',sync_status:'pending'},
  {key:'fb:pumpkinlatte:post:2',safe_sync_new_only:true,sync_status:'pending'},
  {key:'fb:pumpkinlatte:post:3',safe_sync_new_only:true,sync_status:'synced'},
  {key:'fb:pumpkinlatte:post:4',safe_sync_new_only:false,sync_status:'sending'}];
 const ctx={getAll:async()=>posts,syncablePostKey:k=>/^fb:pumpkinlatte:post:\d+$/.test(k),queueSyncPost:k=>queued.push(k)};
 vm.runInNewContext(code+';globalThis.run=retryLocalPendingSync;',ctx);
 await ctx.run();assert.deepEqual(queued,['fb:pumpkinlatte:post:2']);
});
test('legacy posts cannot acquire the new eligibility marker on updates',async()=>{
 const vm=require('node:vm'),s=read('core.js');
 const code=s.slice(s.indexOf('async function upsertRecord('),s.indexOf('async function persistBundle('));
 const map=new Map([['posts:old',{key:'old',sync_status:'pending'}]]);
 const ctx={VERSION:'test-v2.8.5',nowIso:()=>new Date(0).toISOString(),
  getOne:async(t,k)=>map.get(t+':'+k)||null,
  putOne:async(t,v)=>{map.set(t+':'+v.key,v);}};
 vm.runInNewContext(code+';globalThis.run=upsertRecord;',ctx);
 await ctx.run('posts',{key:'old',text:'re-read'});
 await ctx.run('posts',{key:'new',text:'new'});
 await ctx.run('comments',{key:'comment'});
 assert.notEqual(map.get('posts:old').safe_sync_new_only,true);
 assert.equal(map.get('posts:new').safe_sync_new_only,true);
 assert.notEqual(map.get('comments:comment').safe_sync_new_only,true);
});
test('payload builder refuses legacy data without loading comments',async()=>{
 const vm=require('node:vm'),s=read('core.js');
 const code=s.slice(s.indexOf('async function buildSyncPayload('),s.indexOf('async function markSyncStatus('));
 const ctx={getOne:async()=>({key:'fb:pumpkinlatte:post:1',facebook_post_id:'1'}),
 syncablePostKey:()=>true,getAll:async()=>{throw Error('legacy must not be read');}};
 vm.runInNewContext(code+';globalThis.run=buildSyncPayload;',ctx);
 assert.equal(await ctx.run('fb:pumpkinlatte:post:1'),null);
});
test('network cannot retry when Stop is active',async()=>{
 const vm=require('node:vm'),s=read('core.js');
 const code=s.slice(s.indexOf('async function submitPayloadsAndWait('),s.indexOf('async function drainSyncQueue('));
 let called=0;
 const ctx={syncPaused:true,syncEpoch:9,fetch:async()=>{called++;throw Error('unexpected');}};
 vm.runInNewContext(code+';globalThis.run=submitPayloadsAndWait;',ctx);
 const result=await ctx.run([],9);
 assert.equal(result.paused,true);assert.equal(called,0);
});
test('manual Stop aborts current HTTP upload and pauses subsequent uploads',()=>{
 const vm=require('node:vm'),s=read('core.js');
 const code=s.slice(s.indexOf('function stop(msg='),s.indexOf('async function exportJson('));
 let aborted=0;
 const ctx={running:true,timer:null,syncPaused:false,syncEpoch:2,
 activeSyncController:{abort(){aborted++;}},
 saveCrawlState:()=>Promise.resolve(),render:()=>{},clearTimeout:()=>{}};
 vm.runInNewContext(code+';globalThis.run=stop;',ctx);
 ctx.run();
 assert.equal(ctx.running,false);assert.equal(ctx.syncPaused,true);
 assert.equal(ctx.syncEpoch,3);assert.equal(aborted,1);
});
test('passive rescan does not queue existing posts',()=>{
 const source=read('core.js');
 assert.match(source,/if\(result\.postStatus==='new'\)queueSyncPost\(post\.key\)/);
 assert.doesNotMatch(source,/result\.postStatus!=='unchanged'\|\|localPost\?\.sync_status/);
});
