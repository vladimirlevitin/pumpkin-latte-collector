'use strict';
const assert=require('node:assert/strict'),f=require('./worker-fixture.cjs')();
const {spawn,extCall,tabs,makePost:p,obs,feedSender,deepAll,exportSender}=f;
(async()=>{
 spawn();await extCall('start',{tabId:5,url:tabs.get(5).url,options:{maxPosts:5}});
 await f.rewind();
 await extCall('discover',{posts:[10,9,8,7,6].map(p),step:1},feedSender());await deepAll();let j=await extCall('status');
 await extCall('exportComplete',{batchNumber:1,sessionId:j.id,downloadId:1,sha256:'a'.repeat(64)},exportSender());
 await extCall('discover',{posts:[5,4].map(p),step:1},feedSender());await extCall('pause');
 f.setFeedPosition('replacement',0);await extCall('resume',{tabId:5,url:tabs.get(5).url});
 j=await extCall('status');assert.equal(j.checkpointPending,true);assert.equal(j.deferredRows.length,2);
 spawn();await f.rewind();
 await extCall('discover',{observations:[obs(p(5),10),obs(p(4),100),obs(p(6),300),obs(p(3),500)],step:1},feedSender());
 j=await extCall('status');assert.deepEqual(Array.from(j.discoveryOrder),[p(5).post_id,p(4).post_id,p(3).post_id]);
 assert.equal(j.discovered,3,'draft snapshots must survive later DOM reordering above the old checkpoint');
 const slice=await extCall('exportSlice',{offset:0,limit:100},exportSender());assert.equal(slice.total,3);
 assert.ok(slice.items.every(row=>!('_burRetainedDraft' in row)));
 console.log('PASS recovery retains unexported snapshots across worker/document restart even when those posts move above the confirmed checkpoint');
})().catch(error=>{console.error(error);process.exitCode=1;});
