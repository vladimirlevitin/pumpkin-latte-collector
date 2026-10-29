'use strict';
const assert=require('node:assert/strict'),f=require('./worker-fixture.cjs')();
const {spawn,extCall,tabs,makePost:p,feedSender,deepAll,exportSender,storage,posts}=f;
(async()=>{
 spawn();await extCall('start',{tabId:5,url:tabs.get(5).url,options:{maxPosts:5}});
 await f.rewind();await extCall('discover',{posts:[10,9,8,7,6].map(p),step:1},feedSender());await deepAll();
 const j=await extCall('status'),ack={batchNumber:1,sessionId:j.id,downloadId:1,sha256:'a'.repeat(64)};
 f.failNextCommit();await assert.rejects(extCall('exportComplete',ack,exportSender()),/storage failure/);
 assert.equal((await extCall('status')).stage,'exporting');assert.equal(posts.size,5);
 let a=await extCall('archiveStatus',{group:j.group});assert.equal(a.head,null);assert.equal(a.tail,null);assert.equal(a.runs[j.id].batches.length,0);
 assert.equal(storage['burCollectorCheckpoints-v0520']?.backpackIL,undefined);
 spawn();await extCall('exportComplete',ack,exportSender());
 a=await extCall('archiveStatus',{group:j.group});assert.equal(a.head,p(10).post_id);assert.equal(a.tail,p(6).post_id);
 assert.equal(a.runs[j.id].batches.length,1);assert.equal(posts.size,5);
 console.log('PASS storage failure after successful download leaves both boundaries/job/history unchanged; service-worker restart and same receipt replay commit once without data loss');
})().catch(error=>{console.error(error);process.exitCode=1;});
