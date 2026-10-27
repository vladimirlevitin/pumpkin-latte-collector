import {randomUUID} from 'node:crypto';
import {prepareUnits} from './chunks.mjs';

export function stagingClient(base,key,fetcher=fetch){
 const u=new URL(base);
 if(['ltznpjfnkpydautbsrej.supabase.co','bybgnzeaoaxnxwdugnwo.supabase.co','metzia.store'].includes(u.hostname))throw Error('production_disabled');
 if(u.username||u.password||u.search||u.hash||!['','/'].includes(u.pathname)||u.protocol!=='https:'&&!(u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname)))throw Error('invalid_staging_url');
 return async(name,args)=>{
  const headers={'content-type':'application/json',apikey:key};if(key.startsWith('eyJ'))headers.authorization='Bearer '+key;
  const r=await fetcher(base.replace(/\/$/,'')+'/rest/v1/rpc/'+name,{method:'POST',headers,redirect:'error',body:JSON.stringify(args),signal:AbortSignal.timeout(120000)});
  if(!r.ok)throw Error('rpc_failed_'+r.status);return r.json();
 };
}
export function geminiEmbedder(key,fetcher=fetch){
 if(!key)throw Error('embedding_key_required');
 return async text=>{
  const r=await fetcher('https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:embedContent',{
   method:'POST',headers:{'content-type':'application/json','x-goog-api-key':key},redirect:'error',
   body:JSON.stringify({content:{parts:[{text:'title: none | text: '+text}]},outputDimensionality:768}),signal:AbortSignal.timeout(60000)});
  if(!r.ok)throw Error('embedding_failed_'+r.status);
  const v=(await r.json())?.embedding?.values;
  if(!Array.isArray(v)||v.length!==768||v.some(x=>!Number.isFinite(x))||!v.some(x=>x!==0))throw Error('invalid_embedding');
  return v;
 };
}
export async function indexBatch(batch,{rpc,embed,maxBatches=100}){
 if(batch?.job_summary?.stage!=='done'||batch.job_summary.checkpoint_post_id&&!batch.job_summary.checkpoint_found_at)throw Error('unverified_batch');
 const units=prepareUnits(batch),postIds=batch.posts.map(x=>String(x.post_id));
 await rpc('bur_stage_prepare_units',{p_group:batch.group,p_post_ids:postIds,p_units:units});
 let stored=0,failed=0,stale=0;
 for(let n=0;n<maxBatches;n++){
  const lease=randomUUID();const items=await rpc('bur_stage_claim_embeddings',{p_group:batch.group,p_lease:lease,p_limit:5});
  if(!items.length)break;
  for(const item of items){
   try{
    const vector=await embed(item.text);
    const ok=await rpc('bur_stage_store_embedding',{p_unit:item.id,p_lease:lease,p_source_hash:item.source_hash,p_vector:vector});
    ok?stored++:stale++;
   }catch{failed++;} // Lease expires: later runs retry; no fake acknowledgement.
  }
 }
 const status=await rpc('bur_stage_index_status',{p_group:batch.group});
 return {...status,stored,failed,stale,ready:status.units>0&&status.units===status.embedded};
}

if(import.meta.url===new URL(process.argv[1]||'file:/', 'file:/').href || process.argv[1]?.endsWith('index-worker.mjs')){
 const fs=await import('node:fs/promises');
 const args=process.argv.slice(2),file=args.find(x=>!x.startsWith('-'));
 if(!file)throw Error('Usage: node index-worker.mjs batch.json [--apply --url https://staging-project.supabase.co]');
 const batch=JSON.parse(await fs.readFile(file,'utf8'));
 if(!args.includes('--apply'))console.log(JSON.stringify({dry_run:true,group:batch.group,units:prepareUnits(batch).length}));
 else{
  const at=args.indexOf('--url'),base=at>=0?args[at+1]:null,key=process.env.BUR_STAGING_SECRET;
  if(!base||!key)throw Error('Explicit staging URL and BUR_STAGING_SECRET required');
  console.log(JSON.stringify(await indexBatch(batch,{rpc:stagingClient(base,key),embed:geminiEmbedder(process.env.GEMINI_API_KEY)})));
 }
}
