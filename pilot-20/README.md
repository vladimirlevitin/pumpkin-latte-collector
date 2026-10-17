# Pumpkin Latte enrichment: 50-post pilot

This isolated extension uses Collector 2.8.1 and calls the new `pumpkin-enrichment-20` Supabase Edge Function. The function reads the service role key only on the Supabase server. `bridge.py` remains as unused legacy code. Nothing here changes the passive collector, `pumpkin-pilot`, WordPress, or `main`.

## Setup

1. At `chrome://extensions`, select **Load unpacked** and choose the extension-only directory:
   `C:\Users\731\Documents\Codex\2026-10-17\referenced-chatgpt-conversation-this-is-an\work\pumpkin-latte-collector\pilot-20-extension`
   The `pilot-20` directory also contains legacy Python and tests; it is not the directory to load in Chrome.
2. Open a logged-in Facebook tab.
3. Enter the separate pilot token in the popup, select **Load 50**, then **Start / Resume**. The token is saved in Chrome local extension storage and fills the popup field when reopened; treat that browser profile as trusted.

No Python bridge or local `SUPABASE_SERVICE_ROLE_KEY` is needed. The Edge Function accepts a 256-bit random pilot token whose SHA-256 verifier is stored in server code. Deploy with `verify_jwt=false` so the function itself checks the token. Rotate by changing the verifier and redistributing the token. The Edge Function uses the server's default `SUPABASE_SERVICE_ROLE_KEY` to read `archive.collector_batches` and invoke the existing `public.archive_ingest_batch` RPC. The `archive` schema must be exposed to the Data API for this read to work.

`Load 50` chooses the oldest 50 records with `raw_metadata.needs_enrichment=true`, a numeric Facebook post ID, and no Collector 2.8.x batch. Loading a new queue resets the local journal, so export or copy it first if needed. Before every write the function re-reads the original batch, checks identity and text, merges old and new comments/media/authors, forbids a lower comment count, and verifies the saved count.

Statuses are `pending`, `processing`, `enriched`, `partial`, `unavailable`, `failed`, and `skipped_guard`. Stop takes effect before the next Supabase transport and prevents advancing; the already running DOM pass may finish locally. Resume retries the current `processing` post. A suspicious DOM or route yields `skipped_guard` and sends no package.

The core checks the URL post ID; structurally selects the active post by exact anchors, nested comments, and text; compares text before and after expansion; checks author consistency; aborts on route or target changes; accumulates virtualized comments; and rejects a comment-count regression. The queue has a hard limit of 50. Do not merge into `main` before reviewing the resulting batches and journal.

## Verification

Run `node --check` on the JavaScript files in `pilot-20-extension` and `python -m unittest discover -s tests` for legacy bridge logic. A live run requires the operator's Facebook session; deployment alone does not start a run.
