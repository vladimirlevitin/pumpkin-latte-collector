'use strict';
const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),posts=new Map(),storage={},pageCheckpoints={},pageHistories={};
const tabs=new Map([[5,{id:5,url:'https://www.facebook.com/groups/backpackIL/',active:true}],[6,{id:6,url:'https://www.facebook.com/groups/pumpkinlatte/',active:false}]]);
let nextTabId=7,sendListener,alarmListener,tabUpdatedListener,tabRemovedListener,injections=0,reloads=0,connected=false,requests=0,feedPageInstance='feed-doc-1',feedScrollY=12000;
function request(tx,run){const r={};tx.pending++;setImmediate(()=>{try{r.result=run();r.onsuccess?.();}catch(e){r.error=e;r.onerror?.();tx.onerror?.();}finally{tx.pending--;tx.completed();}});return r;}
class TX{constructor(){this.pending=0;this.complete=false;}completed(){if(!this.pending&&!this.complete)setImmediate(()=>{if(!this.pending&&!this.complete){this.complete=true;this.oncomplete?.();}});}objectStore(){return{get:key=>request(this,()=>posts.get(key)),put:o=>request(this,()=>posts.set(o.key,structuredClone(o))),delete:k=>request(this,()=>posts.delete(k)),index:()=>({getAll:r=>request(this,()=>[...posts.values()].filter(p=>p.group===r.group)),openKeyCursor:r=>{let keys=[...posts.values()].filter(p=>p.group===r.group).map(p=>p.key),ix=0,out={};const step=()=>{if(ix>=keys.length){out.result=null;out.onsuccess?.();return;}out.result={primaryKey:keys[ix++],continue:()=>setImmediate(step)};out.onsuccess?.();};this.pending++;setImmediate(()=>{step();this.pending--;this.completed();});return out;}})};}}
class DB{constructor(){this.objectStoreNames={contains:()=>true};}transaction(){return new TX();}close(){}createObjectStore(){return{createIndex(){}};}}
const indexedDB={open:()=>{const r={result:new DB()};setImmediate(()=>{r.onupgradeneeded?.();r.onsuccess?.();});return r;}},IDBKeyRange={only:group=>({group})};
let downloadState='complete';
const chrome={downloads:{search:async({id})=>[{id,state:downloadState,exists:true,filename:'batch.json'}]},runtime:{onMessage:{addListener:cb=>sendListener=cb},onInstalled:{addListener(){}},getURL:s=>'chrome-extension://test/'+s},storage:{local:{get:async k=>structuredClone({[k]:storage[k]}),set:async o=>Object.assign(storage,structuredClone(o))}},tabs:{
 get:async id=>{if(!tabs.has(id))throw Error('tab missing '+id);return tabs.get(id);},
 update:async(id,data)=>{const t=await chrome.tabs.get(id);Object.assign(t,data);return t;},
 create:async data=>{const t={id:nextTabId++,url:data.url||'about:blank',active:Boolean(data.active)};tabs.set(t.id,t);return t;},
 reload:async id=>{await chrome.tabs.get(id);reloads++;return tabs.get(id);},
 sendMessage:async(id,msg)=>{const t=await chrome.tabs.get(id);if(!connected)throw Error('no receiver');if(msg.type==='burPing')return {ready:true,version:'0.5.25-alpha',location:new URL(t.url).pathname,pageInstance:feedPageInstance,scrollY:feedScrollY,obstruction:null,detailPost:/\/posts\//.test(t.url)};if(msg.type==='burCheckpointGet')return {post_id:pageCheckpoints[msg.group]||null};if(msg.type==='burCheckpointSet'){if(msg.post_id)pageCheckpoints[msg.group]=String(msg.post_id);else delete pageCheckpoints[msg.group];return {ok:true};}if(msg.type==='burHistoryGet')return {ids:pageHistories[msg.group]||[]};if(msg.type==='burHistorySet'){pageHistories[msg.group]=Array.isArray(msg.ids)?msg.ids.map(String):[];return {ok:true};}return {ready:true};},
 onUpdated:{addListener:cb=>tabUpdatedListener=cb},onRemoved:{addListener:cb=>tabRemovedListener=cb}
},scripting:{executeScript:async()=>{injections++;connected=true;}},alarms:{create(){},onAlarm:{addListener:cb=>alarmListener=cb}}};
function spawn(){const context={chrome,indexedDB,IDBKeyRange,URL,console,setTimeout,clearTimeout,Date,structuredClone,fetch:()=>{requests++;throw Error('MUST NOT call model or API')}};context.globalThis=context;const ctx=vm.createContext(context);context.importScripts=(...files)=>{for(const file of files)vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),ctx,{filename:file});};vm.runInContext(fs.readFileSync(path.join(root,'background.js'),'utf8'),ctx,{filename:'background.js'});}
function extCall(type,msg={},sender={}){if(['discover','rewindResult','endDiscovery','feedOrderLost'].includes(type)&&!Object.hasOwn(msg,'pageInstance'))msg={...msg,pageInstance:feedPageInstance};return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('timeout '+type)),8000);sendListener({type,...msg},sender,r=>{clearTimeout(timer);r.ok?resolve(r.result):reject(Error(r.error));});});}
function feedSender(){return {tab:{...tabs.get(5)},frameId:0};}
function deepSender(j){return {tab:{...tabs.get(j.deepTabId)},frameId:0};}
function exportSender(){return {url:'chrome-extension://test/export.html?auto=1',tab:{id:90,url:'chrome-extension://test/export.html?auto=1'}};}
function makePost(i){const id=String(1700000000000000+i);return {group:'backpackIL',post_id:id,permalink:'https://www.facebook.com/groups/backpackIL/posts/'+id+'/',post_text:'Post '+i,comments:[]};}
function obs(p,top){return {post:p,top,bottom:top+80,visible:top+80>0&&top<800,viewportHeight:800};}
async function deepAll(){let j=await extCall('status');while(j.stage==='deep'){const id=j.queue[j.index],p=makePost(Number(id)-1700000000000000);await extCall('deepSnapshot',{post:{...p,comments:[{id:'c'+id,text:'comment',author:'A'}]},expanded:1,scrolled:1},deepSender(j));j=await extCall('status');}}
(async()=>{
 spawn();
 let j=await extCall('start',{tabId:5,url:tabs.get(5).url,options:{maxPosts:5,maxSteps:500}});
 assert.equal(j.stage,'discover');assert.equal(j.feedTabId,5);assert.equal(j.deepTabId,null);assert.equal(injections,1);
 await extCall('rewindResult',{result:{ok:true,feed_order:{verified:true,order:'new_posts',source:'fixture_visible_sort'}}},feedSender());
 const feedUrl=tabs.get(5).url;
 // Batch 1 discovery reaches 5 and MUST create a separate deep tab without moving feed.
 let r=await extCall('discover',{posts:[0,1,2,3,4].map(makePost),step:1},feedSender());
 j=await extCall('status');assert.equal(j.stage,'deep');assert.equal(j.queue.length,5);assert.ok(j.deepTabId&&j.deepTabId!==5);assert.equal(tabs.get(5).url,feedUrl);
 assert.equal(tabs.get(j.deepTabId).url,'https://www.facebook.com/groups/backpackIL/posts/'+makePost(0).post_id+'/');
 await deepAll();j=await extCall('status');assert.equal(j.stage,'exporting');assert.equal(j.batchNumber,1);assert.equal(tabs.get(5).url,feedUrl);
 let slice=await extCall('exportSlice',{offset:0,limit:100},exportSender());assert.equal(slice.total,5);
 assert.equal(storage['burCollectorCheckpoints-v0520']?.backpackIL?.post_id,undefined,'no checkpoint before completed download');
 downloadState='interrupted';
 await assert.rejects(extCall('exportComplete',{batchNumber:1,sessionId:j.id,sha256:'a'.repeat(64),downloadId:11},exportSender()),/не завершено/);
 assert.equal((await extCall('status')).stage,'exporting');assert.equal(posts.size,5);
 spawn(); // service-worker restart preserves the pending export and local snapshots
 downloadState='complete';
 await extCall('exportComplete',{batchNumber:1,sessionId:j.id,sha256:'a'.repeat(64),downloadId:11,filename:'b1.json'},exportSender());
 assert.equal(posts.size,5,'download does not delete retained snapshots');assert.equal(storage['burCollectorCheckpoints-v0520'].backpackIL.post_id,makePost(4).post_id);
 j=await extCall('status');assert.equal(j.stage,'discover');assert.equal(j.batchNumber,2);assert.equal(j.completedBatches,1);assert.equal(j.sessionPosts,5);assert.equal(j.liveBoundaryPending,false);assert.equal(j.liveBoundaryPostId,makePost(4).post_id);assert.equal(j.feedContinuationMode,'same_document');assert.equal(tabs.get(5).url,feedUrl);assert.equal(reloads,0);
 // Batch 2 starts from the SAME live feed document. The previous boundary card is already virtualized away.
 // This must still accept new posts immediately instead of rewinding to checkpoint.
 r=await extCall('discover',{observations:[obs(makePost(5),100),obs(makePost(6),400),obs(makePost(7),700)],viewportHeight:800,step:1},feedSender());
 j=await extCall('status');assert.equal(j.liveBoundaryPending,false);assert.equal(j.checkpointPending,false);assert.equal(j.discovered,3);assert.equal(j.discoveryOrder.join(','),[5,6,7].map(i=>makePost(i).post_id).join(','));
 r=await extCall('discover',{observations:[obs(makePost(6),-100),obs(makePost(7),100),obs(makePost(8),300),obs(makePost(9),500)],viewportHeight:800,step:1},feedSender());
 j=await extCall('status');assert.equal(j.stage,'deep');assert.equal(j.queue.join(','),[5,6,7,8,9].map(i=>makePost(i).post_id).join(','));assert.equal(tabs.get(5).url,feedUrl);assert.equal(reloads,0);
 // A failed post may export raw evidence, but must not move the historical checkpoint.
 const failedPostId=j.queue[j.index];
 await extCall('deepSnapshot',{post:{...makePost(Number(failedPostId)-1700000000000000),comments:[{id:'visible-'+failedPostId,text:'retained discovery comment',author:'A'}]},fallback:'url_identity_existing_discovery',coverage:null},deepSender(j));
 assert.equal([...posts.values()].find(p=>String(p.post_id)===failedPostId)?.deep?.status,'failed','fallback must not count as completed Deep');
 await deepAll();j=await extCall('status');assert.equal(j.stage,'exporting');assert.equal(j.deepErrors,1);
 await extCall('exportComplete',{batchNumber:2,sessionId:j.id,sha256:'c'.repeat(64),downloadId:12,filename:'partial.json'},exportSender());
 j=await extCall('status');assert.equal(j.stage,'stalled');assert.equal(j.queue.length,1);assert.equal(j.batchDeepTotal,5);
 assert.equal(storage['burCollectorCheckpoints-v0520'].backpackIL.post_id,makePost(4).post_id);
 spawn();await extCall('resume',{tabId:5,url:tabs.get(5).url});await deepAll();j=await extCall('status');
 assert.equal(j.stage,'exporting');assert.equal(j.deepErrors,0);assert.equal(j.lastCollectedPostId,makePost(9).post_id);
 await extCall('exportComplete',{batchNumber:2,sessionId:j.id,sha256:'b'.repeat(64),downloadId:12,filename:'b2.json'},exportSender());
 j=await extCall('status');assert.equal(j.batchNumber,3);assert.equal(j.completedBatches,2);assert.equal(j.sessionPosts,10);assert.equal(j.liveBoundaryPostId,makePost(9).post_id);assert.equal(j.feedContinuationMode,'same_document');assert.equal(reloads,0);
 // Batch 3 also starts without the boundary card. This is the live regression seen on Facebook after b0002.
 await extCall('discover',{observations:[obs(makePost(10),100),obs(makePost(11),400),obs(makePost(12),700)],viewportHeight:800,step:1},feedSender());
 j=await extCall('status');assert.equal(j.checkpointPending,false);assert.equal(j.discovered,3);assert.equal(j.discoveryOrder.join(','),[10,11,12].map(i=>makePost(i).post_id).join(','));assert.equal(reloads,0);
 // Only a real document replacement is allowed to trigger checkpoint recovery.
 feedPageInstance='feed-doc-2';feedScrollY=0;
 await extCall('feedOrderLost',{feed_order:{verified:true,order:'new_posts',status:'already_new_posts'}},feedSender());
 assert.ok(posts.size>=13,'recovery retains incomplete batch snapshots');
 j=await extCall('status');assert.equal(j.checkpointPending,true);assert.equal(j.rewindPending,true);assert.equal(j.checkpointPostId,makePost(9).post_id);assert.ok(reloads>=1);
 // Closing the feed during Deep must preserve the active batch/phase.
 j=await extCall('status');j.stage='deep';j.paused=false;j.queue=[makePost(10).post_id,makePost(11).post_id];j.index=0;
 storage['burCollectorJob-v0520']=structuredClone(j);const retained=posts.size;
 tabs.delete(5);tabRemovedListener(5);j=await extCall('status');
 assert.equal(j.stage,'deep');assert.equal(j.queue.length,2);assert.notEqual(j.feedTabId,5);assert.equal(posts.size,retained);
 // Foreign group cannot control this session.
 await assert.rejects(extCall('resume',{tabId:6,url:tabs.get(6).url}),/исходной вкладке/);
 assert.equal(requests,0);
 console.log('PASS: same live feed document continues across b0001/b0002 without boundary rediscovery; only real document loss triggers checkpoint recovery');
})().catch(e=>{console.error(e);process.exitCode=1;});
