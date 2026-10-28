/* Durable, per-group boundaries. Pure transitions are tested before worker integration. */
(function(root,factory){const api=factory();if(typeof module!=='undefined')module.exports=api;root.FBBurArchive=api;})(globalThis,function(){
 'use strict';
 const copy=value=>JSON.parse(JSON.stringify(value));
 function requireId(id){if(typeof id!=='string'||!/^\d{8,30}$/.test(id))throw Error('Invalid post ID');return id;}
 function empty(group){if(!group)throw Error('Group required');return {schema:1,group,head:null,tail:null,runs:{},receipts:{}};}
 function begin(state,{runId,mode='history',fromRoot=false}){
  const s=copy(state);
  if(!['history','update'].includes(mode)||!runId)throw Error('Invalid run');
  if(s.runs[runId])return s;
  if(Object.values(s.runs).some(r=>r.status==='running'))throw Error('Resume unfinished run first');
  if(mode==='update'&&!s.head)throw Error('Upper boundary is unknown; baseline required');
  if(mode==='update'&&!fromRoot)throw Error('Update must start at verified root');
  s.runs[runId]={mode,status:'running',fromRoot,previousHead:s.head,stopAt:mode==='update'?s.head:null,first:null,last:null,batches:[],boundaryReached:false};return s;
 }
 function stage(state,{runId,batchId,ids,boundaryReached=false,deepErrors=0}){
  const s=copy(state),r=s.runs[runId];if(!r||r.status!=='running')throw Error('No active run');
  if(!batchId||!Array.isArray(ids)||new Set(ids).size!==ids.length)throw Error('Invalid batch');
  ids.forEach(requireId);
  if(r.mode==='update'&&ids.includes(r.stopAt))throw Error('Stop boundary belongs to previous coverage');
  const previous=r.batches.at(-1);
  if(previous&&!s.receipts[previous.batchId])throw Error('Previous batch is not durable');
  if(previous?.deepErrors)throw Error('Retry failed Deep before advancing');
  if(r.batches.some(b=>b.batchId===batchId))throw Error('Batch already staged');
  if(!ids.length&&!(r.mode==='update'&&boundaryReached))throw Error('Empty history batch');
  r.batches.push({batchId,ids,deepErrors:Number(deepErrors)||0,boundaryReached:Boolean(boundaryReached)});
  // Neither boundary changes until download/retention is confirmed.
  return s;
 }
 function acknowledge(state,{runId,batchId,sha256,retained=true}){
  const s=copy(state),r=s.runs[runId],b=r?.batches.find(b=>b.batchId===batchId);
  if(!b)throw Error('Unknown batch');
  if(!retained||!/^([a-f0-9]{64})$/.test(sha256||''))throw Error('Durable bytes receipt required');
  if(s.receipts[batchId]){if(s.receipts[batchId].sha256!==sha256)throw Error('Receipt hash conflict');return s;}
  s.receipts[batchId]={sha256,runId,imported:false};
  r.first=r.first||b.ids[0]||null;r.last=b.ids.at(-1)||r.last;
  r.boundaryReached=r.boundaryReached||b.boundaryReached;
  if(r.mode==='history'&&!b.deepErrors){
   // A migrated tail does not magically establish an old upper boundary.
   if(!s.head&&r.fromRoot&&r.first)s.head=r.first;
   if(r.last)s.tail=r.last;
  }
  return s;
 }
 function finish(state,runId){
  const s=copy(state),r=s.runs[runId];if(!r)throw Error('Unknown run');
  if(r.status==='done')return s;
  if(!r.batches.length||r.batches.some(b=>!s.receipts[b.batchId]))throw Error('Unconfirmed batches');
  if(r.batches.some(b=>b.deepErrors))throw Error('Deep failures require retry');
  if(r.mode==='update'){
   if(!r.boundaryReached)throw Error('Previous upper boundary not reached');
   if(s.head!==r.previousHead)throw Error('Upper boundary changed concurrently');
   s.head=r.first||r.previousHead;
  }
  r.status='done';return s;
 }
 function imported(state,{batchId,sha256}){
  const s=copy(state),receipt=s.receipts[batchId];
  if(!receipt||receipt.sha256!==sha256)throw Error('Import receipt does not match retained bytes');
  receipt.imported=true;return s;
 }
 return {empty,begin,stage,acknowledge,finish,imported};
});
