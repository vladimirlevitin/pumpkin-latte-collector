# FB Bur JSON -> Supabase importer

Imports raw `bur-collector/1` JSON exports into the existing `archive` schema in the
`pumpkin-latte-archive` Supabase project.

## Database side

The database function `public.bur_import_json(jsonb, text)`:

- is executable only by `service_role`;
- upserts groups, posts, comment authors and comments;
- preserves comment reply relationships;
- records every JSON package in `archive.crawl_runs`;
- records package order in `archive.crawl_run_posts`;
- is idempotent: re-importing the same Bur job updates rows instead of duplicating them.

## Windows usage

1. In Supabase Dashboard open **Project Settings -> API Keys**.
2. Copy a **secret key** (`sb_secret_...`). Do not use a publishable key.
3. In Command Prompt:

```bat
set SUPABASE_SECRET_KEY=sb_secret_YOUR_KEY
python tools\import_bur_json.py "C:\path\bur-raw-backpackIL-2026-10-27 (2).json"
```

You may pass several JSON files:

```bat
python tools\import_bur_json.py file1.json file2.json file3.json
```

The script performs local structural checks first and then calls the secured Supabase RPC.

## Safety

Never commit the secret key to Git. Keep raw Bur JSON unchanged as the source archive.
