'use strict';
const assert=require('node:assert/strict'),f=require('./worker-fixture.cjs')();
const {spawn,extCall,tabs,makePost:p,obs,feedSender,deepAll,exportSender,posts,storage}=f;
(async()=>{
 spawn();await extCall('start',{tabId:5,url:tabs.get(5).url,options:{maxPosts:5}});await extCall('rewindResult',{result:{ok:true}},feedSender());
 await extCall('discover',{posts:[10,9,8,7,6].map(p),step:1},feedSender());await deepAll();let j=await extCall('status');
 await extCall('exportComplete',{batchNumber:1,sessionId:j.id,downloadId:1,sha256:'a'.repeat(64)},exportSender());await extCall('pause');
 const old=structuredClone(posts.get('backpackIL|post:'+p(9).post_id));
 // Legacy history may contain seen-but-never-exported IDs. It is not a durable receipt.
 storage['burCollectorHistory-v0520'].backpackIL.push(p(20).post_id);spawn();
 await extCall('start',{tabId:5,url:tabs.get(5).url,mode:'update',replacePaused:true,options:{maxPosts:5}});await extCall('rewindResult',{result:{ok:true}},feedSender());
 await extCall('discover',{observations:[obs({...p(9),post_text:'Changed old discussion; out of scope'},50),obs(p(20),200),obs(p(10),450)],step:1},feedSender());
 j=await extCall('status');assert.equal(j.stage,'deep');assert.deepEqual(Array.from(j.queue),[p(20).post_id]);
 assert.deepEqual(posts.get(old.key),old,'periodic new-only update must not overwrite or Deep-refresh a confirmed old post');
 await deepAll();j=await extCall('status');await extCall('exportComplete',{batchNumber:1,sessionId:j.id,downloadId:2,sha256:'b'.repeat(64)},exportSender());
 const state=await extCall('archiveStatus',{group:'backpackIL'});assert.equal(state.head,p(20).post_id);assert.equal(state.tail,p(6).post_id);
 console.log('PASS new-only update skips confirmed old posts promoted above the old head and preserves their data; only newly observed publication enters Deep/export');
})().catch(error=>{console.error(error);process.exitCode=1;});
