-- Staging only. Depends on the existing archive schema and import functions.
-- This migration has NOT been applied to production.
begin;
create or replace function public.bur_verify_import_receipt(
  p_run_id uuid,p_group text,p_sha256 text,p_post_ids text[]
) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object(
  'verified',coalesce((
   select r.source_file_sha256=p_sha256 and r.storage_bucket='bur-raw'
     and g.slug=p_group and r.status='done'
     and (select count(*) from archive.crawl_run_posts rp where rp.crawl_run_id=r.id)=cardinality(p_post_ids)
     and not exists(
       select 1 from unnest(p_post_ids) expected(id)
       where not exists(select 1 from archive.crawl_run_posts rp
         join archive.posts p on p.id=rp.post_id
         where rp.crawl_run_id=r.id and p.group_id=r.group_id and p.facebook_post_id=expected.id)
     )
   from archive.crawl_runs r join archive.groups g on g.id=r.group_id where r.id=p_run_id
  ),false),
  'post_count',(select count(*) from archive.crawl_run_posts where crawl_run_id=p_run_id)
 );
$$;
revoke all on function public.bur_verify_import_receipt(uuid,text,text,text[]) from public,anon,authenticated;
grant execute on function public.bur_verify_import_receipt(uuid,text,text,text[]) to service_role;
commit;
