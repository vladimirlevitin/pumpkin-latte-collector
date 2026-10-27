# FB Bur JSON -> Supabase importer

Imports raw `bur-collector/1` JSON exports into the existing `archive` schema in the
`pumpkin-latte-archive` Supabase project.

## Database side

The public RPC is `public.bur_import_json_safe(jsonb, text)`.

- executable only by `service_role`;
- runs as **SECURITY INVOKER**, not as the database owner;
- exact repeat of the same JSON is a no-op and returns `reused=true`;
- upserts groups, posts, comment authors and comments;
- preserves comment reply relationships;
- records every accepted JSON package in `archive.crawl_runs`;
- records package order in `archive.crawl_run_posts`;
- the lower-level `public.bur_import_json(jsonb, text)` is also restricted to `service_role`.

## Current imported backpackIL baseline

Accepted historical packages imported on 2026-10-27:

- `bur-raw-backpackIL-2026-10-26 (7).json` — 50 posts / 450 comments
- `bur-raw-backpackIL-2026-10-26 (9).json` — 50 posts / 462 comments
- `bur-raw-backpackIL-2026-10-27 (1).json` — 50 posts / 338 comments
- `bur-raw-backpackIL-2026-10-27 (2).json` — 50 posts / 390 comments

Total baseline: **200 unique posts / 1,640 comments**.

Known failed/duplicate 0.5.17 exports were intentionally not imported.

## One-shot Windows import

You can either set the secret key for the current Command Prompt:

```bat
set SUPABASE_SECRET_KEY=sb_secret_YOUR_KEY
python tools\import_bur_json.py "C:\path\bur-raw-backpackIL-2026-10-27 (2).json"
```

or simply run the command without setting the environment variable. The script will prompt for
the `sb_secret_...` key without echoing it.

Multiple files are allowed:

```bat
python tools\import_bur_json.py file1.json file2.json file3.json
```

## Continuous 0.5.19+ watcher

For the new continuous Bur, run:

```bat
python tools\watch_bur_downloads.py
```

By default it watches:

```text
%USERPROFILE%\Downloads
```

and automatically imports new `bur-raw-*.json` files from **0.5.19+ continuous sessions**.

Important safeguards:

- old 0.5.12/0.5.17/0.5.18 files are never auto-imported by the watcher;
- incomplete jobs are skipped;
- a file must have a stable size across two scans before import;
- exact duplicate uploads are server-side no-ops;
- the watcher keeps a local ledger at
  `%LOCALAPPDATA%\FB-Bur\supabase-imported.json`;
- the Supabase secret key is never written to the repository or Bur extension.

Custom downloads directory:

```bat
python tools\watch_bur_downloads.py "D:\Downloads"
```

One scan only:

```bat
python tools\watch_bur_downloads.py --once
```

## Safety

Use a **secret key** (`sb_secret_...`) only on your own computer/backend. Never place it in
Chrome extension source, JavaScript served to users, Git, screenshots, or chat.

Keep the raw Bur JSON files unchanged as the source archive.
