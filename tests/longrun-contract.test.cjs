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
