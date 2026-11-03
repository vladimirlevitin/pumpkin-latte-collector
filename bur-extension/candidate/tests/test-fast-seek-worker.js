'use strict';
// 0.5.33: fast seek support in the worker — cheap seekStatus, seekKick note without pause,
// cards passed off-screen are remembered as "above checkpoint", cards below a rendered
// checkpoint are not.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'test-checkpoint-worker.js'),'utf8');
const head=src.slice(0,src.indexOf('(async()=>{'));
const body=`(async()=>{
 spawn();
 const cp='1727687685009933';
 let j=await extCall('start',{tabId:5,url:tabs.get(5).url,startAfter:cp,options:{maxPosts:5,maxSteps:50000}});
 await extCall('rewindResult',{result:{ok:true,feed_order:{verified:true,order:'new_posts',source:'fixture_visible_sort'}}},feedSender());
 // Lite status mirrors the running seek without the full job.
 let lite=await extCall('seekStatus');
 assert.deepEqual(Object.keys(lite).sort(),['checkpointPending','group','id','paused','rewindPending','stage']);
 assert.equal(lite.checkpointPending,true);assert.equal(lite.stage,'discover');assert.equal(lite.paused,false);
 // A jump of several screens: cards far below the viewport are still remembered.
 await extCall('discover',{observations:[obs(makePost(1),100),obs(makePost(2),2500),obs(makePost(3),5200)],step:1},feedSender());
 j=await extCall('status');
 for(const i of [1,2,3])assert.ok(j.checkpointSeenIds.includes(makePost(i).post_id),'passed card '+i+' remembered');
 // Checkpoint rendered below the viewport: cards under it must NOT be marked as seen.
 await extCall('discover',{observations:[obs(makePost(4),100),obs({...makePost(0),post_id:cp},1600),obs(makePost(5),2400)],step:1},feedSender());
 j=await extCall('status');
 assert.ok(j.checkpointSeenIds.includes(makePost(4).post_id));
 assert.ok(!j.checkpointSeenIds.includes(makePost(5).post_id),'card below checkpoint stays collectable');
 assert.ok(!j.checkpointSeenIds.includes(cp));assert.equal(j.checkpointFound,false);
 // Kick: note updated, run keeps going, no pause or stall.
 await extCall('seekKick',{pageInstance:feedPageInstance,kick:2,limit:6},feedSender());
 j=await extCall('status');
 assert.equal(j.paused,false);assert.equal(j.stage,'discover');assert.equal(j.seekKicks,1);assert.match(j.note,/2\\/6/);
 // A kick from a foreign tab is ignored.
 const ignored=await extCall('seekKick',{kick:3,limit:6},{tab:{...tabs.get(6)},frameId:0});assert.equal(ignored.ignored,true);
 // Pause is visible through the lite status at once.
 await extCall('pause');lite=await extCall('seekStatus');assert.equal(lite.paused,true);
 await extCall('resume',{tabId:5,url:tabs.get(5).url});
 await extCall('discover',{observations:[obs({...makePost(0),post_id:cp},100),obs(makePost(6),400)],step:1},feedSender());
 j=await extCall('status');assert.equal(j.checkpointFound,true);assert.equal(j.discovered,1);
 lite=await extCall('seekStatus');assert.equal(lite.checkpointPending,false);
 console.log('PASS fast seek worker: lite status, kick without pause, off-screen seen ids, nothing below checkpoint blocked');
})().catch(e=>{console.error(e);process.exitCode=1;});
`;
eval(head+body);
