/* Exact checkpoint seek over observed viewport slices. No numeric ID chronology. */
(function(root,factory){const api=factory();if(typeof module!=='undefined'&&module.exports)module.exports=api;root.BurCheckpointSeek=api;})(typeof window!=='undefined'?window:globalThis,function(){
'use strict';
const states=new WeakMap();
const ids=rows=>new Set(rows.filter(x=>x.visible&&x.post?.post_id).map(x=>String(x.post.post_id)));
const allIds=rows=>new Set(rows.filter(x=>x.post?.post_id).map(x=>String(x.post.post_id)));
const signature=rows=>[...ids(rows)].join('|');
async function step({job,doc,view,scroll,observe,wait,submit,stopped}){
 let s=states.get(doc);
 const key=job.id+'|'+job.group+'|'+job.checkpointPostId;
 if(!s||s.key!==key){s={key,stable:0,misses:0,rewinds:0,steps:0};states.set(doc,s);}
 // 0.5.30: fast seek. Cards already collected only need to be passed, so the
 // settle window is shorter, steps are larger once the feed is stable, and the
 // checkpoint is detected anywhere in the rendered DOM (then scrolled into view),
 // not only when it happens to be inside the viewport.
 const isCp=x=>String(x.post?.post_id)===String(job.checkpointPostId);
 const settle=async(ready=()=>true)=>{let prior='',same=0,rows=[];
  for(let n=0;n<16;n++){
   await wait(120);if(await stopped())return null;
   rows=observe();
   if(rows.some(isCp))return rows;
   const sig=signature(rows);
   same=sig&&sig===prior?same+1:0;prior=sig;
   if(same>=2&&ready(rows))return rows;
  }return rows;
 };
 const setter=el=>{const root=doc.scrollingElement||doc.documentElement;return p=>{if(el===root||el===doc.body||el===doc.documentElement)view.scrollTo(0,p);else el.scrollTop=p;};};
 const reveal=async rows=>{
  const cp=rows&&rows.find(isCp);if(!cp||cp.visible||!Number.isFinite(cp.top))return rows;
  for(const el of scroll.getCandidates(doc,view)){
   const pos=scroll.position(el,doc,view),set=setter(el);set(Math.max(0,pos+cp.top-80));
   const r=await settle(x=>x.some(y=>isCp(y)&&y.visible));if(!r)return null;
   if(r.some(y=>isCp(y)&&y.visible))return r;
   if(Math.abs(scroll.position(el,doc,view)-pos)>4)return r;
  }
  return rows;
 };
 let before=await settle(rows=>!s.restore||rows.some(x=>x.visible&&s.restore.some(b=>String(b.post?.post_id)===String(x.post?.post_id)&&Math.abs(b.top-x.top)<5)));
 before=await reveal(before);if(!before)return {stop:true};s.restore=null;
 const response=await submit(before);
 if(!response?.seekingCheckpoint||await stopped())return {stop:true};
 const candidates=scroll.getCandidates(doc,view),vh=Math.max(1,Number(view.innerHeight)||800);
 const blocked=scroll.obstruction(doc,view);if(blocked)return {stalled:true,diagnostics:{reason:'obstruction',blocked}};
 const oldIds=allIds(before);let moved=false,after=before;
 const lastTop=Math.max(0,...before.filter(x=>x.post?.post_id&&Number.isFinite(x.top)).map(x=>x.top));
 for(const el of candidates){
  const pos=scroll.position(el,doc,view);
  const root=doc.scrollingElement||doc.documentElement;
  const set=setter(el);
  for(let attempt=0;attempt<4;attempt++){
   if(await stopped())return {stop:true};
   // 0.5.33: once the feed is stable, jump straight to the last card Facebook has
   // already rendered (up to 8 screens) instead of 1.5 screens: the next slice starts
   // loading sooner. The overlap/rewind check below still guards against gaps.
   const base=s.stable>=4?Math.min(vh*8,Math.max(vh*1.5,lastTop-vh*.3)):vh*.5;
   const amount=Math.max(40,Math.round(base/2**attempt));
   set(pos+amount);
   const rendered=rows=>rows.some(x=>Number.isFinite(x.top)&&before.some(b=>String(b.post?.post_id)===String(x.post?.post_id)&&Number.isFinite(b.top)&&b.top-x.top>=Math.min(20,amount/2)));
   after=await settle(rendered);
   if(!after){set(pos);s.restore=before;return {stop:true};}
   const delta=scroll.position(el,doc,view)-pos;
   if(delta<=4){set(pos);break;}
   const overlap=rendered(after)&&[...allIds(after)].some(id=>oldIds.has(id));
   // Virtualization jumped over every observed card: rewind and inspect a smaller slice.
   // No overlap is not proof of a missing target or end of feed.
   // Above the first Facebook card (group header), there is no anchor yet.
   // Allow bounded forward movement until the first real post appears; do not rewind to the header.
   if(!oldIds.size){moved=true;break;}
   if(!overlap){
    set(pos);s.rewinds++;s.stable=0;
    const restored=await settle(rows=>[...allIds(rows)].some(id=>oldIds.has(id)));if(!restored)return {stop:true};
    if(![...allIds(restored)].some(id=>oldIds.has(id)))return {stalled:true,diagnostics:{reason:'anchor_lost',...s}};
    if(attempt===3)return {stalled:true,diagnostics:{reason:'unverified_gap',...s}};
    continue;
   }
   moved=true;break;
  }
  if(moved)break;
 }
 s.steps++;s.misses=moved?0:s.misses+1;s.stable=moved?s.stable+1:0;
 if(moved){after=await reveal(after);if(!after)return {stop:true};const r=await submit(after);if(!r?.seekingCheckpoint||await stopped())return {stop:true};}
 return {stalled:s.misses>=12,batchSize:s.stable>=20?50:10,diagnostics:{reason:'stalled_or_unavailable',...s,observed:ids(after).size}};
}
// 0.5.33: after a kick (feed nudged when Facebook stopped loading) start counting misses afresh.
function reset(doc){const s=states.get(doc);if(s){s.misses=0;s.stable=0;}}
return {step,reset};
});
