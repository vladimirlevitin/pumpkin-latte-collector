import {PGlite} from '@electric-sql/pglite';
import {vector} from '@electric-sql/pglite-pgvector';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {chunks,prepareUnits} from './chunks.mjs';
const db=new PGlite({extensions:{vector}}),uuid=n=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0');
try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema archive;create schema bur_access;create schema extensions;create extension vector with schema extensions;
 create table archive.groups(id uuid primary key,slug text);
 create table archive.posts(id uuid primary key,group_id uuid,facebook_post_id text);
 create table archive.search_units(id uuid primary key default gen_random_uuid(),post_id uuid,unit_type text,text_content text,content_for_embedding text,source_hash text,metadata jsonb,embedding_status text);
 create table archive.embeddings(id uuid primary key default gen_random_uuid(),search_unit_id uuid,provider text,model text,source_hash text,dimensions int,embedding extensions.vector(768),unique(search_unit_id,provider,model,source_hash));
 grant usage on schema archive,bur_access,extensions to service_role;grant all on all tables in schema archive to service_role;`);
 await db.exec(await fs.readFile(new URL('./staging-index.sql',import.meta.url),'utf8'));
 await db.query('insert into archive.groups values($1,$2)',[uuid(1),'one']);
 await db.query('insert into archive.posts values($1,$2,$3)',[uuid(2),uuid(1),'1700000000000001']);
 const long='A😀 route '.repeat(1500);
 const segments=chunks(long);let rebuilt=segments[0].text;
 for(let i=1;i<segments.length;i++)rebuilt+=Array.from(segments[i].text).slice(200).join('');
 assert.equal(rebuilt,long,'no lost characters in long comments');
 const batch={schema:'bur-collector/1',group:'one',posts:[{post_id:'1700000000000001',post_text:'camping',comments:[{id:'comment1',parent_id:'parent1',text:long}],deep:{status:'captured_unverified'}}]};
 const units=prepareUnits(batch);assert.ok(units.length>6);assert.ok(units.some(x=>x.metadata.parent_comment_id==='parent1'));
 const prepare=async u=>db.query('select public.bur_stage_prepare_units($1,$2,$3)', ['one',['1700000000000001'],JSON.stringify(u)]);
 await db.exec('set role service_role');
 await prepare(units);await prepare(units);
 assert.equal((await db.query('select count(*) n from archive.search_units')).rows[0].n,units.length);
 const claim=async(lease,limit=10)=>(await db.query('select public.bur_stage_claim_embeddings($1,$2,$3) r',['one',lease,limit])).rows[0].r;
 const first=await claim(uuid(10),1),second=await claim(uuid(11),1);assert.equal(first.length,1);assert.notEqual(first[0].id,second[0].id);
 const v=Array(768).fill(0);v[0]=1;
 const store=async item=>(await db.query('select public.bur_stage_store_embedding($1,$2,$3,$4) r',[item.id,uuid(10),item.source_hash,JSON.stringify(v)])).rows[0].r;
 assert.equal(await store(first[0]),true);assert.equal(await store(first[0]),false,'consumed lease cannot write twice');
 assert.equal((await db.query('select count(*) n from archive.embeddings')).rows[0].n,1);
 // Crash/timeout leaves a lease. Expiry makes it claimable without deleting content.
 await db.query("update bur_access.embedding_jobs set lease_until=now()-interval '1 second' where lease_id=$1",[uuid(11)]);
 assert.ok((await claim(uuid(12))).some(x=>x.id===second[0].id));
 // Updating content invalidates a previously claimed source and retires removed chunks.
 batch.posts[0].post_text='updated route';batch.posts[0].comments=[];
 await prepare(prepareUnits(batch));assert.equal(await store(second[0]),false);
 const active=(await db.query("select count(*) n from archive.search_units where metadata->>'bur_retired'='false'")).rows[0].n;
 assert.equal(active,1);assert.equal((await db.query('select count(*) n from archive.search_units')).rows[0].n,units.length);
 await db.exec('reset role;set role anon');await assert.rejects(()=>claim(uuid(13)),/permission denied/);
 console.log('PASS chunk reconstruction, replies, repeat preparation, leases, embedding commit, stale result rejection, retirement without deletion, anon denied');
}finally{await db.close();}
