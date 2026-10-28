/* Exact checkpoint seek over observed viewport slices. No numeric ID chronology. */
(function(root,factory){const api=factory();if(typeof module!=='undefined'&&module.exports)module.exports=api;root.BurCheckpointSeek=api;})(typeof window!=='undefined'?window:globalThis,function(){
'use strict';
const states=new WeakMap();
const ids=rows=>new Set(rows.filter(x=>x.visible&&x.post?.post_id).map(x=>String(x.post.post_id)));
const signature=rows=>[...ids(rows)].join('|');
async function step({job,doc,view,scroll,observe,wait,submit,stopped}){
 let s=states.get(doc);
 const key=job.id+'|'+job.group+'|'+job.checkpointPostId;
 if(!s||s.key!==key){s={key,stable:0,misses:0,rewinds:0,steps:0};states.set(doc,s);}
 const settle=async(ready=()=>true)=>{let prior='',same=0,rows=[];
  for(let n=0;n<16;n++){
   await wait(200);if(await stopped())return null;
   rows=observe();
   if(rows.some(x=>x.visible&&String(x.post?.post_id)===String(job.checkpointPostId)))return rows;
   const sig=signature(rows);
   same=sig&&sig===prior?same+1:0;prior=sig;
   if(same>=3&&ready(rows))return rows;
  }return rows;
 };
 let before=await settle(rows=>!s.restore||rows.some(x=>x.visible&&s.restore.some(b=>String(b.post?.post_id)===String(x.post?.post_id)&&Math.abs(b.top-x.top)<5)));
 if(!before)return {stop:true};s.restore=null;
 const response=await submit(before);
 if(!response?.seekingCheckpoint||await stopped())return {stop:true};
 const candidates=scroll.getCandidates(doc,view),vh=Math.max(1,Number(view.innerHeight)||800);
 const blocked=scroll.obstruction(doc,view);if(blocked)return {stalled:true,diagnostics:{reason:'obstruction',blocked}};
 const oldIds=ids(before);let moved=false,after=before;
 for(const el of candidates){
  const pos=scroll.position(el,doc,view);
  const root=doc.scrollingElement||doc.documentElement;
  const set=p=>{if(el===root||el===doc.body||el===doc.documentElement)view.scrollTo(0,p);else el.scrollTop=p;};
  for(let attempt=0;attempt<4;attempt++){
   if(await stopped())return {stop:true};
   const amount=Math.max(40,Math.round(vh*(s.stable>=4?.65:.35)/2**attempt));
   set(pos+amount);
   const rendered=rows=>rows.some(x=>x.visible&&before.some(b=>String(b.post?.post_id)===String(x.post?.post_id)&&b.top-x.top>=Math.min(20,amount/2)));
   after=await settle(rendered);
   if(!after){set(pos);s.restore=before;return {stop:true};}
   const delta=scroll.position(el,doc,view)-pos;
   if(delta<=4){set(pos);break;}
   const overlap=rendered(after)&&[...ids(after)].some(id=>oldIds.has(id));
   // Virtualization jumped over every observed card: rewind and inspect a smaller slice.
   // No overlap is not proof of a missing target or end of feed.
   // Above the first Facebook card (group header), there is no anchor yet.
   // Allow bounded forward movement until the first real post appears; do not rewind to the header.
   if(!oldIds.size){moved=true;break;}
   if(!overlap){
    set(pos);s.rewinds++;s.stable=0;
    const restored=await settle(rows=>[...ids(rows)].some(id=>oldIds.has(id)));if(!restored)return {stop:true};
    if(![...ids(restored)].some(id=>oldIds.has(id)))return {stalled:true,diagnostics:{reason:'anchor_lost',...s}};
    if(attempt===3)return {stalled:true,diagnostics:{reason:'unverified_gap',...s}};
    continue;
   }
   moved=true;break;
  }
  if(moved)break;
 }
 s.steps++;s.misses=moved?0:s.misses+1;s.stable=moved?s.stable+1:0;
 if(moved){const r=await submit(after);if(!r?.seekingCheckpoint||await stopped())return {stop:true};}
 return {stalled:s.misses>=12,batchSize:s.stable>=20?50:10,diagnostics:{reason:'stalled_or_unavailable',...s,observed:ids(after).size}};
}
return {step};
});
