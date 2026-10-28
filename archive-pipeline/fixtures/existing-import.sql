CREATE OR REPLACE FUNCTION public.bur_import_json(payload jsonb, source_filename text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_group text;
  v_version text;
  v_job_id text;
  v_batch_key text;
  v_created_at timestamptz;
  v_group_id uuid;
  v_run_id uuid;
  v_post jsonb;
  v_comment jsonb;
  v_post_id text;
  v_post_db_id uuid;
  v_existing_post_id uuid;
  v_comment_id text;
  v_comment_db_id uuid;
  v_parent_external text;
  v_parent_db_id uuid;
  v_author_name text;
  v_author_url text;
  v_author_external text;
  v_author_id uuid;
  v_seen_at timestamptz;
  v_ordinal integer;
  v_fallback_ordinal integer := 0;
  v_posts_new integer := 0;
  v_posts_updated integer := 0;
  v_comments_seen integer := 0;
  v_source_sha256 text;
  v_source_bytes bigint;
  v_order jsonb;
begin
  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'payload_not_object';
  end if;
  if coalesce(payload->>'schema','') <> 'bur-collector/1' then
    raise exception 'unsupported_schema';
  end if;

  v_group := coalesce(payload->>'group','');
  if v_group !~ '^[A-Za-z0-9._-]{3,120}$' then
    raise exception 'invalid_group';
  end if;

  v_version := coalesce(payload->>'collector_version','');
  if v_version !~ '^0[.]5[.][0-9]+(-alpha)?$' then
    raise exception 'unsupported_collector_version';
  end if;

  if jsonb_typeof(coalesce(payload->'posts','[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(payload->'posts','[]'::jsonb)) < 1
     or jsonb_array_length(coalesce(payload->'posts','[]'::jsonb)) > 5000 then
    raise exception 'invalid_posts_count';
  end if;

  if coalesce(payload #>> '{job_summary,stage}','done') <> 'done' then
    raise exception 'job_not_done';
  end if;

  v_order := coalesce(payload #> '{job_summary,discovery_order}','[]'::jsonb);
  if jsonb_typeof(v_order) <> 'array' then
    raise exception 'invalid_discovery_order';
  end if;
  if jsonb_array_length(v_order) > 0
     and jsonb_array_length(v_order) <> jsonb_array_length(payload->'posts') then
    raise exception 'discovery_order_size_mismatch';
  end if;

  v_job_id := coalesce(nullif(payload #>> '{job_summary,id}',''), left(encode(extensions.digest(convert_to(payload::text,'UTF8'),'sha256'),'hex'),16));
  v_batch_key := 'bur:' || v_group || ':' || v_version || ':' || v_job_id;
  v_source_sha256 := encode(extensions.digest(convert_to(payload::text,'UTF8'),'sha256'),'hex');
  v_source_bytes := octet_length(convert_to(payload::text,'UTF8'));
  v_created_at := nullif(payload->>'created_at','')::timestamptz;

  insert into archive.groups(platform, slug, name, canonical_url, metadata)
  values (
    'facebook',
    v_group,
    v_group,
    'https://www.facebook.com/groups/' || v_group || '/',
    jsonb_build_object('source','bur','collector_version',v_version)
  )
  on conflict (platform, slug) where slug is not null
  do update set
    canonical_url = excluded.canonical_url,
    metadata = coalesce(archive.groups.metadata,'{}'::jsonb) || excluded.metadata
  returning id into v_group_id;

  insert into archive.crawl_runs(
    group_id, collector_version, started_at, finished_at, status,
    posts_seen, posts_new, posts_updated, comments_seen, media_seen, errors_count,
    checkpoint, stats, batch_key, source_sha256, source_filename, source_created_at, source_bytes
  )
  values (
    v_group_id, v_version, v_created_at, now(), 'importing',
    jsonb_array_length(payload->'posts'), 0, 0, 0, 0, 0,
    jsonb_build_object(
      'checkpoint_post_id', payload #>> '{job_summary,checkpoint_post_id}',
      'last_collected_post_id', payload #>> '{job_summary,last_collected_post_id}',
      'checkpoint_source', payload #>> '{job_summary,checkpoint_source}',
      'checkpoint_algorithm', payload #>> '{job_summary,checkpoint_algorithm}',
      'rewind_verified', payload #> '{job_summary,rewind_verified}'
    ),
    jsonb_build_object(
      'job_summary', coalesce(payload->'job_summary','{}'::jsonb),
      'limitations', coalesce(payload->'limitations','[]'::jsonb),
      'schema', payload->>'schema'
    ),
    v_batch_key, v_source_sha256, nullif(source_filename,''), v_created_at, v_source_bytes
  )
  on conflict (group_id, batch_key) where batch_key is not null
  do update set
    collector_version = excluded.collector_version,
    finished_at = now(),
    status = 'importing',
    posts_seen = excluded.posts_seen,
    checkpoint = excluded.checkpoint,
    stats = excluded.stats,
    source_sha256 = excluded.source_sha256,
    source_filename = coalesce(excluded.source_filename, archive.crawl_runs.source_filename),
    source_created_at = excluded.source_created_at,
    source_bytes = excluded.source_bytes
  returning id into v_run_id;

  delete from archive.crawl_run_posts where crawl_run_id = v_run_id;

  for v_post in
    select value from jsonb_array_elements(payload->'posts')
  loop
    v_post_id := coalesce(v_post->>'post_id','');
    if v_post_id !~ '^[0-9]{8,30}$' then
      raise exception 'invalid_post_id:%', v_post_id;
    end if;
    if coalesce(v_post->>'group',v_group) <> v_group then
      raise exception 'post_group_mismatch:%', v_post_id;
    end if;

    if jsonb_typeof(coalesce(v_post->'comments','[]'::jsonb)) <> 'array'
       or jsonb_array_length(coalesce(v_post->'comments','[]'::jsonb)) > 5000 then
      raise exception 'invalid_comments:%', v_post_id;
    end if;

    v_seen_at := coalesce(
      nullif(v_post->>'first_seen','')::timestamptz,
      nullif(v_post->>'snapshot_at','')::timestamptz,
      v_created_at,
      now()
    );

    select id into v_existing_post_id
    from archive.posts
    where group_id = v_group_id and facebook_post_id = v_post_id;

    insert into archive.posts(
      group_id, facebook_post_id, posted_at, text, canonical_url,
      content_hash, raw_metadata, first_seen_at, last_seen_at, updated_at
    )
    values (
      v_group_id,
      v_post_id,
      nullif(v_post->>'published_at','')::timestamptz,
      coalesce(v_post->>'post_text',''),
      coalesce(nullif(v_post->>'permalink',''), nullif(v_post->>'source_page','')),
      encode(extensions.digest(convert_to(coalesce(v_post->>'post_text',''),'UTF8'),'sha256'),'hex'),
      v_post - 'comments',
      v_seen_at,
      v_seen_at,
      now()
    )
    on conflict (group_id, facebook_post_id)
    do update set
      posted_at = coalesce(excluded.posted_at, archive.posts.posted_at),
      text = case
        when length(coalesce(excluded.text,'')) >= length(coalesce(archive.posts.text,''))
          then excluded.text else archive.posts.text end,
      canonical_url = coalesce(excluded.canonical_url, archive.posts.canonical_url),
      content_hash = excluded.content_hash,
      raw_metadata = coalesce(archive.posts.raw_metadata,'{}'::jsonb) || excluded.raw_metadata,
      first_seen_at = least(archive.posts.first_seen_at, excluded.first_seen_at),
      last_seen_at = greatest(archive.posts.last_seen_at, excluded.last_seen_at),
      updated_at = now()
    returning id into v_post_db_id;

    if v_existing_post_id is null then
      v_posts_new := v_posts_new + 1;
    else
      v_posts_updated := v_posts_updated + 1;
    end if;

    v_ordinal := null;
    if jsonb_array_length(v_order) > 0 then
      select (ord - 1)::integer into v_ordinal
      from jsonb_array_elements_text(v_order) with ordinality as d(id, ord)
      where id = v_post_id
      limit 1;
      if v_ordinal is null then
        raise exception 'discovery_order_set_mismatch:%', v_post_id;
      end if;
    else
      v_ordinal := v_fallback_ordinal;
      v_fallback_ordinal := v_fallback_ordinal + 1;
    end if;

    insert into archive.crawl_run_posts(
      crawl_run_id, post_id, ordinal, deep_status, deep_error, snapshot_at, raw_metadata
    )
    values (
      v_run_id, v_post_db_id, v_ordinal,
      v_post #>> '{deep,status}',
      coalesce(v_post #>> '{deep,error}', v_post #>> '{deep,fallback}'),
      nullif(v_post->>'snapshot_at','')::timestamptz,
      jsonb_build_object(
        'comments_status', v_post->>'comments_status',
        'visible_comment_count', v_post #> '{deep,visible_comment_count}',
        'completeness', v_post #>> '{deep,completeness}'
      )
    )
    on conflict (crawl_run_id, post_id)
    do update set
      ordinal = excluded.ordinal,
      deep_status = excluded.deep_status,
      deep_error = excluded.deep_error,
      snapshot_at = excluded.snapshot_at,
      raw_metadata = excluded.raw_metadata;

    for v_comment in
      select value from jsonb_array_elements(coalesce(v_post->'comments','[]'::jsonb))
    loop
      v_comment_id := nullif(v_comment->>'id','');
      if v_comment_id is null then
        v_comment_id := 'synthetic:' || md5(
          coalesce(v_comment->>'author','') || '|' ||
          coalesce(v_comment->>'text','') || '|' ||
          coalesce(v_comment->>'permalink','')
        );
      end if;

      v_author_name := nullif(btrim(v_comment->>'author'),'');
      v_author_url := nullif(v_comment->>'author_url','');
      v_author_external := null;

      if v_author_url is not null then
        if v_author_url ~ '[?&]id=[0-9]+' then
          v_author_external := 'id:' || substring(v_author_url from '[?&]id=([0-9]+)');
        else
          v_author_external := 'url:' || md5(lower(v_author_url));
        end if;
      elsif v_author_name is not null then
        v_author_external := 'name:' || md5(lower(v_author_name));
      end if;

      v_author_id := null;
      if v_author_external is not null then
        insert into archive.authors_private(
          group_id, facebook_author_id, display_name, profile_url,
          first_seen_at, last_seen_at, metadata
        )
        values (
          v_group_id, v_author_external, v_author_name, v_author_url,
          v_seen_at, v_seen_at, '{"source":"bur"}'::jsonb
        )
        on conflict (group_id, facebook_author_id) where facebook_author_id is not null
        do update set
          display_name = coalesce(excluded.display_name, archive.authors_private.display_name),
          profile_url = coalesce(excluded.profile_url, archive.authors_private.profile_url),
          last_seen_at = greatest(archive.authors_private.last_seen_at, excluded.last_seen_at),
          metadata = coalesce(archive.authors_private.metadata,'{}'::jsonb) || excluded.metadata
        returning id into v_author_id;
      end if;

      insert into archive.comments(
        post_id, facebook_comment_id, author_id, commented_at, text, depth,
        content_hash, raw_metadata, first_seen_at, last_seen_at, updated_at
      )
      values (
        v_post_db_id,
        v_comment_id,
        v_author_id,
        nullif(v_comment->>'commented_at','')::timestamptz,
        coalesce(v_comment->>'text',''),
        case when nullif(v_comment->>'parent_id','') is null then 0 else 1 end,
        encode(extensions.digest(convert_to(coalesce(v_comment->>'text',''),'UTF8'),'sha256'),'hex'),
        v_comment,
        v_seen_at,
        v_seen_at,
        now()
      )
      on conflict (post_id, facebook_comment_id) where facebook_comment_id is not null
      do update set
        author_id = coalesce(excluded.author_id, archive.comments.author_id),
        commented_at = coalesce(excluded.commented_at, archive.comments.commented_at),
        text = case
          when length(coalesce(excluded.text,'')) >= length(coalesce(archive.comments.text,''))
            then excluded.text else archive.comments.text end,
        depth = excluded.depth,
        content_hash = excluded.content_hash,
        raw_metadata = coalesce(archive.comments.raw_metadata,'{}'::jsonb) || excluded.raw_metadata,
        last_seen_at = greatest(archive.comments.last_seen_at, excluded.last_seen_at),
        updated_at = now()
      returning id into v_comment_db_id;

      v_comments_seen := v_comments_seen + 1;
    end loop;

    for v_comment in
      select value from jsonb_array_elements(coalesce(v_post->'comments','[]'::jsonb))
    loop
      v_comment_id := nullif(v_comment->>'id','');
      v_parent_external := nullif(v_comment->>'parent_id','');
      if v_comment_id is null or v_parent_external is null then
        continue;
      end if;

      select id into v_parent_db_id
      from archive.comments
      where post_id = v_post_db_id
        and facebook_comment_id = v_parent_external
      limit 1;

      if v_parent_db_id is not null then
        update archive.comments
        set parent_comment_id = v_parent_db_id, depth = 1, updated_at = now()
        where post_id = v_post_db_id
          and facebook_comment_id = v_comment_id;
      end if;
    end loop;
  end loop;

  update archive.crawl_runs
  set status = 'done',
      finished_at = now(),
      posts_seen = jsonb_array_length(payload->'posts'),
      posts_new = v_posts_new,
      posts_updated = v_posts_updated,
      comments_seen = v_comments_seen,
      errors_count = coalesce((payload #>> '{job_summary,deep_errors}')::integer,0)
  where id = v_run_id;

  return jsonb_build_object(
    'ok', true,
    'crawl_run_id', v_run_id,
    'group_id', v_group_id,
    'group', v_group,
    'batch_key', v_batch_key,
    'posts_seen', jsonb_array_length(payload->'posts'),
    'posts_new', v_posts_new,
    'posts_updated', v_posts_updated,
    'comments_seen', v_comments_seen,
    'source_sha256', v_source_sha256,
    'last_collected_post_id', payload #>> '{job_summary,last_collected_post_id}'
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.bur_import_archived_json(payload jsonb, source_filename text, storage_bucket text, storage_path text, source_file_sha256 text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_result jsonb;
  v_run_id uuid;
begin
  if storage_bucket <> 'bur-raw' then
    raise exception 'unexpected_storage_bucket:%', storage_bucket;
  end if;

  if storage_path is null or btrim(storage_path) = '' then
    raise exception 'missing_storage_path';
  end if;

  if source_file_sha256 is null
     or source_file_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_source_file_sha256';
  end if;

  if not exists (
    select 1
    from storage.objects o
    where o.bucket_id = storage_bucket
      and o.name = storage_path
  ) then
    raise exception 'storage_object_missing:%/%', storage_bucket, storage_path;
  end if;

  v_result := public.bur_import_json_safe(payload, source_filename);
  v_run_id := nullif(v_result->>'crawl_run_id','')::uuid;

  if v_run_id is null then
    raise exception 'import_result_missing_crawl_run_id';
  end if;

  update archive.crawl_runs
  set storage_bucket = bur_import_archived_json.storage_bucket,
      storage_path = bur_import_archived_json.storage_path,
      storage_archived_at = coalesce(storage_archived_at, now()),
      source_file_sha256 = bur_import_archived_json.source_file_sha256
  where id = v_run_id;

  return v_result || jsonb_build_object(
    'storage_bucket', storage_bucket,
    'storage_path', storage_path,
    'source_file_sha256', source_file_sha256,
    'archived', true
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.bur_import_json_safe(payload jsonb, source_filename text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_group text;
  v_version text;
  v_job_id text;
  v_batch_key text;
  v_source_sha256 text;
  v_group_id uuid;
  v_existing archive.crawl_runs%rowtype;
begin
  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'payload_not_object';
  end if;

  v_group := coalesce(payload->>'group','');
  v_version := coalesce(payload->>'collector_version','');
  v_job_id := coalesce(
    nullif(payload #>> '{job_summary,id}',''),
    left(encode(extensions.digest(convert_to(payload::text,'UTF8'),'sha256'),'hex'),16)
  );
  v_batch_key := 'bur:' || v_group || ':' || v_version || ':' || v_job_id;
  v_source_sha256 := encode(extensions.digest(convert_to(payload::text,'UTF8'),'sha256'),'hex');

  select id into v_group_id
  from archive.groups
  where platform='facebook' and slug=v_group
  limit 1;

  if v_group_id is not null then
    select * into v_existing
    from archive.crawl_runs
    where group_id=v_group_id
      and batch_key=v_batch_key
      and source_sha256=v_source_sha256
    limit 1;

    if found then
      return jsonb_build_object(
        'ok', true,
        'reused', true,
        'crawl_run_id', v_existing.id,
        'group_id', v_existing.group_id,
        'group', v_group,
        'batch_key', v_existing.batch_key,
        'posts_seen', v_existing.posts_seen,
        'posts_new', v_existing.posts_new,
        'posts_updated', v_existing.posts_updated,
        'comments_seen', v_existing.comments_seen,
        'source_sha256', v_existing.source_sha256,
        'last_collected_post_id', v_existing.checkpoint->>'last_collected_post_id'
      );
    end if;
  end if;

  return public.bur_import_json(payload, source_filename);
end;
$function$;

