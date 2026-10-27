const assert=require('node:assert/strict');
const {make,observe}=require('./checkpoint-search.js');
const target='1727687685009933';
{
 const s=make(target);for(let i=0;i<80;i++){
 const a=observe(s,[{id:String(1800000000000000+i)}],{moving:true});
 assert.equal(a.stepScreens,0.65,'never skip without verified chronology');
 }assert.equal(observe(s,[{id:target}]).action,'found');
}
{
 const s=make(target,{targetTime:100});
 for(let i=0;i<30;i++)observe(s,[{id:String(1800000000000000+i*2),time:300-i},{id:String(1800000000000001+i*2),time:299-i}],{moving:true,chronological:true});
 assert.ok(s.stepScreens>1,'accelerates only with date evidence');
 const a=observe(s,[{id:'1790000000000000',time:80},{id:'1790000000000001',time:79}],{moving:true,chronological:true});
 assert.equal(a.mode,'backtrack');assert.ok(a.stepScreens<0);
}
{
 const s=make(target);let a;
 for(let i=0;i<5;i++)a=observe(s,[],{moving:false});
 assert.equal(a.action,'pause');assert.equal(s.found,false);
}
console.log('PASS isolated search safety, acceleration, overshoot, exact match, stall');