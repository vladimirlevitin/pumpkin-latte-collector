/* Deterministic virtualized feed safety scenarios. Standalone module only. */
'use strict';
const assert=require('node:assert/strict');
const {make,observe}=require('./checkpoint-search.js');
const target='1727687685009933';
function run({count=2000,targetIndex=1400,withTargetTime=false,missing=false}={}){
 const ids=Array.from({length:count},(_,i)=>String(1900000000000000+i));
 ids[targetIndex]=target;
 const s=make(target,withTargetTime?{targetTime:count-targetIndex}:{});
 let pos=0,turns=0,backtracks=0,fast=0;
 while(turns++<25000){
  // Virtualized DOM: at most 4 nearby cards. Prior cards disappear.
  const rows=ids.slice(pos,Math.min(count,pos+4)).map((id,j)=>({id:missing&&id===target?'missing-id-'+j:id,time:count-(pos+j)}));
  const a=observe(s,rows,{moving:pos<count-4,chronological:withTargetTime});
  if(a.action==='found')return {found:true,turns,fast,backtracks};
  if(a.action==='pause')return {found:false,paused:true,turns,fast,backtracks};
  if(a.mode==='fast')fast++;
  if(a.mode==='backtrack')backtracks++;
  // In a real feed one screen can contain multiple posts; this mock models that variability.
  const jump=Math.max(1,Math.round(Math.abs(a.stepScreens||0)*3));
  pos=Math.min(count-4,Math.max(0,pos+(a.stepScreens<0?-jump:jump)));
 }
 throw Error('Unbounded search in simulated feed');
}
const exact=run();assert(exact.found,'exact target found in virtualized feed');
assert.equal(exact.fast,0,'numeric ID never activates fast mode');
const timed=run({withTargetTime:true});assert(timed.found,'date-guided fast search locates exact target');
assert(timed.fast>0,'date evidence activates fast mode');
const unavailable=run({missing:true});assert(!unavailable.found&&unavailable.paused,'missing checkpoint cannot be invented');
console.log('PASS virtualized feed baseline, date-guided acceleration, missing-ID safe pause',JSON.stringify({exact,timed,unavailable}));
