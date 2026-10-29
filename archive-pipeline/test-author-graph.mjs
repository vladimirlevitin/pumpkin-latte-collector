// Actual PostgreSQL + real Python importer/watcher. HTTP is a local Supabase transport fixture.
import {PGlite} from '@electric-sql/pglite';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import http from 'node:http';import crypto from 'node:crypto';import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';import assert from 'node:assert/strict';
import {indexBatch} from './index-worker.mjs';
const require=createRequire(import.meta.url),G=require('../bur-extension/candidate/archive-graph.js');
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'bur-graph-')),db=new PGlite(),objects=new Map();
let server,failReadback=true;const group='graph-fixture',stamp='2026-10-29T10:00:00Z';
const pid=n=>'170000000000000'+n,basePost=n=>({group,post_id:pid(n),post_text:'Source post '+n,permalink:'https://www.facebook.com/groups/'+group+'/posts/'+pid(n)+'/',snapshot_at:stamp});
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const count=async table=>Number((await db.query('select count(*) n from archive.'+table)).rows[0].n);
async function batch(id,posts,mode='history'){
 const graph=await G.enrich(posts,group);
 return {schema:'bur-collector/1',relational_schema:'bur-author-graph/1',collector_version:'0.5.24-alpha',group,created_at:stamp,
  job_summary:{id,stage:'done',collection_mode:mode,update_baseline:false,deep_done:posts.length,deep_errors:0,feed_order:{verified:true,order:'new_posts'},discovery_order:posts.map(p=>p.post_id)},...graph};
}
async function python(args){return new Promise((resolve,reject)=>{
 const child=spawn(process.env.PYTHON||'python',args,{cwd:new URL('.',import.meta.url),env:{...process.env,PYTHONIOENCODING:'utf-8',BUR_STAGING_SECRET:'local-test-key'}});
 let stdout='',stderr='';child.stdout.on('data',v=>stdout+=v);child.stderr.on('data',v=>stderr+=v);child.on('error',reject);child.on('close',code=>resolve({code,stdout,stderr}));
});}
try{
 // pgvector/search are unrelated to this contract; all author/post/comment columns
 // and constraints use the inspected schema unchanged. Vector type is unused here.
 let schema=await fs.readFile(new URL('./fixtures/schema.sql',import.meta.url),'utf8');
 schema=schema.replace('create extension vector with schema extensions;','').replaceAll('extensions.vector(768)','real[]');
 await db.exec(schema);
 for(const name of ['fixtures/existing-import.sql','staging-receipt.sql','staging-author-graph.sql'])await db.exec(await fs.readFile(new URL(name,import.meta.url),'utf8'));
 const allowed=new Set(['bur_import_archived_graph','bur_verify_graph_receipt']);
 server=http.createServer(async(req,res)=>{
  const reply=(status,data)=>{res.writeHead(status,{'content-type':'application/json'});res.end(Buffer.isBuffer(data)?data:JSON.stringify(data));};
  try{
   if(req.headers.apikey!=='local-test-key'){reply(401,{});return;}
   let text='';for await(const chunk of req)text+=chunk;
   if(req.url.startsWith('/storage/v1/object/')){
    const key=decodeURIComponent(req.url.replace('/storage/v1/object/','').replace(/^authenticated\//,''));
    if(req.method==='POST'){
     if(objects.has(key)){reply(409,{});return;}
     objects.set(key,Buffer.from(text));await db.query('insert into storage.objects values($1,$2)',['bur-raw',key.replace(/^bur-raw\//,'')]);reply(200,{});
    }else reply(objects.has(key)?200:404,objects.get(key)||{});
    return;
   }
   const name=req.url.split('/').at(-1);if(!allowed.has(name)){reply(404,{});return;}
   const body=JSON.parse(text),keys=Object.keys(body);assert.ok(keys.every(k=>/^[_a-z][_a-z0-9]*$/.test(k)));
   await db.exec('set role service_role');
   try{
    const params=keys.map(k=>body[k]!==null&&typeof body[k]==='object'&&!Array.isArray(body[k])?JSON.stringify(body[k]):body[k]);
    const result=(await db.query('select public.'+name+'('+keys.map((k,i)=>k+'=>$'+(i+1)).join(',')+') r',params)).rows[0].r;
    if(name==='bur_verify_graph_receipt'&&failReadback){failReadback=false;result.relational_verified=false;}
    reply(200,result);
   }finally{await db.exec('reset role');}
  }catch(error){console.error('local graph SQL:',error.code,error.message);reply(500,{error:'fixture SQL failure'});}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+server.address().port;
 const original=await batch('graph-b1',[
  {...basePost(1),author:'Post Author',author_url:'https://www.facebook.com/groups/123/user/101/',published_at:stamp,media:[{kind:'image',url:'https://example.org/post.jpg'}],comments:[
   {id:'1770000000000002',parent_id:'1770000000000001',author:'Same Label',text:'Reply preserves https://example.org/reply',links:[{url:'https://example.org/reply',text:'map'}],media:[{kind:'image',url:'https://example.org/comment.jpg'}],published_at:'2026-10-29T10:02:00Z',commented_at:null},
   {id:'1770000000000001',author:'Parent Author',author_url:'https://www.facebook.com/profile.php?id=202',text:'Parent'}]},
  {...basePost(2),author:'Same Label',comments:[]}
 ]);
 const file=path.join(dir,'bur-raw-graph-b1.json'),state=path.join(dir,'watch.json');await fs.writeFile(file,JSON.stringify(original));
 const watch=()=>python(['watch_staging.py',dir,'--url',url,'--state',state,'--once']);
 // Remote commit succeeds, graph readback is lost. No local ready state may be written.
 let outcome=await watch();assert.equal(outcome.code,0,outcome.stderr);assert.ok(JSON.parse(outcome.stdout.trim()).ready===false,outcome.stdout);assert.equal(await count('crawl_runs'),1);
 outcome=await watch();assert.equal(outcome.code,0,outcome.stderr);assert.ok(JSON.parse(outcome.stdout.trim()).ready===true,outcome.stdout);
 assert.equal(await count('posts'),2);assert.equal(await count('comments'),2);assert.equal(await count('authors_private'),4);assert.equal(await count('crawl_runs'),1);
 const post=(await db.query('select * from archive.posts where facebook_post_id=$1',[pid(1)])).rows[0];assert.ok(post.author_id);assert.equal(post.raw_metadata.media[0].url,'https://example.org/post.jpg');
 const reply=(await db.query("select * from archive.comments where facebook_comment_id='1770000000000002'")).rows[0];
 const parent=(await db.query("select * from archive.comments where facebook_comment_id='1770000000000001'")).rows[0];
 assert.equal(reply.parent_comment_id,parent.id);assert.equal(reply.depth,1);assert.ok(reply.author_id);assert.equal(new Date(reply.commented_at).toISOString(),'2026-10-29T10:02:00.000Z');
 assert.equal(reply.raw_metadata.links[0].url,'https://example.org/reply');assert.equal(reply.raw_metadata.media[0].url,'https://example.org/comment.jpg');
 assert.equal((await db.query("select count(*) n from archive.authors_private where display_name='Same Label'")).rows[0].n,2,'a label alone must not merge people');
 const originalText=post.text,originalAuthor=post.author_id;
 const delta=await batch('graph-b2',[
  {...basePost(1),author:'Do not refresh old author',author_url:'https://www.facebook.com/profile.php?id=101',post_text:'Do not replace old post',comments:[{id:'late-comment',author:'Ignored',author_url:'https://www.facebook.com/profile.php?id=777',text:'Old discussion must not refresh'}]},
  {...basePost(3),author:'New Author',author_url:'https://www.facebook.com/profile.php?id=303',comments:[]}
 ],'update');
 await fs.writeFile(path.join(dir,'bur-raw-graph-b2.json'),JSON.stringify(delta));outcome=await watch();assert.equal(outcome.code,0,outcome.stderr);assert.ok(JSON.parse(outcome.stdout.trim()).ready,outcome.stdout);
 assert.equal(await count('posts'),3);assert.equal(await count('comments'),2);assert.equal(await count('authors_private'),5);assert.equal(await count('crawl_runs'),2);
 const unchanged=(await db.query('select * from archive.posts where id=$1',[post.id])).rows[0];assert.equal(unchanged.text,originalText);assert.equal(unchanged.author_id,originalAuthor);
 assert.deepEqual(unchanged,post,'mixed delta must preserve the entire skipped post');
 assert.equal((await db.query('select display_name from archive.authors_private where id=$1',[originalAuthor])).rows[0].display_name,'Post Author');
 const allExisting=await batch('graph-b3',[delta.posts[0]],'update');await fs.writeFile(path.join(dir,'bur-raw-graph-b3.json'),JSON.stringify(allExisting));
 outcome=await watch();assert.equal(outcome.code,0,outcome.stderr);assert.ok(JSON.parse(outcome.stdout.trim()).ready,outcome.stdout);assert.equal(await count('comments'),2);assert.equal(await count('authors_private'),5);
 assert.deepEqual((await db.query('select * from archive.posts where id=$1',[post.id])).rows[0],unchanged,'an all-existing delta must preserve the entire old post, including raw comments and timestamps');
 // The actual SQL receipt, not the unfiltered raw batch, decides which posts
 // may reach the indexer. Existing discussions must not be rewritten there.
 async function indexable(batch,digest){
  return (await db.query('select public.bur_graph_indexable_posts($1,$2,$3,$4) ids',[group,batch.job_summary.id,batch.collector_version,digest])).rows[0].ids;
 }
 const deltaHash=sha(Buffer.from(JSON.stringify(delta))),existingHash=sha(Buffer.from(JSON.stringify(allExisting)));
 assert.deepEqual(await indexable(delta,deltaHash),[pid(3)]);
 assert.deepEqual(await indexable(allExisting,existingHash),[]);
 await assert.rejects(()=>indexable(delta,'f'.repeat(64)));
 let prepared=null;
 const rpc=async(name,args)=>{
  if(name==='bur_graph_indexable_posts')return indexable(args.p_batch_id===delta.job_summary.id?delta:allExisting,args.p_sha256);
  if(name==='bur_stage_prepare_units'){prepared=args;return true;}
  if(name==='bur_stage_claim_embeddings')return [];
  if(name==='bur_stage_index_status')return {units:1,embedded:1};
  throw Error('Unexpected index RPC '+name);
 };
 await indexBatch(delta,{rpc,sourceSha256:deltaHash,embed:()=>{throw Error('unused transport fixture');}});
 assert.deepEqual(prepared.p_post_ids,[pid(3)]);assert.ok(prepared.p_units.length>0);
 prepared=null;
 const noChange=await indexBatch(allExisting,{rpc,sourceSha256:existingHash});
 assert.equal(noChange.ready,true);assert.equal(noChange.units,0);assert.equal(prepared,null);
 // SQL failure after the legacy insert must roll back every canonical write.
 const bad=await batch('graph-bad',[{...basePost(4),author:'Atomic Author',author_url:'https://www.facebook.com/profile.php?id=404',comments:[]}]);bad.posts[0].author_key='author:'+'f'.repeat(64);
 const raw=Buffer.from(JSON.stringify(bad)),digest=sha(raw),storagePath=group+'/'+digest+'.json';await db.query('insert into storage.objects values($1,$2)',['bur-raw',storagePath]);
 await db.exec('set role service_role');
 await assert.rejects(()=>db.query('select public.bur_import_archived_graph($1,$2,$3,$4,$5)',[JSON.stringify(bad),'bad.json','bur-raw',storagePath,digest]),/dangling_author_reference/);
 await db.exec('reset role');assert.equal(await count('posts'),3);assert.equal(await count('authors_private'),5);assert.equal(await count('crawl_runs'),3);
 for(const role of ['anon','authenticated']){
  await db.exec('set role '+role);await assert.rejects(()=>db.query('select public.bur_import_archived_graph($1,$2,$3,$4,$5)',[JSON.stringify(original),'x','bur-raw','x','a'.repeat(64)]),/permission denied/);await db.exec('reset role');
 }
 console.log('PASS actual PostgreSQL + Python watcher: exact raw/hash, post/comment authors, scoped labels, comment date/links/media, reply-before-parent, lost graph readback/restart/idempotency, new-only delta/all-existing delta, atomic rollback and denied public roles');
}finally{
 if(server)await new Promise(resolve=>server.close(resolve));await db.close();
 if(path.dirname(path.resolve(dir))===path.resolve(os.tmpdir())&&path.basename(dir).startsWith('bur-graph-'))await fs.rm(dir,{recursive:true,force:true});
}
