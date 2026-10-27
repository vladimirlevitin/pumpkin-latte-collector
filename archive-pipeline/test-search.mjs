import {PGlite} from '@electric-sql/pglite';
import {vector} from '@electric-sql/pglite-pgvector';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const db=new PGlite({extensions:{vector}});
const uuid=n=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0');
try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema extensions;create extension vector with schema extensions;create schema archive;
 create table archive.groups(id uuid primary key,slug text);
 create table archive.posts(id uuid primary key,group_id uuid,facebook_post_id text,canonical_url text,posted_at timestamptz,deleted_at timestamptz);
 create table archive.search_units(id uuid primary key,post_id uuid,text_content text,source_hash text,metadata jsonb);
 create table archive.embeddings(search_unit_id uuid,source_hash text,embedding extensions.vector(768),dimensions int,model text);
 create table archive.topics(id bigint primary key,slug text,name text);
 create table archive.search_unit_topics(search_unit_id uuid,topic_id bigint);
 grant usage on schema archive,extensions to service_role;
 grant select on all tables in schema archive to service_role;`);
 await db.exec(await fs.readFile(new URL('./staging-search.sql',import.meta.url),'utf8'));
 for(let i=1;i<=2;i++){
  await db.query('insert into archive.groups values($1,$2)',[uuid(i),'group'+i]);
  await db.query('insert into archive.posts values($1,$2,$3,$4,null,null)',[uuid(10+i),uuid(i),'170000000000000'+i,'https://www.facebook.com/groups/group'+i+'/posts/170000000000000'+i+'/']);
  await db.query('insert into archive.search_units values($1,$2,$3,$4,$5)',[uuid(20+i),uuid(10+i),i===1?'hiking family camping':'private unrelated group','hash'+i,{capture_status:'captured_unverified'}]);
  const v=Array(768).fill(0);v[0]=1;
  await db.query('insert into archive.embeddings values($1,$2,$3,768,$4)',[uuid(20+i),'hash'+i,JSON.stringify(v),'gemini-embedding-2-text-768']);
 }
 await db.query('insert into bur_access.group_members values($1,$2)',[uuid(100),uuid(1)]);
 await db.exec("insert into archive.topics values(1,'camp','Camping');");
 await db.query('insert into archive.search_unit_topics values($1,1)',[uuid(21)]);
 const search=async(group,q,v=null,topics=null)=>(await db.query('select public.bur_archive_search($1,$2,$3,$4,$5,20) r',[uuid(100),group,q,v===null?null:JSON.stringify(v),topics])).rows[0].r;
 await db.exec('set role service_role');
 const lex=await search('group1','camping');assert.equal(lex.results.length,1);assert.equal(lex.semantic_used,false);
 const v=Array(768).fill(0);v[0]=1;
 const hybrid=await search('group1','camping',v);assert.equal(hybrid.results.length,1);
 assert.equal(hybrid.results[0].post_id,'1700000000000001');assert.equal(hybrid.results[0].capture_status,'captured_unverified');
 assert.ok(hybrid.results[0].score>lex.results[0].score);
 assert.deepEqual(hybrid.results[0].topics,['Camping']);
 assert.equal((await search('group1','camping',v,['other'])).results.length,0);
 await assert.rejects(()=>search('group2','private',v),/group_access_denied/);
 await assert.rejects(()=>search('group1','camping',[1,0]),/invalid_vector_dimensions/);
 await db.exec('reset role;set role anon');await assert.rejects(()=>search('group1','camping'),/permission denied/);
 console.log('PASS PostgreSQL + pgvector: hybrid RRF, lexical fallback, topics, exact source, group isolation, anon denied, dimension guard');
}finally{await db.close();}
