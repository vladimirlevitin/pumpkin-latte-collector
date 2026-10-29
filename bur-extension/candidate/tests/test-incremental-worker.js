'use strict';
const assert=require('node:assert/strict');
const f=require('./worker-fixture.cjs')();
const {spawn,extCall,storage,posts,tabs,makePost:p,obs,deepAll,feedSender,exportSender}=f;
const archive=async group=>extCall('archiveStatus',{group:group||'backpackIL'});
let receipt=0;
async function ack(){const j=await extCall('status');return extCall('exportComplete',{batchNumber:j.batchNumber,sessionId:j.id,sha256:(++receipt).toString(16).padStart(64,'0'),downloadId:receipt},exportSender());}
async function begin(mode='history',tab=5){return extCall('start',{tabId:tab,url:tabs.get(tab).url,mode,replacePaused:true,options:{maxPosts:5}});}
async function rewind(tab=5){return f.rewind(tab);}
(async()=>{
 spawn();let j=await begin();const historyId=j.id;
 await extCall('discover',{posts:[p(10)],step:1},feedSender());assert.equal((await extCall('status')).discovered,0,'unverified root cannot establish a baseline');
 await rewind();
 await extCall('discover',{posts:[10,9,8,7,6,5,4].map(p),step:1},feedSender());
 j=await extCall('status');assert.equal(j.stage,'deep');assert.equal(j.deferredRows.length,2);
 await deepAll();await ack();j=await extCall('status');
 assert.equal((await archive()).head,p(10).post_id);assert.equal((await archive()).tail,p(6).post_id);
 assert.equal(j.discovered,2);assert.deepEqual(Array.from(j.discoveryOrder),[p(5).post_id,p(4).post_id]);
 await extCall('collectFound',{tabId:5,url:tabs.get(5).url});await deepAll();await ack();
 assert.equal((await archive()).tail,p(4).post_id);
 await extCall('pause');
 // Newer IDs are deliberately out of numeric order: only observed order and exact boundary count.
 j=await begin('update');assert.equal(j.updateStopId,p(10).post_id);await rewind();
 await extCall('discover',{observations:[obs(p(30),100),obs(p(20),300),obs(p(10),500),obs(p(9),650)],step:1},feedSender());
 j=await extCall('status');assert.equal(j.stage,'deep');assert.equal(j.discovered,2);
 assert.equal((await archive()).head,p(10).post_id);assert.equal((await archive()).tail,p(4).post_id);
 await deepAll();await extCall('pause');spawn();await ack();
 j=await extCall('status');assert.equal(j.stage,'done');assert.equal((await archive()).head,p(30).post_id);assert.equal((await archive()).tail,p(4).post_id);
 assert.equal(storage['burCollectorCheckpoints-v0520'].backpackIL.post_id,p(4).post_id,'update must not replace historical checkpoint');
 // No-new-data pass needs no fake empty data batch and cannot change either boundary.
 await begin('update');await rewind();
 await extCall('discover',{observations:[obs(p(30),100),obs(p(20),300)],step:1},feedSender());
 assert.equal((await extCall('status')).stage,'done');assert.equal((await archive()).head,p(30).post_id);
 // Upper boundary beyond a full batch must stay pending until durable overflow is processed.
 await begin('update');await rewind();
 await extCall('discover',{observations:[50,49,48,47,46,45,44,30].map((n,i)=>obs(p(n),i*90)),step:1},feedSender());
 j=await extCall('status');assert.equal(j.updateBoundaryReached,false);assert.equal(j.deferredRows.length,3);
 await deepAll();await ack();assert.equal((await archive()).head,p(30).post_id);
 j=await extCall('status');assert.equal(j.stage,'deep');assert.equal(j.discovered,2);assert.equal(j.updateBoundaryReached,true);
 spawn();await deepAll();await ack();assert.equal((await extCall('status')).stage,'done');assert.equal((await archive()).head,p(50).post_id);assert.equal((await archive()).tail,p(4).post_id);
 // Legacy tail alone never invents an initial head. A baseline bridge must reach and capture it.
 storage['burCollectorCheckpoints-v0520'].pumpkinlatte={post_id:p(99).post_id,algorithm:'continuous_feed_v4'};
 await begin('update',6);await rewind(6);
 assert.equal((await archive('pumpkinlatte')).head,null);
 await extCall('discover',{observations:[110,99].map((n,i)=>obs({...p(n),group:'pumpkinlatte'},100+i*200)),step:1},{tab:{...tabs.get(6)},frameId:0});
 await deepAll();await ack();assert.equal((await archive('pumpkinlatte')).head,p(110).post_id);assert.equal((await archive('pumpkinlatte')).tail,p(99).post_id);
 assert.equal((await archive()).head,p(50).post_id);
 // A stale offscreen upper marker is not proof of a completed update.
 await begin('update',6);await rewind(6);
 await extCall('discover',{observations:[obs({...p(110),group:'pumpkinlatte'},-200)],step:1},{tab:{...tabs.get(6)},frameId:0});
 assert.equal((await extCall('status')).stage,'stalled');assert.equal((await archive('pumpkinlatte')).head,p(110).post_id);
 await extCall('pause');f.setFeedPosition('new-document',0);
 j=await begin('history');assert.equal(j.id,historyId);assert.equal(j.checkpointPostId,p(4).post_id);assert.equal(j.checkpointPending,true);
 await extCall('pause');tabs.delete(5);tabs.set(500,{id:500,url:'https://www.facebook.com/groups/backpackIL/',active:true});
 j=await extCall('start',{tabId:500,url:tabs.get(500).url,mode:'history',replacePaused:true});
 assert.equal(j.id,historyId);assert.equal(j.feedTabId,500);assert.equal(j.checkpointPostId,p(4).post_id);
 assert.ok(posts.size>=16,'all groups and earlier batches remain retained');
 console.log('PASS full worker: verified first root, overflow replay, independent head/tail, multi-batch updates, pause/restart, no-change pass, legacy-tail baseline bridge, group isolation, offscreen rejection and historical resume');
})().catch(error=>{console.error(error);process.exitCode=1;});
