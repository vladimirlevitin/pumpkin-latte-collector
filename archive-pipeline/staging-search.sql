-- STAGING ONLY: group authorization and hybrid retrieval over the inspected schema.
-- The Edge API verifies the user JWT before passing p_user_id. This RPC is server-only.
begin;
create schema if not exists bur_access;
revoke all on schema bur_access from public,anon,authenticated;
grant usage on schema bur_access to service_role;
create table if not exists bur_access.group_members(
 user_id uuid not null,group_id uuid not null references archive.groups(id),
 primary key(user_id,group_id)
);
alter table bur_access.group_members enable row level security;
grant select,insert,delete on bur_access.group_members to service_role;

create or replace function public.bur_archive_search(
 p_user_id uuid,p_group text,p_query text,p_vector jsonb default null,
 p_topics text[] default null,p_limit integer default 20
) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare gid uuid; result jsonb;
begin
 select g.id into gid from archive.groups g join bur_access.group_members m on m.group_id=g.id
 where g.slug=p_group and m.user_id=p_user_id;
 if gid is null then raise exception 'group_access_denied' using errcode='42501';end if;
 if length(coalesce(p_query,''))>2000 then raise exception 'query_too_long';end if;
 if p_vector is not null and jsonb_array_length(p_vector)<>768 then raise exception 'invalid_vector_dimensions';end if;
 with eligible as (
  select s.id,s.text_content,s.source_hash,p.facebook_post_id,p.canonical_url,p.posted_at,s.metadata,
   coalesce((select jsonb_agg(t.name order by t.name) from archive.search_unit_topics st
    join archive.topics t on t.id=st.topic_id where st.search_unit_id=s.id),'[]'::jsonb) topics
  from archive.search_units s join archive.posts p on p.id=s.post_id
  where p.group_id=gid and p.deleted_at is null and s.metadata->>'bur_retired' is distinct from 'true'
   and (coalesce(cardinality(p_topics),0)=0 or exists(
    select 1 from archive.search_unit_topics st join archive.topics t on t.id=st.topic_id
    where st.search_unit_id=s.id and t.slug=any(p_topics)))
 ), lex as (
  select id,row_number() over(order by ts_rank_cd(to_tsvector('simple',coalesce(text_content,'')),
    plainto_tsquery('simple',p_query)) desc,id) rank
  from eligible where to_tsvector('simple',coalesce(text_content,'')) @@ plainto_tsquery('simple',p_query)
  limit 200
 ), sem as (
  select id,row_number() over(order by distance,id) rank from (
   select u.id,min(e.embedding operator(extensions.<=>) (p_vector::text)::extensions.vector) distance
   from eligible u join archive.embeddings e on e.search_unit_id=u.id and e.source_hash=u.source_hash
   where p_vector is not null and e.dimensions=768 and e.model='gemini-embedding-2-text-768'
   group by u.id
  ) ranked order by distance,id limit 200
 ), merged as (
  select u.*,coalesce(1.0/(60+l.rank),0)+coalesce(1.0/(60+v.rank),0) score
  from eligible u left join lex l on l.id=u.id left join sem v on v.id=u.id
  where l.id is not null or v.id is not null
 ), top_rows as (
  select * from merged order by score desc,id limit greatest(1,least(100,p_limit))
 ) select coalesce(jsonb_agg(jsonb_build_object('unit_id',id,'post_id',facebook_post_id,
   'text',text_content,'url',canonical_url,'date',posted_at,'topics',topics,'score',score,
   'capture_status',coalesce(metadata->>'capture_status','unknown')) order by score desc,id),'[]'::jsonb)
 into result from top_rows;
 return jsonb_build_object('group',p_group,'results',result,'semantic_used',p_vector is not null);
end;
$$;
revoke all on function public.bur_archive_search(uuid,text,text,jsonb,text[],integer) from public,anon,authenticated;
grant execute on function public.bur_archive_search(uuid,text,text,jsonb,text[],integer) to service_role;
commit;
