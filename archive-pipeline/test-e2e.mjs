// Entire local chain using actual PostgreSQL/pgvector and the inspected import SQL.
// HTTP emulates Supabase transport and Auth; embeddings are deterministic test vectors.
import {PGlite} from '@electric-sql/pglite';
import {vector} from '@electric-sql/pglite-pgvector';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import http from 'node:http';import {spawn} from 'node:child_process';import assert from 'node:assert/strict';
import {indexBatch,stagingClient} from './index-worker.mjs';
import {createHandler} from './archive-api/handler.mjs';
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'bur-e2e-')),db=new PGlite({extensions:{vector}}),objects=new Map();
let server;
try{
 for(const name of ['fixtures/schema.sql','fixtures/existing-import.sql','staging-receipt.sql','staging-search.sql','staging-index.sql'])await db.exec(await fs.readFile(new URL(name,import.meta.url),'utf8'));
 const allowed=new Set(['bur_import_archived_json','bur_verify_import_receipt','bur_stage_prepare_units','bur_stage_claim_embeddings','bur_stage_store_embedding','bur_stage_index_status','bur_archive_search','bur_archive_authorized']);
 server=http.createServer(async(req,res)=>{
  try{
   let text='';for await(const chunk of req)text+=chunk;
   const reply=(status,data)=>{res.writeHead(status,{'content-type':'application/json'});res.end(Buffer.isBuffer(data)?data:JSON.stringify(data));};
   if(req.url==='/auth/v1/user'){reply(req.headers.authorization==='Bearer session-test'?200:401,{id:'00000000-0000-0000-0000-000000000100'});return;}
   if(req.headers.apikey!=='staging-test-key'){reply(401,{});return;}
   if(req.url.startsWith('/storage/v1/object/')){
    const key=decodeURIComponent(req.url.replace('/storage/v1/object/','').replace(/^authenticated\//,''));
    if(req.method==='POST'){
     if(objects.has(key)){reply(409,{});return;}
     objects.set(key,Buffer.from(text));await db.query('insert into storage.objects values($1,$2)',['bur-raw',key.replace(/^bur-raw\//,'')]);reply(200,{});
    }else reply(objects.has(key)?200:404,objects.get(key)||{});
    return;
   }
   const name=req.url.split('/').at(-1);if(!allowed.has(name)){reply(404,{});return;}
   const body=JSON.parse(text),keys=Object.keys(body);
   if(keys.some(k=>!/^[_a-z][_a-z0-9]*$/.test(k)))throw Error('bad argument');
   await db.exec('set role service_role');
   try{
    const query='select public.'+name+'('+keys.map((k,i)=>k+'=> $'+(i+1)).join(',')+') r';
    const params=keys.map(k=>body[k]!==null&&typeof body[k]==='object'&&!Array.isArray(body[k])?JSON.stringify(body[k]):body[k]);
    // jsonb arrays must be JSON strings; text[] remains a native parameter array.
    for(const k of ['p_units','p_vector'])if(Array.isArray(body[k]))params[keys.indexOf(k)]=JSON.stringify(body[k]);
    const result=(await db.query(query,params)).rows[0].r;reply(200,result);
   }finally{await db.exec('reset role');}
  }catch(error){console.error('fixture SQL error:',error.code,error.message);res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({code:error.code||'500',error:String(error.message)}));}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 const batch={schema:'bur-collector/1',collector_version:'0.5.22-alpha',group:'backpackIL',created_at:'2026-10-27T12:00:00Z',job_summary:{id:'e2e-b0001',stage:'done',deep_errors:0,discovery_order:['1700000000000001'],last_collected_post_id:'1700000000000001'},posts:[{post_id:'1700000000000001',post_text:'camping family route',permalink:'https://www.facebook.com/groups/backpackIL/posts/1700000000000001/',deep:{status:'captured_unverified'},comments:[{id:'1770000000000001',author:'Test Person',text:'camping '.repeat(800)},{id:'1770000000000002',parent_id:'1770000000000001',author:'Other Tester',text:'reply route with children'}]}]};
 const file=path.join(dir,'batch.json');await fs.writeFile(file,JSON.stringify(batch));
 const importFile=()=>new Promise((resolve,reject)=>{
  const child=spawn(process.env.PYTHON||'python',['verified_import.py',file,'--apply','--url',base,'--receipts',path.join(dir,'receipts')],{cwd:new URL('.',import.meta.url),env:{...process.env,BUR_STAGING_SECRET:'staging-test-key'}});
  let out='',error='';child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>error+=x);
  child.on('error',reject);child.on('close',code=>code===0?resolve(JSON.parse(out)):reject(Error(error)));
 });
 const receipt=await importFile();assert.equal(receipt.verified,true);await importFile();
 assert.equal((await db.query('select count(*) n from archive.posts')).rows[0].n,1);
 assert.equal((await db.query('select count(*) n from archive.comments')).rows[0].n,2);
 assert.equal((await db.query('select count(*) n from archive.comments where parent_comment_id is not null')).rows[0].n,1);
 assert.equal((await db.query('select count(*) n from archive.crawl_runs')).rows[0].n,1);
 const vec=Array(768).fill(0);vec[0]=1;
 const rpc=stagingClient(base,'staging-test-key');
 const indexed=await indexBatch(batch,{rpc,embed:async()=>vec});assert.equal(indexed.ready,true);
 const repeated=await indexBatch(batch,{rpc,embed:async()=>{throw Error('should not re-embed');}});assert.equal(repeated.ready,true);assert.equal(repeated.stored,0);
 const gid=(await db.query("select id from archive.groups where slug='backpackIL'")).rows[0].id;
 await db.query('insert into bur_access.group_members values($1,$2)',['00000000-0000-0000-0000-000000000100',gid]);
 const handler=createHandler({env:{SUPABASE_URL:base,SUPABASE_SERVICE_ROLE_KEY:'staging-test-key',ALLOWED_ORIGIN:'https://portal.example'}});
 const request=new Request('http://localhost/search',{method:'POST',headers:{authorization:'Bearer session-test',origin:'https://portal.example'},body:JSON.stringify({group:'backpackIL',query:'camping',semantic:false})});
 const response=await handler(request);assert.equal(response.status,200);const results=await response.json();assert.ok(results.results.length>=2);assert.ok(results.results.every(x=>x.post_id==='1700000000000001'));
 assert.equal((await handler(new Request('http://localhost/search',{method:'POST',body:'{}'}))).status,401);
 console.log('PASS local E2E: raw JSON -> hash-verified Storage -> actual archive import -> receipt -> repeat/no duplicates -> reply relations -> chunks -> leased embeddings -> authorized API -> keyword results');
 console.log(JSON.stringify({posts:1,comments:2,search_units:indexed.units,embeddings:indexed.embedded,provider:'deterministic TEST VECTORS; not a live semantic-quality test'}));
}finally{
 if(server)await new Promise(resolve=>server.close(resolve));await db.close();
 if(path.basename(dir).startsWith('bur-e2e-'))await fs.rm(dir,{recursive:true,force:true});
}
