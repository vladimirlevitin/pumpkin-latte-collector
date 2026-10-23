# Collector ingest: append-only safety change (draft, not deployed)

Date: 2026-10-23. **No production SQL or Supabase Edge Function changes were made.**

## Why this is necessary

During the 20-post pilot, v0.1.1 uploaded approximately 240 existing local records again. In production, `public.archive_ingest_batch(payload jsonb)` uses:

```sql
ON CONFLICT (group_slug,batch_key)
DO UPDATE SET payload=excluded.payload, updated_at=now()
```

This can replace enriched comments or post text with an incomplete Facebook DOM snapshot. As observed on 23 October, collector_batches went from 387 to 390, with 240 previously existing keys updated.

## Safe server-side change proposal

Before modifying production:

1. Take a verified backup/snapshot of `archive.collector_batches`, including all JSONB payloads.
2. Test the function on a staging copy (new batch, duplicate with fewer comments, duplicate with richer comments, concurrent same-key requests).
3. Preserve all existing validation and API key/origin checks.
4. Replace the *conflict action only*: new batch keys are inserted; existing batch keys are never overwritten by feed ingestion.
5. Keep enrichment in a separate human-reviewed merge pathway that preserves existing comment IDs and validates post identity.

Indicative PL/pgSQL logic within the existing function after validation:

```sql
INSERT INTO archive.collector_batches(
  group_slug, collector_id, collector_version, batch_key,
  facebook_post_id, payload, received_at, updated_at
)
VALUES (
  v_group, v_collector, v_version, v_batch_key,
  v_post_id, payload, now(), now()
)
ON CONFLICT (group_slug, batch_key) DO NOTHING
RETURNING id INTO v_id;

IF v_id IS NULL THEN
  SELECT id INTO v_id
  FROM archive.collector_batches
  WHERE group_slug = v_group AND batch_key = v_batch_key;
END IF;
```

**This is not a complete migration or an authorization to execute it.** Keep the function signature and security model, and confirm output semantics with `collector-ingest` before deployment.

## Release gate for extension

v0.1.2 has `SERVER_SAFE_INGEST_READY=false`: collection and local JSON export work, but HTTP uploads do not. No browser-side toggle is offered.

After deployment of the tested append-only RPC, verify old rows do not change when receiving a duplicate. Only then create the next Chrome release with uploads enabled and run a small, explicitly approved Supabase test. Never turn legacy bulk-synchronization back on.

## Recovery follow-up

Current JSONB values cannot prove or restore their previous versions by themselves. Investigate available backups/PITR before assuming prior comment totals are recoverable. No destructive cleanup.
