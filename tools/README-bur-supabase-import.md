# FB Bur JSON -> Supabase Storage + Postgres

This pipeline preserves every accepted FB Bur JSON as an immutable source file in
Supabase Storage and only then imports its structured contents into the existing
`archive` schema in the `pumpkin-latte-archive` project.

## Storage layer

Private bucket:

```text
bur-raw
└── <group>/<YYYY>/<MM>/<raw-file-sha256>.json
```

Example:

```text
bur-raw/backpackIL/2026/10/c51212c8fd734878ed131e5dbc43e68a94b3dbd61bf50739aedb16898a81404d.json
```

The path is content-addressed. An exact repeat of the same raw JSON therefore maps
to the same object instead of creating another copy.

The bucket is private, accepts JSON/text files only, and currently has a 50 MB
per-object limit.

## Database layer

The archive-aware RPC is:

```text
public.bur_import_archived_json(jsonb, text, text, text, text)
```

It:

- is executable only by `service_role`;
- runs as **SECURITY INVOKER**;
- refuses to import unless the referenced `bur-raw` Storage object already exists;
- calls the idempotent `public.bur_import_json_safe(jsonb, text)`;
- upserts groups, posts, comment authors and comments;
- preserves comment reply relationships;
- records every accepted JSON package in `archive.crawl_runs`;
- records package order in `archive.crawl_run_posts`;
- stores `storage_bucket`, `storage_path`, `storage_archived_at` and the exact
  raw-file SHA-256 on the crawl run.

The lower-level import functions remain restricted to `service_role`.

## Current backpackIL baseline

Already present in Postgres:

- `bur-raw-backpackIL-2026-10-26 (7).json` — 50 posts / 450 comments
- `bur-raw-backpackIL-2026-10-26 (9).json` — 50 posts / 462 comments
- `bur-raw-backpackIL-2026-10-27 (1).json` — 50 posts / 338 comments
- `bur-raw-backpackIL-2026-10-27 (2).json` — 50 posts / 390 comments

Total baseline: **200 unique posts / 1,640 comments**.

Known failed/duplicate 0.5.17 exports were intentionally not imported.

On the first watcher start, those same four historical packages are backfilled into
Storage **only if their raw-file SHA-256 exactly matches the reviewed allowlist**.
All other legacy 0.5.12/0.5.17/0.5.18 files remain ignored.

## One-shot Windows import

You can either set the secret key for the current Command Prompt:

```bat
set SUPABASE_SECRET_KEY=sb_secret_YOUR_KEY
python tools\import_bur_json.py "C:\path\bur-raw-backpackIL-2026-10-27 (2).json"
```

or simply run the command without setting the environment variable. The script
will prompt for the `sb_secret_...` key without echoing it.

The one-shot importer always performs:

```text
validate JSON
  -> SHA-256 raw bytes
  -> upload immutable source to private Storage
  -> verify Storage object in database RPC
  -> import/upsert structured data
  -> link crawl_run to the source object
```

Multiple files are allowed:

```bat
python tools\import_bur_json.py file1.json file2.json file3.json
```

## Continuous 0.5.19+ watcher

Run:

```bat
python tools\watch_bur_downloads.py
```

By default it watches:

```text
%USERPROFILE%\Downloads
```

On startup it first scans for the four exact-hash trusted historical packages and
archives them if present. Then it continuously processes new **0.5.19+** JSON
packages.

The 0.5.19 gate checks the actual export fields:

- `job_summary.stage == "done"`;
- `job_summary.batch_number` exists;
- for 0.5.19, `job_summary.checkpoint_algorithm == "continuous_feed_v3"`;
- JSON structure and discovery order are valid.

Important safeguards:

- source JSON is archived **before** database import;
- old packages are backfilled only by exact SHA-256 allowlist;
- incomplete jobs are skipped;
- a new file must have a stable size across two scans before processing;
- Storage paths are content-addressed and immutable;
- exact database repeats are server-side no-ops;
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

Use a **secret key** (`sb_secret_...`) only on your own computer/backend. Never
place it in Chrome extension source, JavaScript served to users, Git, screenshots,
or chat.

The raw Storage object is the source of truth. Postgres contains the normalized
working copy used for filtering, curation, search units and embeddings.
