'use strict';
const assert=require('node:assert/strict');
const S=require('../checkpoint-seek.js');
async function run({count=4000,target=3217,delay=5,gap=false,missing=false,pause=false,variable=false}={}){
 const doc={scrollingElement:{}},el=doc.scrollingElement,seen=new Set();
 const offsets=[0],heights=Array.from({length:count},(_,i)=>variable?100+(i*137)%550:200);
 for(const h of heights)offsets.push(offsets.at(-1)+h);
 const id=i=>String(9000000000000000n-BigInt((i*7919)%10000000)); // deliberately nonchronological
 let pos=0,ticks=0,loading=0,paused=false,found=false,submissions=0,rewound=0,last=0;
 const view={innerHeight:800,scrollTo(_x,y){if(y<pos)rewound++;last=pos;pos=Math.max(0,Math.min(offsets[count]-800,y));loading=delay;}};
 const job={id:'session',group:'group',checkpointPostId:missing?'1727687685009933':id(target)};
 function observe(){
  const p=loading>0?last:pos,out=[];let first=0;while(first<count-1&&offsets[first+1]<=p)first++;
  for(let i=first;i<Math.min(count,first+12);i++){
   if(missing&&i===target)continue;
   // Duplicate wrappers and disappearances outside the viewport should not matter.
   out.push({post:{post_id:id(i)},top:offsets[i]-p,bottom:offsets[i+1]-p,visible:offsets[i]-p<800&&offsets[i+1]-p>0});
  }
  return out;
 }
 const scroll={getCandidates:()=>[el],position:()=>pos,obstruction:()=>null};
 const args={job,doc,view,scroll,observe,
  wait:async()=>{ticks++;loading=Math.max(0,loading-1);if(pause&&ticks===80)paused=true;},
  stopped:async()=>paused||found,
  submit:async rows=>{submissions++;for(const x of rows.filter(x=>x.visible))seen.add(x.post.post_id);found=rows.some(x=>x.visible&&x.post.post_id===job.checkpointPostId);return {seekingCheckpoint:!found};}};
 if(gap){const old=view.scrollTo;let jumped=false;view.scrollTo=(x,y)=>{if(!jumped&&y>5000){jumped=true;old(x,y+3000);}else old(x,y);};}
 let stalled=false;
 for(let i=0;i<count*3&&!found;i++){
  const r=await S.step(args);if(r.stalled){stalled=true;break;}
  if(paused){const saved=pos;paused=false;assert.equal(pos,saved);}
 }
 if(missing){assert.equal(found,false);assert.equal(stalled,true);}else {assert.equal(found,true);for(let i=0;i<=target;i++)assert.ok(seen.has(id(i)),'unobserved index '+i);}
 if(gap)assert.ok(rewound>0);
 assert.ok(submissions>0);return {found,stalled,seen:seen.size,rewound};
}
(async()=>{
 console.log('delayed virtualized 4000 cards',await run());
 console.log('rewind on overshoot',await run({gap:true}));
 console.log('variable heights/overlapping virtual windows',await run({variable:true}));
 console.log('pause/resume',await run({pause:true}));
 console.log('target absent',await run({missing:true,count:150,target:80}));
 console.log('PASS exact-ID scan, every intermediate slice, no numeric chronology or absent-target success');
})().catch(e=>{console.error(e);process.exitCode=1;});
