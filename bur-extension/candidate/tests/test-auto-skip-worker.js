'use strict';
// 0.5.32: a post whose Deep fails twice is skipped automatically (text kept) and the batch closes without a pause.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'test-worker.js'),'utf8');
const cut=src.indexOf('(async()=>{');
const head=src.slice(0,cut);
const body=`(async()=>{
 spawn();
 let j=await extCall('start',{tabId:5,url:tabs.get(5).url,options:{maxPosts:5,maxSteps:500}});
 await extCall('rewindResult',{result:{ok:true,feed_order:{verified:true,order:'new_posts',source:'fixture_visible_sort'}}},feedSender());
 await extCall('discover',{posts:[0,1,2,3,4].map(makePost),step:1},feedSender());
 j=await extCall('status');assert.equal(j.stage,'deep');
 const bad=makePost(1).post_id;
 async function run(){let j=await extCall('status');while(j.stage==='deep'){const id=j.queue[j.index],p=makePost(Number(id)-1700000000000000);
  if(id===bad)await extCall('deepSnapshot',{post:{...p,comments:[{id:'v'+id,text:'visible',author:'A'}]},fallback:'url_identity_existing_discovery',coverage:null},deepSender(j));
  else await extCall('deepSnapshot',{post:{...p,comments:[{id:'c'+id,text:'comment',author:'A'}]},expanded:1,scrolled:1},deepSender(j));
  j=await extCall('status');}}
 await run();j=await extCall('status');assert.equal(j.stage,'exporting');assert.equal(j.deepErrors,1);
 await extCall('exportComplete',{batchNumber:1,sessionId:j.id,sha256:'1'.repeat(64),downloadId:21,filename:'p1.json'},exportSender());
 j=await extCall('status');assert.equal(j.stage,'deep','first failure: automatic retry');assert.equal(j.paused,false);assert.deepEqual(j.queue,[bad]);
 await run();j=await extCall('status');assert.equal(j.stage,'exporting');
 await extCall('exportComplete',{batchNumber:1,sessionId:j.id,sha256:'2'.repeat(64),downloadId:22,filename:'p2.json'},exportSender());
 j=await extCall('status');assert.equal(j.stage,'exporting','second failure: skipped and re-exported');assert.equal(j.paused,false);assert.deepEqual(j.autoSkipped,[bad]);
 const row=[...posts.values()].find(p=>String(p.post_id)===bad);assert.equal(row.deep.status,'captured_unverified');assert.equal(row.deep.skipped_auto,true);
 await extCall('exportComplete',{batchNumber:1,sessionId:j.id,sha256:'3'.repeat(64),downloadId:23,filename:'b1.json'},exportSender());
 j=await extCall('status');assert.equal(j.stage,'discover');assert.equal(j.batchNumber,2);assert.equal(j.completedBatches,1);assert.equal(storage['burCollectorCheckpoints-v0520'].backpackIL.post_id,makePost(4).post_id);
 console.log('auto-skip worker: ok');
})().catch(e=>{console.error(e);process.exit(1);});
`;
eval(head+body);
