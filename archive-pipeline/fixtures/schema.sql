-- Read-only structural snapshot inspected 27 Oct 2026, used ONLY by local tests.
create role anon;create role authenticated;create role service_role bypassrls;
create schema archive;create schema extensions;create schema storage;
create extension vector with schema extensions;
create table storage.objects(bucket_id text,name text,primary key(bucket_id,name));
create function extensions.digest(bytea,text) returns bytea language sql immutable as $$ select sha256($1) $$;
create table archive.groups(
 "id" uuid default gen_random_uuid() not null,
 "platform" text default 'facebook'::text not null,
 "facebook_group_id" text,
 "slug" text,
 "name" text not null,
 "canonical_url" text,
 "created_at" timestamp with time zone default now(),
 "metadata" jsonb default '{}'::jsonb,
primary key(id)
);
alter table archive.groups enable row level security;
create table archive.authors_private(
 "id" uuid default gen_random_uuid() not null,
 "group_id" uuid,
 "facebook_author_id" text,
 "display_name" text,
 "profile_url" text,
 "author_key" uuid default gen_random_uuid() not null,
 "is_admin" boolean default false,
 "is_anonymous" boolean default false,
 "first_seen_at" timestamp with time zone default now(),
 "last_seen_at" timestamp with time zone default now(),
 "metadata" jsonb default '{}'::jsonb,
primary key(id)
);
alter table archive.authors_private enable row level security;
create table archive.posts(
 "id" uuid default gen_random_uuid() not null,
 "group_id" uuid not null,
 "facebook_post_id" text not null,
 "author_id" uuid,
 "posted_at" timestamp with time zone,
 "text" text,
 "canonical_url" text,
 "content_hash" text,
 "raw_metadata" jsonb default '{}'::jsonb,
 "first_seen_at" timestamp with time zone default now(),
 "last_seen_at" timestamp with time zone default now(),
 "deleted_at" timestamp with time zone,
 "updated_at" timestamp with time zone default now(),
primary key(id)
);
alter table archive.posts enable row level security;
create table archive.comments(
 "id" uuid default gen_random_uuid() not null,
 "post_id" uuid not null,
 "parent_comment_id" uuid,
 "facebook_comment_id" text,
 "author_id" uuid,
 "commented_at" timestamp with time zone,
 "text" text,
 "depth" integer default 0,
 "content_hash" text,
 "raw_metadata" jsonb default '{}'::jsonb,
 "first_seen_at" timestamp with time zone default now(),
 "last_seen_at" timestamp with time zone default now(),
 "deleted_at" timestamp with time zone,
 "updated_at" timestamp with time zone default now(),
primary key(id)
);
alter table archive.comments enable row level security;
create table archive.crawl_runs(
 "id" uuid default gen_random_uuid() not null,
 "group_id" uuid,
 "collector_version" text,
 "started_at" timestamp with time zone default now(),
 "finished_at" timestamp with time zone,
 "status" text default 'running'::text,
 "posts_seen" integer default 0,
 "posts_new" integer default 0,
 "posts_updated" integer default 0,
 "comments_seen" integer default 0,
 "media_seen" integer default 0,
 "errors_count" integer default 0,
 "checkpoint" jsonb default '{}'::jsonb,
 "stats" jsonb default '{}'::jsonb,
 "batch_key" text,
 "source_sha256" text,
 "source_filename" text,
 "source_created_at" timestamp with time zone,
 "source_bytes" bigint,
 "storage_bucket" text,
 "storage_path" text,
 "storage_archived_at" timestamp with time zone,
 "source_file_sha256" text,
primary key(id)
);
alter table archive.crawl_runs enable row level security;
create table archive.crawl_run_posts(
 "crawl_run_id" uuid not null,
 "post_id" uuid not null,
 "ordinal" integer not null,
 "deep_status" text,
 "deep_error" text,
 "snapshot_at" timestamp with time zone,
 "raw_metadata" jsonb default '{}'::jsonb not null,
primary key(crawl_run_id,post_id)
);
alter table archive.crawl_run_posts enable row level security;
create table archive.search_units(
 "id" uuid default gen_random_uuid() not null,
 "unit_type" text not null,
 "post_id" uuid,
 "comment_id" uuid,
 "media_id" uuid,
 "text_content" text,
 "content_for_embedding" text,
 "source_hash" text not null,
 "language" text,
 "metadata" jsonb default '{}'::jsonb,
 "embedding_status" text default 'pending'::text,
 "created_at" timestamp with time zone default now(),
 "updated_at" timestamp with time zone default now(),
primary key(id)
);
alter table archive.search_units enable row level security;
create table archive.embeddings(
 "id" uuid default gen_random_uuid() not null,
 "search_unit_id" uuid not null,
 "provider" text not null,
 "model" text not null,
 "dimensions" integer default 768 not null,
 "embedding" extensions.vector(768) not null,
 "source_hash" text not null,
 "created_at" timestamp with time zone default now(),
primary key(id)
);
alter table archive.embeddings enable row level security;
create table archive.topics(
 "id" bigint generated always as identity not null,
 "slug" text not null,
 "name" text not null,
 "parent_id" bigint,
primary key(id)
);
alter table archive.topics enable row level security;
create table archive.search_unit_topics(
 "search_unit_id" uuid not null,
 "topic_id" bigint not null,
 "confidence" real,
primary key(search_unit_id,topic_id)
);
alter table archive.search_unit_topics enable row level security;
create unique index groups_slug on archive.groups(platform,slug) where slug is not null;
create unique index runs_batch on archive.crawl_runs(group_id,batch_key) where batch_key is not null;
create unique index posts_external on archive.posts(group_id,facebook_post_id);
create unique index authors_external on archive.authors_private(group_id,facebook_author_id) where facebook_author_id is not null;
create unique index comments_external on archive.comments(post_id,facebook_comment_id) where facebook_comment_id is not null;
create unique index embeddings_source on archive.embeddings(search_unit_id,provider,model,source_hash);
grant usage on schema archive,extensions,storage to service_role;
grant all on all tables in schema archive,storage to service_role;
grant usage on all sequences in schema archive to service_role;

