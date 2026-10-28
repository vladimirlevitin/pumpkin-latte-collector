-- STAGING ONLY. Server-side workers exclusively; no browser/service key sharing.
begin;
create table if not exists bur_access.embedding_jobs(
 unit_id uuid not null references archive.search_units(id),model text not null,
 lease_id uuid,lease_until timestamptz,source_hash text,
 primary key(unit_id,model)
);
alter table bur_access.embedding_jobs enable row level security;
grant select,insert,update on bur_access.embedding_jobs to service_role;

create or replace function public.bur_stage_prepare_units(p_group text,p_post_ids text[],p_units jsonb)
returns integer language plpgsql security invoker set search_path='' as $$
declare gid uuid; row jsonb; pid uuid; sid uuid; changed integer:=0;
begin
 select id into gid from archive.groups where slug=p_group;
 if gid is null then raise exception 'unknown_group';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_group,0));
 if jsonb_typeof(p_units)<>'array' then raise exception 'invalid_units';end if;
 update archive.search_units s set metadata=coalesce(s.metadata,'{}'::jsonb)||'{"bur_retired":true}'::jsonb
 from archive.posts p where s.post_id=p.id and p.group_id=gid and p.facebook_post_id=any(p_post_ids)
 and s.metadata ? 'bur_chunk_key';
 for row in select value from jsonb_array_elements(p_units) loop
  if not (row->>'post_id'=any(p_post_ids)) or row->>'source_hash' !~ '^[0-9a-f]{64}$'
   or row->>'unit_type' not in ('post','comment') or length(row->>'text')>10000 then raise exception 'invalid_unit';end if;
  select id into pid from archive.posts where group_id=gid and facebook_post_id=row->>'post_id';
  if pid is null then raise exception 'post_not_imported';end if;
  select id into sid from archive.search_units where post_id=pid and metadata->>'bur_chunk_key'=row->>'key' for update;
  if sid is null then
   insert into archive.search_units(unit_type,post_id,text_content,content_for_embedding,source_hash,metadata,embedding_status)
   values(row->>'unit_type',pid,row->>'text',row->>'text',row->>'source_hash',coalesce(row->'metadata','{}'::jsonb)||jsonb_build_object('bur_chunk_key',row->>'key','bur_retired',false),'pending');
  else
   update archive.search_units set text_content=row->>'text',content_for_embedding=row->>'text',
    embedding_status=case when source_hash=row->>'source_hash' then embedding_status else 'pending' end,
    source_hash=row->>'source_hash',metadata=coalesce(metadata,'{}'::jsonb)||coalesce(row->'metadata','{}'::jsonb)||jsonb_build_object('bur_chunk_key',row->>'key','bur_retired',false)
   where id=sid;
  end if;
  changed:=changed+1;
 end loop;
 return changed;
end;
$$;

create or replace function public.bur_stage_claim_embeddings(p_group text,p_lease uuid,p_limit integer default 5)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_group,0));
 with candidates as (
  select s.id,s.source_hash from archive.search_units s join archive.posts p on p.id=s.post_id
  join archive.groups g on g.id=p.group_id
  left join bur_access.embedding_jobs j on j.unit_id=s.id and j.model='gemini-embedding-2-text-768'
  where g.slug=p_group and s.metadata->>'bur_retired' is distinct from 'true'
   and coalesce(s.content_for_embedding,'')<>'' and (j.lease_until is null or j.lease_until<now())
   and not exists(select 1 from archive.embeddings e where e.search_unit_id=s.id and e.model='gemini-embedding-2-text-768' and e.source_hash=s.source_hash)
  order by s.id limit greatest(1,least(10,p_limit)) for update of s skip locked
 ), claimed as (
  insert into bur_access.embedding_jobs(unit_id,model,lease_id,lease_until,source_hash)
  select id,'gemini-embedding-2-text-768',p_lease,now()+interval '5 minutes',source_hash from candidates
  on conflict(unit_id,model) do update set lease_id=excluded.lease_id,lease_until=excluded.lease_until,source_hash=excluded.source_hash
  returning unit_id,source_hash
 ) select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'text',s.content_for_embedding,'source_hash',c.source_hash)),'[]'::jsonb)
 into result from claimed c join archive.search_units s on s.id=c.unit_id;
 return result;
end;
$$;

create or replace function public.bur_stage_store_embedding(p_unit uuid,p_lease uuid,p_source_hash text,p_vector jsonb)
returns boolean language plpgsql security invoker set search_path='' as $$
declare current_hash text; job bur_access.embedding_jobs%rowtype;
begin
 select source_hash into current_hash from archive.search_units where id=p_unit for update;
 select * into job from bur_access.embedding_jobs where unit_id=p_unit and model='gemini-embedding-2-text-768' for update;
 if p_lease is null or job.lease_id is null or job.lease_id is distinct from p_lease or job.lease_until<now() or current_hash is distinct from p_source_hash then return false;end if;
 if jsonb_array_length(p_vector)<>768 or extensions.vector_norm((p_vector::text)::extensions.vector)=0 then raise exception 'invalid_vector';end if;
 insert into archive.embeddings(search_unit_id,provider,model,dimensions,embedding,source_hash)
 values(p_unit,'google','gemini-embedding-2-text-768',768,(p_vector::text)::extensions.vector,p_source_hash)
 on conflict(search_unit_id,provider,model,source_hash) do nothing;
 update archive.search_units set embedding_status='ready' where id=p_unit;
 update bur_access.embedding_jobs set lease_id=null,lease_until=null where unit_id=p_unit and model='gemini-embedding-2-text-768';
 return true;
end;
$$;
revoke all on function public.bur_stage_prepare_units(text,text[],jsonb) from public,anon,authenticated;
revoke all on function public.bur_stage_claim_embeddings(text,uuid,integer) from public,anon,authenticated;
revoke all on function public.bur_stage_store_embedding(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.bur_stage_prepare_units(text,text[],jsonb) to service_role;
grant execute on function public.bur_stage_claim_embeddings(text,uuid,integer) to service_role;
grant execute on function public.bur_stage_store_embedding(uuid,uuid,text,jsonb) to service_role;
create or replace function public.bur_stage_index_status(p_group text)
returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('units',count(*),'embedded',count(*) filter(where exists(
  select 1 from archive.embeddings e where e.search_unit_id=s.id and e.source_hash=s.source_hash and e.model='gemini-embedding-2-text-768'
 )), 'leased',count(*) filter(where exists(select 1 from bur_access.embedding_jobs j where j.unit_id=s.id and j.lease_until>now())))
 from archive.search_units s join archive.posts p on p.id=s.post_id join archive.groups g on g.id=p.group_id
 where g.slug=p_group and s.metadata->>'bur_retired' is distinct from 'true';
$$;
revoke all on function public.bur_stage_index_status(text) from public,anon,authenticated;
grant execute on function public.bur_stage_index_status(text) to service_role;
commit;
