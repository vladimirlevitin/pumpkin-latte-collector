'use strict';
const assert=require('node:assert/strict'),f=require('./worker-fixture.cjs')();
const {extCall,spawn,tabs,makePost:p,obs,feedSender,deepAll,exportSender}=f;
const state=()=>extCall('archiveStatus',{group:'backpackIL'});
async function start(mode){await extCall('start',{tabId:5,url:tabs.get(5).url,mode,replacePaused:true,options:{maxPosts:5}});await f.rewind();}
async function ack(n){const j=await extCall('status');return extCall('exportComplete',{batchNumber:j.batchNumber,sessionId:j.id,downloadId:n,sha256:String(n).repeat(64)},exportSender());}
(async()=>{
 spawn();await start('history');
 await extCall('discover',{posts:[{...p(1),is_pinned:true},p(50),p(40),p(30),p(20)],step:1},feedSender());
 // A permalink does not repeat the feed pin badge: Deep must not erase frontier evidence.
 let j=await extCall('status');
 while(j.stage==='deep'){
  const id=j.queue[j.index];await extCall('deepSnapshot',{post:{...p(Number(id)-1700000000000000),is_pinned:false}},f.deepSender(j));j=await extCall('status');
 }
 const exported=await extCall('exportSlice',{offset:0,limit:100},exportSender());assert.equal(exported.items.find(row=>row.post_id===p(1).post_id).feed_is_pinned,true);
 await ack(1);assert.equal((await state()).head,p(50).post_id);assert.equal((await state()).tail,p(20).post_id);
 await extCall('pause');await start('update');
 await extCall('discover',{observations:[obs({...p(50),is_pinned:true},10),obs(p(65),200)],step:1},feedSender());
 j=await extCall('status');assert.equal(j.stage,'discover');assert.equal(j.updateBoundaryReached,false);assert.equal(j.discovered,1);
 await extCall('discover',{observations:[obs(p(65),-20),obs(p(64),100),obs(p(50),400)],step:1},feedSender());
 j=await extCall('status');assert.equal(j.stage,'deep');assert.equal(j.discovered,2);await deepAll();await ack(2);
 assert.equal((await state()).head,p(65).post_id);assert.equal((await state()).tail,p(20).post_id);
 console.log('PASS pinned post cannot become initial head or terminate an update; normal exact boundary is required');
})().catch(error=>{console.error(error);process.exitCode=1;});
