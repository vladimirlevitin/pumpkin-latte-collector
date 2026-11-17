'use strict';
// 0.5.34.1: list mode — Deep only for pasted post links; no feed tab, checkpoints, history or archive boundaries.
const assert=require('node:assert/strict'),f=require('./worker-fixture.cjs')();
const {spawn,extCall,tabs,storage,posts,deepSender,exportSender}=f;
const G='backpackIL',ID=n=>String(1700000000000000+n),link=n=>'https://www.facebook.com/groups/'+G+'/posts/'+ID(n)+'/';
const snap=(n,comments)=>({post:{group:G,post_id:ID(n),permalink:link(n),post_text:'Ad post '+n,comments}});
(async()=>{
 spawn();
 await assert.rejects(extCall('startList',{url:'https://example.com/',text:link(1)}),/Facebook-группы/);
 await assert.rejects(extCall('startList',{url:tabs.get(5).url,text:'nothing here'}),/Не найдено/);
 let j=await extCall('startList',{url:tabs.get(5).url,text:link(1)+'\n'+link(2)+'?comment_id=9\n'+ID(3)+'\n'+link(1)});
 assert.equal(j.runMode,'list');assert.equal(j.stage,'deep');assert.deepEqual(j.listIds,[ID(1),ID(2),ID(3)]);
 assert.equal(j.feedTabId,null);assert.ok(j.deepTabId);assert.equal(tabs.get(j.deepTabId).url,link(1));
 // a second run is refused while this one is active
 await assert.rejects(extCall('startList',{url:tabs.get(5).url,text:link(9)}),/паузу/);
 // post 1: long discussion stops growing -> saved partially, list moves on (no pause)
 for(let i=0;i<4;i++){j=await extCall('status');await extCall('deepExpanding',{id:j.queue[j.index]},deepSender(j));
  await extCall('deepPassEnd',{...snap(1,[{id:'c1',text:'Маникюр, Хайфа'}]),scrolled:0,coverage:{settled:false,known_incomplete:true}},deepSender(j));}
 j=await extCall('status');assert.equal(j.stage,'deep');assert.equal(j.index,1);assert.equal(j.deepPartial,1);
 assert.equal(posts.get(G+'|post:'+ID(1)).deep.partial,true);
 // post 2 complete
 j=await extCall('status');await extCall('deepSnapshot',{...snap(2,[{id:'c2',text:'Репетитор'},{id:'c3',text:'Фото'}]),expanded:1,scrolled:1},deepSender(j));
 // post 3 fails twice (first pass + one auto retry) -> list still finishes
 j=await extCall('status');await extCall('deepError',{id:ID(3),error:'fixture'},deepSender(j));
 j=await extCall('status');assert.equal(j.stage,'exporting');
 let slice=await extCall('exportSlice',{offset:0,limit:100},exportSender());assert.equal(slice.total,2);
 await extCall('exportComplete',{batchNumber:1,sessionId:j.id,downloadId:1,filename:'bur-list.json',sha256:'a'.repeat(64)},exportSender());
 j=await extCall('status');assert.equal(j.stage,'deep');assert.deepEqual(j.queue,[ID(3)]);
 await extCall('deepError',{id:ID(3),error:'fixture again'},deepSender(j));
 j=await extCall('status');assert.equal(j.stage,'exporting');
 slice=await extCall('exportSlice',{offset:0,limit:100},exportSender());assert.equal(slice.total,2,'retry export still holds the whole list');
 await extCall('exportComplete',{batchNumber:1,sessionId:j.id,downloadId:2,filename:'bur-list.json',sha256:'b'.repeat(64)},exportSender());
 j=await extCall('status');assert.equal(j.stage,'done');assert.deepEqual(j.listMissing,[ID(3)]);assert.match(j.note,/2 из 3/);
 // nothing of the regular collector moved
 assert.equal(storage['burCollectorCheckpoints-v0520'],undefined);
 assert.equal(storage['burCollectorHistory-v0520'],undefined);
 assert.equal((await extCall('archiveStatus',{group:G})).tail,null);
 // a regular history run can start afterwards
 const h=await extCall('start',{tabId:5,url:tabs.get(5).url,options:{maxPosts:5}});assert.equal(h.runMode,'history');
 console.log('PASS list mode: parse/dedupe links, separate Deep tab, partial long threads, one auto-retry, full-list export, no checkpoint/history/archive changes');
})().catch(error=>{console.error(error);process.exitCode=1;});
