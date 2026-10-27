/* Standalone checkpoint search planner. Does not alter the working collector.
 * Exact post ID is the only successful result. Facebook IDs are NOT ordered timestamps.
 * Fast skips require a verified target date and chronological feed evidence.
 */
'use strict';
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.BurCheckpointSearch=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
 const num=x=>Number.isFinite(Number(x))?Number(x):null;
 function make(targetId,opts={}){
  if(!/^\d{8,30}$/.test(String(targetId||'')))throw Error('Invalid checkpoint ID');
  return {targetId:String(targetId),targetTime:num(opts.targetTime),mode:'scan',stepScreens:0.65,verified:0,seen:new Set(),lastRange:null,stalls:0,found:false};
 }
 function observe(s,rows,{moving=true,chronological=false}={}){
  if(s.found)return {action:'found',stepScreens:0};
  const r=(rows||[]).filter(x=>x&&x.id).map(x=>({id:String(x.id),time:num(x.time)}));
  if(r.some(x=>x.id===s.targetId)){s.found=true;return {action:'found',stepScreens:0};}
  const fresh=r.filter(x=>!s.seen.has(x.id));r.forEach(x=>s.seen.add(x.id));
  if(!moving&&!fresh.length){s.stalls++;return {action:s.stalls>=5?'pause':'retry',stepScreens:0,reason:'feed_not_advancing'};}
  s.stalls=0;
  const times=r.map(x=>x.time).filter(x=>x!==null);
  const valid=chronological&&s.targetTime!==null&&times.length>=2&&times.length===r.length;
  if(!valid){s.mode='scan';s.stepScreens=0.65;return {action:'advance',stepScreens:0.65,mode:s.mode};}
  const min=Math.min(...times),max=Math.max(...times);
  if(s.lastRange&&s.lastRange.min>s.targetTime&&max<s.targetTime){
    s.mode='backtrack';s.stepScreens=-0.65;
    return {action:'advance',stepScreens:-0.65,mode:s.mode,reason:'crossed_target_time'};
  }
  s.lastRange={min,max};
  if(min>s.targetTime){s.verified++;s.mode='fast';s.stepScreens=Math.min(6,1+Math.floor(s.verified/4));}
  else{s.mode='scan';s.stepScreens=0.65;}
  return {action:'advance',stepScreens:s.stepScreens,mode:s.mode};
 }
 return {make,observe};
});
