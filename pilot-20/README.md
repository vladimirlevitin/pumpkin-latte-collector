# Pumpkin Latte enrichment: 20-post pilot

This is a separate Chrome extension based on Collector 2.8.1 at `8422af15e2e4a7c7f92d5eb7d33e24094cb7972c`. It does not change the passive collector, main, WordPress, or the production pilot. The extension stays on Facebook across post navigations. Its popup holds a queue of at most 20, Stop/Resume controls, per-post status, and a 100-entry journal in Chrome local storage.

## Setup

1. In a local terminal set `SUPABASE_SERVICE_ROLE_KEY` and a long random `PILOT_TOKEN` environment variable. Keep both out of the browser and source files.
2. Run `python bridge.py` in this directory. It listens only on `127.0.0.1:8765`.
3. In Chrome, open `chrome://extensions`, enable Developer mode, and load this directory as an unpacked extension.
4. Open a logged-in Facebook tab. Open the extension popup, enter the local `PILOT_TOKEN`, select **Load 20**, then **Start / Resume**. Keep the bridge running.

`Load 20` reads `archive.collector_batches` from Supabase and chooses the oldest 20 records with `raw_metadata.needs_enrichment=true`, a numeric Facebook post ID, and no Collector 2.8.x batch. Loading a new queue resets the local journal, so export or copy it first if needed. The bridge uses the existing `archive_ingest_batch` RPC. Before any write it re-reads the original batch, checks identity and text, merges old and new comments/media/authors, forbids a lower comment count, and verifies the saved count. No browser code contains the Supabase service key.

The project's Data API must expose the `archive` schema for the bridge's read requests. If it does not, queue loading fails closed; enable access through an approved server-side API before running the pilot. The existing RPC is in `public`.

Statuses are `pending`, `processing`, `enriched`, `partial`, `unavailable`, `failed`, and `skipped_guard`. Stop takes effect before the next Supabase transport and prevents advancing; the already running DOM pass may finish locally. Resume retries the current `processing` post. A suspicious DOM or route yields `skipped_guard` and sends no package.

This pilot has a hard queue limit of 20. Do not broaden it or merge into `main` before reviewing the resulting batches and journal.

## Guards inherited from 2.8.1

The core checks the URL post ID; structurally selects the active post by exact anchors, nested comments, and text; compares text before and after expansion; checks author consistency; aborts on route or target changes; accumulates virtualized comments; and rejects a comment-count regression. The bridge independently checks the queue ID, archived text prefix, and old count before calling the ingest RPC.

## Verification

Run `node --check` on the extension JavaScript files and `python -m unittest discover -s tests` for bridge logic. These checks do not contact Facebook or Supabase. A live 20-post run still requires the operator's Facebook session and local credentials.
