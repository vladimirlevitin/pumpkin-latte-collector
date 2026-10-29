'use strict';
const assert=require('node:assert/strict'),f=require('./worker-fixture.cjs')();
const {spawn,extCall,tabs,makePost:p,feedSender,deepSender,deepAll,posts}=f;
const comment=n=>({id:'comment-'+n,text:'Persisted comment '+n});
const message=ids=>({id:p(10).post_id,post:{...p(10),comments:ids.map(comment)}});
(async()=>{
 spawn();await extCall('start',{tabId:5,url:tabs.get(5).url,options:{maxPosts:5}});await f.rewind();await extCall('discover',{posts:[10,9,8,7,6].map(p),step:1},feedSender());
 let j=await extCall('status');await extCall('deepExpanding',{id:j.queue[j.index]},deepSender(j));
 const wrong=await extCall('deepProgress',message([99]),feedSender());assert.equal(wrong.ignored,true);
 await extCall('deepProgress',message([1]),deepSender(j));j=await extCall('status');assert.equal(j.index,0);assert.equal(j.deepDone,0);
 await extCall('pause');const paused=await extCall('deepProgress',message([1,2]),deepSender(j));assert.equal(paused.paused,true);
 assert.equal(posts.get('backpackIL|post:'+p(10).post_id).comments.length,2);
 spawn();await extCall('resume',{tabId:5,url:tabs.get(5).url});j=await extCall('status');
 await extCall('deepExpanding',{id:j.queue[j.index]},deepSender(j));
 await extCall('deepPassEnd',{...message([3]),scrolled:1,coverage:{settled:false,remaining_controls:1,known_incomplete:true}},deepSender(j));
 j=await extCall('status');assert.equal(j.deepPhase,'READY');assert.equal(j.index,0);assert.equal(j.deepDone,0);
 assert.equal(posts.get('backpackIL|post:'+p(10).post_id).comments.length,3);
 for(let i=0;i<3;i++){
  j=await extCall('status');await extCall('deepExpanding',{id:j.queue[j.index]},deepSender(j));
  await extCall('deepPassEnd',{...message([3]),scrolled:0,coverage:{settled:false,remaining_controls:1,known_incomplete:true}},deepSender(j));
 }
 j=await extCall('status');assert.equal(j.stage,'stalled');assert.equal(j.index,0);assert.equal(j.deepDone,0);
 assert.equal((await extCall('archiveStatus',{group:j.group})).tail,null);
 await extCall('resume',{tabId:5,url:tabs.get(5).url});j=await extCall('status');
 await extCall('deepSnapshot',{...message([4]),coverage:{settled:true,remaining_controls:0,known_incomplete:false}},deepSender(j));
 assert.equal(posts.get('backpackIL|post:'+p(10).post_id).comments.length,4);
 j=await extCall('status');assert.equal(j.index,1);assert.equal(j.deepDone,1);await deepAll();
 j=await extCall('status');assert.equal(j.stage,'exporting');assert.equal(j.deepDone,5);
 assert.equal((await extCall('archiveStatus',{group:j.group})).tail,null,'progress/Deep completion does not commit the export boundary');
 console.log('PASS durable Deep snapshots, foreign sender rejection, pause/restart retention, multi-pass continuation without index advance, safe no-gain stall and final union of virtualized comment slices');
})().catch(error=>{console.error(error);process.exitCode=1;});
