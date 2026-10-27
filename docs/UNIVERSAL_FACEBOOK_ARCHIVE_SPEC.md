# Universal group archive: implementation contract

Status: engineering specification, **not** a released one-click product.

## Product goal
One action should initiate a resumable archive of a Facebook group visible to the signed-in operator, ingest records to a per-group database with deduplication, build a semantic index, and expose a private searchable archive. It must report coverage, omissions and progress honestly.

## Non-negotiable safety and quality
- Existing working Bur 0.5.20 collector is an immutable baseline. Release only from a separate branch with full regression suite.
- Never claim complete capture: Facebook can hide, delete, reorder, throttle or restrict posts/comments.
- Never bypass access controls or request private content the operator cannot view.
- A checkpoint is an exact permalink post ID, **not** a chronological number and not evidence of position. Never infer ordering from numeric ID.
- Unknown checkpoint: keep state, report obstruction/stall; do not silently reset or export a supposedly resumed batch.
- Store both raw and parsed records. Re-ingestion is idempotent on (group_id, post_id), comments on (group_id, post_id, comment_id).
- Keep source URL, observed_at, capture version, data completeness status, and original raw snapshot.
- Separate collection from filtering and publishing. Private archive by default; anonymize personal details before external display, confirm permission and applicable rules.

## Modules and hand-offs
1. **Collector** (browser): read accessible DOM, discover post permalink IDs, capture cards and comment threads, checkpoint and page-position continuity; emit atomic JSON batches.
2. **Watcher/ingest**: acknowledge only after durable server commit; checksums, retries, deduplication, corrupted-batch quarantine, import ledger with per-batch status.
3. **Normalizer**: isolate post body from UI chrome, normalize timestamps, comments and reply relations; preserve raw on uncertainty.
4. **Indexer**: chunk useful text, select embeddings model and dimensions per collection, idempotently build/search pgvector; track model version and reindex.
5. **Search**: group-scoped hybrid keyword + vector retrieval, source links, clear dates, evidence snippets, explicit missing/partial coverage.
6. **Private portal**: password/session authentication, topic filters, source links, operator controls, publishing/privacy reviews.
7. **Operations**: live progress, errors, counts, pause/resume, checkpoint fidelity, coverage/gap alerts, storage/embedding cost estimates.

## State machine
Idle -> Discover -> Deep -> Export -> Ingest acknowledgment -> Index -> Search ready.
Any stage may transition to Paused or Error with a recoverable state. Ingestion can continue separately from collection. A batch is never marked complete until receipt and DB commit are confirmed.

## Release acceptance checks
- Fresh install: click Start -> job persisted -> page reload -> correct version ping -> resume with same checkpoint.
- Exact checkpoint on simulated dynamically virtualized 2,000+ post feed, with variable-height cards and asynchronous load.
- Checkpoint missing/deleted: safe pause and diagnostic, no reset and no falsely certified continuity.
- Adaptation must not skip an unseen target even where post timestamps are missing or feed is nonchronological.
- Hundreds of comments, nested replies, blocked dialogs, missing images, reload and browser restart.
- Two batches with no repeated IDs on the same group, repeated ingestion idempotent, search isolation between groups.
- Full regression of original Bur 0.5.20; release artifact reproducible with GitHub Actions and integrity hash.
- A real-browser smoke test after installation is required before claiming production readiness.

## Known engineering uncertainty
Facebook feeds are neither reliably chronological nor seekable by an arbitrary post ID. Large scroll jumps cannot guarantee finding an unseen ID. Any accelerated mode must have a verified range/position signal and a backtracking mechanism; otherwise remain in overlap-safe scan mode. The honest fallback is slow but reliable scanning until exhaustion or an explicit operator intervention.
