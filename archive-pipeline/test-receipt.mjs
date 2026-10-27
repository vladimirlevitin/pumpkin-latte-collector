import {PGlite} from '@electric-sql/pglite';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const db=new PGlite();
try{
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema archive;
 create table archive.groups(id uuid primary key,slug text);
 create table archive.crawl_runs(id uuid primary key,group_id uuid references archive.groups,source_file_sha256 text,storage_bucket text,status text);
 create table archive.posts(id uuid primary key,group_id uuid,facebook_post_id text);
 create table archive.crawl_run_posts(crawl_run_id uuid,post_id uuid);
 insert into archive.groups values('00000000-0000-0000-0000-000000000001','one'),('00000000-0000-0000-0000-000000000002','two');
 insert into archive.crawl_runs values('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001','abc','bur-raw','done');
 insert into archive.posts values('00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000001','1700000000000001');
 insert into archive.crawl_run_posts values('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000020');`);
 await db.exec(await fs.readFile(new URL('./staging-receipt.sql',import.meta.url),'utf8'));
 const run='00000000-0000-0000-0000-000000000010';
 const check=async(group,sha,ids)=> (await db.query('select public.bur_verify_import_receipt($1,$2,$3,$4) as r',[run,group,sha,ids])).rows[0].r;
 assert.deepEqual(await check('one','abc',['1700000000000001']),{verified:true,post_count:1});
 assert.equal((await check('two','abc',['1700000000000001'])).verified,false);
 assert.equal((await check('one','wrong',['1700000000000001'])).verified,false);
 assert.equal((await check('one','abc',['1700000000000002'])).verified,false);
 assert.equal((await check('one','abc',[])).verified,false);
 await db.exec('set role anon');
 await assert.rejects(()=>check('one','abc',['1700000000000001']),/permission denied/);
 await db.exec('reset role;set role authenticated');
 await assert.rejects(()=>check('one','abc',['1700000000000001']),/permission denied/);
 console.log('PASS PostgreSQL receipt SQL: exact IDs/hash/group/count, missing records, denied anon/authenticated');
}finally{await db.close();}
