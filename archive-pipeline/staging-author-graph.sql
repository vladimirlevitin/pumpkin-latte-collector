-- Isolated staging contract, NOT applied to production. Existing import snapshot stays intact.
begin;
create schema if not exists bur_stage;
revoke all on schema bur_stage from public,anon,authenticated;
grant usage on schema bur_stage to service_role;
create or replace function bur_stage.merge_owner(old_value jsonb,new_value jsonb)
returns jsonb language sql immutable security invoker set search_path='' as $$
 select coalesce(old_value,'{}') || coalesce(new_value,'{}') || jsonb_build_object(
  'media',coalesce((select jsonb_agg(distinct item) from jsonb_array_elements((case when jsonb_typeof(old_value->'media')='array' then old_value->'media' else '[]' end) || (case when jsonb_typeof(new_value->'media')='array' then new_value->'media' else '[]' end)) item),'[]'),
  'links',coalesce((select jsonb_agg(distinct item) from jsonb_array_elements((case when jsonb_typeof(old_value->'links')='array' then old_value->'links' else '[]' end) || (case when jsonb_typeof(new_value->'links')='array' then new_value->'links' else '[]' end)) item),'[]')
 );
$$;
revoke all on function bur_stage.merge_owner(jsonb,jsonb) from public,anon,authenticated;
grant execute on function bur_stage.merge_owner(jsonb,jsonb) to service_role;

create or replace function public.bur_import_archived_graph(
 payload jsonb,source_filename text,storage_bucket text,storage_path text,source_file_sha256 text
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare
 g text := payload->>'group'; gid uuid; rid uuid; prior archive.crawl_runs%rowtype;
 v_batch_key text; canonical_hash text; result jsonb; clean_payload jsonb;
 source_post jsonb; source_comment jsonb; a jsonb; clean_post jsonb; clean_comments jsonb;
 clean_posts jsonb := '[]'; clean_order jsonb := '[]';
 used_keys jsonb := '{}'; seen_keys jsonb := '{}'; author_map jsonb := '{}';
 skipped jsonb := '[]'; comment_ids jsonb := '[]'; post_comments jsonb;
 v_post_db uuid; comment_id uuid; parent_id uuid; author_id uuid; external_id text; k text; v_ordinal integer;
 mode text := coalesce(payload #>> '{job_summary,collection_mode}','history');
 baseline boolean := coalesce((payload #>> '{job_summary,update_baseline}')::boolean,false);
 source_key text; post_key text; parent_key text; comment_map jsonb; current_post archive.posts%rowtype;
 first_source jsonb; seen_at timestamptz; skipped_count integer := 0;
begin
 if payload->>'schema' is distinct from 'bur-collector/1' or payload->>'relational_schema' is distinct from 'bur-author-graph/1' then raise exception 'unsupported_relational_schema'; end if;
 if g is null or g !~ '^[A-Za-z0-9._-]{1,128}$' or mode not in ('history','update') then raise exception 'invalid_group_or_mode'; end if;
 if jsonb_typeof(payload->'authors') is distinct from 'array' or jsonb_typeof(payload->'posts') is distinct from 'array' or jsonb_array_length(payload->'posts')=0 then raise exception 'missing_relational_arrays'; end if;
 if payload #>> '{job_summary,stage}' is distinct from 'done' then raise exception 'incomplete_batch'; end if;
 if storage_bucket is distinct from 'bur-raw' or source_file_sha256 is null or source_file_sha256 !~ '^[a-f0-9]{64}$' or storage_path is distinct from g || '/' || source_file_sha256 || '.json' then raise exception 'invalid_exact_source'; end if;
 if not exists(select 1 from storage.objects o where o.bucket_id=storage_bucket and o.name=storage_path) then raise exception 'storage_object_missing'; end if;
 -- Lock this group before deciding which delta posts are already present.
 insert into archive.groups(platform,slug,name,canonical_url) values('facebook',g,g,'https://www.facebook.com/groups/'||g||'/')
 on conflict(platform,slug) where slug is not null do update set slug=excluded.slug returning id into gid;
 v_batch_key := 'bur:'||g||':'||(payload->>'collector_version')||':'||(payload #>> '{job_summary,id}');
 if v_batch_key is null then raise exception 'missing_batch_identity'; end if;
 canonical_hash := encode(extensions.digest(convert_to(payload::text,'UTF8'),'sha256'),'hex');
 select * into prior from archive.crawl_runs r where r.group_id=gid and r.batch_key=v_batch_key;
 if found then
  if prior.source_file_sha256 is distinct from source_file_sha256 or prior.source_sha256 is distinct from canonical_hash then raise exception 'batch_identity_conflict'; end if;
  if prior.stats->>'relational_schema' is distinct from 'bur-author-graph/1' or prior.status<>'done' then raise exception 'batch_requires_review'; end if;
  return jsonb_build_object('ok',true,'reused',true,'crawl_run_id',prior.id,'archived',true,'storage_path',storage_path,'source_file_sha256',source_file_sha256,'relational_schema','bur-author-graph/1');
 end if;
 for source_post in select value from jsonb_array_elements(payload->'posts') loop
  if source_post->>'post_id' is null or source_post->>'post_id' !~ '^[0-9]{8,30}$' or coalesce(source_post->>'group',g)<>g then raise exception 'invalid_post_identity'; end if;
  post_key := g||'|post:'||(source_post->>'post_id');
  if source_post->>'key' is distinct from post_key then raise exception 'invalid_post_key'; end if;
  if mode='update' and not baseline and exists(select 1 from archive.posts p where p.group_id=gid and p.facebook_post_id=source_post->>'post_id') then
   skipped := skipped || jsonb_build_array(source_post->>'post_id'); skipped_count := skipped_count+1; continue;
  end if;
  if nullif(source_post->>'author_key','') is not null then used_keys:=used_keys||jsonb_build_object(source_post->>'author_key',true); end if;
  clean_comments := '[]';
  for source_comment in select value from jsonb_array_elements(coalesce(source_post->'comments','[]')) loop
   if source_comment->>'post_key' is distinct from post_key or source_comment->>'key' is null or position(post_key||'|' in source_comment->>'key')<>1 then raise exception 'invalid_comment_owner'; end if;
   if nullif(source_comment->>'author_key','') is not null then used_keys:=used_keys||jsonb_build_object(source_comment->>'author_key',true); end if;
   -- Legacy import must not create name-based or noncanonical profile identities.
   clean_comments := clean_comments || jsonb_build_array((source_comment-'author'-'author_url')||jsonb_build_object('id',coalesce(nullif(source_comment->>'id',''),source_comment->>'key'),'commented_at',coalesce(nullif(source_comment->'commented_at','null'::jsonb),source_comment->'published_at')));
  end loop;
  clean_post := jsonb_set(source_post,'{comments}',clean_comments);
  clean_posts:=clean_posts||jsonb_build_array(clean_post);clean_order:=clean_order||jsonb_build_array(source_post->>'post_id');
 end loop;
 -- All-existing deltas still get a source receipt. Reuse one unchanged post as a
 -- legacy run anchor; no existing discussion or author evidence is refreshed.
 if jsonb_array_length(clean_posts)=0 then
  first_source := payload->'posts'->0;
  select * into current_post from archive.posts p where p.group_id=gid and p.facebook_post_id=first_source->>'post_id';
  clean_posts:=jsonb_build_array(coalesce(current_post.raw_metadata,'{}')||jsonb_build_object('post_id',current_post.facebook_post_id,'post_text',current_post.text,'permalink',current_post.canonical_url,'published_at',current_post.posted_at,'first_seen',current_post.first_seen_at,'comments','[]'::jsonb));
  clean_order:=jsonb_build_array(current_post.facebook_post_id);
 end if;
 clean_payload := jsonb_set(jsonb_set(payload,'{posts}',clean_posts),'{job_summary,discovery_order}',clean_order);
 result := public.bur_import_archived_json(clean_payload,source_filename,storage_bucket,storage_path,source_file_sha256);
 rid := (result->>'crawl_run_id')::uuid;
 -- The legacy receipt needs one anchor for an all-existing delta. Restore
 -- every field it can touch: a no-change update must not erase raw comments
 -- or refresh timestamps/content_hash merely to obtain a run receipt.
 if jsonb_array_length(skipped)=jsonb_array_length(payload->'posts') then
  update archive.posts set posted_at=current_post.posted_at,text=current_post.text,
   canonical_url=current_post.canonical_url,content_hash=current_post.content_hash,
   raw_metadata=current_post.raw_metadata,first_seen_at=current_post.first_seen_at,
   last_seen_at=current_post.last_seen_at,updated_at=current_post.updated_at
  where id=current_post.id;
 end if;
 for a in select value from jsonb_array_elements(payload->'authors') loop
  k:=a->>'key';
  if k is null or k !~ '^author:[a-f0-9]{64}$' or seen_keys ? k then raise exception 'invalid_or_duplicate_author_key'; end if;
  seen_keys:=seen_keys||jsonb_build_object(k,true);
  if mode='update' and not baseline and not (used_keys ? k) then continue; end if;
  if a->>'identity_quality'='facebook_id' then
   if a->>'facebook_author_id' is null or a->>'facebook_author_id' !~ '^[0-9]{1,30}$' or k <> 'author:'||encode(extensions.digest(convert_to(a->>'facebook_author_id','UTF8'),'sha256'),'hex') then raise exception 'invalid_facebook_author'; end if;
   external_id:='id:'||(a->>'facebook_author_id');
  elsif a->>'identity_quality'='profile_url' and a->>'profile_url' ~ '^https://www[.]facebook[.]com/' then external_id:='url:'||md5(lower(a->>'profile_url'));
  elsif a->>'identity_quality'='display_name_only' then external_id:='bur-key:'||k;
  else raise exception 'invalid_author_identity'; end if;
  if nullif(btrim(a->>'display_name'),'') is null then raise exception 'missing_author_name'; end if;
  seen_at:=coalesce(nullif(a->>'last_seen_at','')::timestamptz,nullif(payload->>'created_at','')::timestamptz,now());
  insert into archive.authors_private(group_id,facebook_author_id,display_name,profile_url,first_seen_at,last_seen_at,metadata)
  values(gid,external_id,a->>'display_name',nullif(a->>'profile_url',''),coalesce(nullif(a->>'first_seen_at','')::timestamptz,seen_at),seen_at,a||jsonb_build_object('source_author_key',k))
  on conflict(group_id,facebook_author_id) where facebook_author_id is not null do update set
   display_name=coalesce(excluded.display_name,archive.authors_private.display_name),profile_url=coalesce(excluded.profile_url,archive.authors_private.profile_url),
   first_seen_at=least(archive.authors_private.first_seen_at,excluded.first_seen_at),last_seen_at=greatest(archive.authors_private.last_seen_at,excluded.last_seen_at),metadata=coalesce(archive.authors_private.metadata,'{}')||excluded.metadata
  returning id into author_id;
  author_map:=author_map||jsonb_build_object(k,author_id);
 end loop;
 for k in select jsonb_object_keys(used_keys) loop if not (author_map ? k) then raise exception 'dangling_author_reference'; end if; end loop;
 for source_post in select value from jsonb_array_elements(payload->'posts') loop
  select id into v_post_db from archive.posts p where p.group_id=gid and p.facebook_post_id=source_post->>'post_id';
  if v_post_db is null then raise exception 'missing_imported_post'; end if;
  select ord-1 into v_ordinal from jsonb_array_elements_text(payload #> '{job_summary,discovery_order}') with ordinality item(value,ord) where item.value=source_post->>'post_id';
  if v_ordinal is null then raise exception 'discovery_order_mismatch'; end if;
  if skipped ? (source_post->>'post_id') then
   insert into archive.crawl_run_posts(crawl_run_id,post_id,ordinal,raw_metadata) values(rid,v_post_db,v_ordinal,jsonb_build_object('skipped_existing_new_only',true)) on conflict(crawl_run_id,post_id) do update set ordinal=excluded.ordinal,raw_metadata=archive.crawl_run_posts.raw_metadata||excluded.raw_metadata;
   continue;
  end if;
  update archive.posts p set author_id=coalesce((author_map->>(source_post->>'author_key'))::uuid,p.author_id),raw_metadata=bur_stage.merge_owner(p.raw_metadata,source_post-'comments') where p.id=v_post_db;
  comment_map:='{}';post_comments:='[]';
  for source_comment in select value from jsonb_array_elements(coalesce(source_post->'comments','[]')) loop
   select c.id into comment_id from archive.comments c where c.post_id=v_post_db and c.facebook_comment_id=coalesce(nullif(source_comment->>'id',''),source_comment->>'key');
   if comment_id is null then raise exception 'missing_imported_comment'; end if;
   if comment_map ? (source_comment->>'key') then raise exception 'duplicate_comment_key'; end if;
   comment_map:=comment_map||jsonb_build_object(source_comment->>'key',comment_id);
   post_comments:=post_comments||jsonb_build_array(comment_id);comment_ids:=comment_ids||jsonb_build_array(comment_id);
   update archive.comments c set author_id=coalesce((author_map->>(source_comment->>'author_key'))::uuid,c.author_id),raw_metadata=bur_stage.merge_owner(c.raw_metadata,source_comment) where c.id=comment_id;
  end loop;
  for source_comment in select value from jsonb_array_elements(coalesce(source_post->'comments','[]')) loop
   comment_id:=(comment_map->>(source_comment->>'key'))::uuid;parent_key:=nullif(source_comment->>'parent_comment_key','');parent_id:=null;
   if parent_key is not null then
    if not (comment_map ? parent_key) then raise exception 'foreign_or_missing_parent_key'; end if;
    parent_id:=(comment_map->>parent_key)::uuid;
   elsif nullif(source_comment->>'parent_id','') is not null then
    select c.id into parent_id from archive.comments c where c.post_id=v_post_db and c.facebook_comment_id=source_comment->>'parent_id';
   end if;
   if parent_id=comment_id then raise exception 'self_parent'; end if;
   if parent_id is not null then update archive.comments set parent_comment_id=parent_id where id=comment_id; end if;
  end loop;
  if exists(with recursive chains(id,parent,path,cycle) as (
   select c.id,c.parent_comment_id,array[c.id],false from archive.comments c where c.post_id=v_post_db
   union all select p.id,p.parent_comment_id,chains.path||p.id,p.id=any(chains.path) from chains join archive.comments p on p.id=chains.parent where not chains.cycle
  ) select 1 from chains where cycle) then raise exception 'parent_cycle'; end if;
  with recursive chains(start,id,parent,depth) as (
   select c.id,c.id,c.parent_comment_id,0 from archive.comments c where c.post_id=v_post_db
   union all select chains.start,p.id,p.parent_comment_id,chains.depth+1 from chains join archive.comments p on p.id=chains.parent
  ), depths as (select start,max(depth) depth from chains group by start)
  update archive.comments c set depth=d.depth from depths d where c.id=d.start;
  update archive.crawl_run_posts rp set ordinal=v_ordinal,raw_metadata=rp.raw_metadata||jsonb_build_object('graph_applied',true,'source_comment_ids',post_comments,'source_author_key',source_post->'author_key') where rp.crawl_run_id=rid and rp.post_id=v_post_db;
 end loop;
 update archive.crawl_runs r set source_sha256=canonical_hash,posts_seen=jsonb_array_length(payload->'posts'),posts_updated=case when mode='update' and not baseline then 0 else r.posts_updated end,checkpoint=payload->'job_summary',stats=r.stats||jsonb_build_object('relational_schema','bur-author-graph/1','source_authors',payload->'authors','source_author_map',author_map,'source_comment_ids',comment_ids,'skipped_existing_ids',skipped,'skipped_existing_count',skipped_count) where r.id=rid;
 return result||jsonb_build_object('relational_schema','bur-author-graph/1','source_sha256',canonical_hash,'posts_seen',jsonb_array_length(payload->'posts'),'skipped_existing_count',skipped_count);
end;
$$;
revoke all on function public.bur_import_archived_graph(jsonb,text,text,text,text) from public,anon,authenticated;
grant execute on function public.bur_import_archived_graph(jsonb,text,text,text,text) to service_role;

create or replace function public.bur_verify_graph_receipt(p_run_id uuid,p_group text,p_sha256 text,p_post_ids text[])
returns jsonb language sql stable security invoker set search_path='' as $$
 select public.bur_verify_import_receipt(p_run_id,p_group,p_sha256,p_post_ids)||jsonb_build_object('relational_verified',coalesce((
  select r.stats->>'relational_schema'='bur-author-graph/1'
   and not exists(select 1 from jsonb_each_text(r.stats->'source_author_map') a where not exists(select 1 from archive.authors_private ap where ap.id=a.value::uuid and ap.group_id=r.group_id))
   and not exists(select 1 from jsonb_array_elements_text(r.stats->'source_comment_ids') c where not exists(select 1 from archive.comments ac join archive.posts p on p.id=ac.post_id where ac.id=c.value::uuid and p.group_id=r.group_id))
  from archive.crawl_runs r where r.id=p_run_id
 ),false));
$$;
revoke all on function public.bur_verify_graph_receipt(uuid,text,text,text[]) from public,anon,authenticated;
grant execute on function public.bur_verify_graph_receipt(uuid,text,text,text[]) to service_role;
create or replace function public.bur_graph_indexable_posts(p_group text,p_batch_id text,p_collector_version text,p_sha256 text)
returns text[] language plpgsql stable security invoker set search_path='' as $$
declare result text[];
begin
 if not exists(select 1 from archive.crawl_runs r join archive.groups g on g.id=r.group_id where g.slug=p_group and r.batch_key='bur:'||p_group||':'||p_collector_version||':'||p_batch_id and r.source_file_sha256=p_sha256 and r.status='done' and r.stats->>'relational_schema'='bur-author-graph/1') then raise exception 'unverified_graph_source'; end if;
 select coalesce(array_agg(p.facebook_post_id order by rp.ordinal),'{}') into result from archive.crawl_runs r join archive.groups g on g.id=r.group_id join archive.crawl_run_posts rp on rp.crawl_run_id=r.id join archive.posts p on p.id=rp.post_id
 where g.slug=p_group and r.batch_key='bur:'||p_group||':'||p_collector_version||':'||p_batch_id and r.source_file_sha256=p_sha256 and not coalesce((rp.raw_metadata->>'skipped_existing_new_only')::boolean,false);
 return result;
end;
$$;
revoke all on function public.bur_graph_indexable_posts(text,text,text,text) from public,anon,authenticated;
grant execute on function public.bur_graph_indexable_posts(text,text,text,text) to service_role;
commit;
