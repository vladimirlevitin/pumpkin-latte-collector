# Backpack admin pilot — private staging prototype
Purpose: the **administrator-only** original post archive, separate from any future anonymized public guide.

## Current status
- Read-only audit of Supabase archive: 310 posts, 2779 comments, 300 catalog units; all 310 post records have canonical Facebook URLs. Existing catalog's tags and cities arrays are empty.
- No production database/schema/Edge Function/WordPress modifications.
- `index.html` runs locally and loads JSON via user file picker. The browser does not transmit uploaded content.
- `facets.js` supplies conservative deterministic topic/region/conditions suggestions. These are NOT verified geocodes or editorially validated facts.
- All original text, comments, and original Facebook URLs remain attached to cards; only Facebook-domain HTTPS links become clickable.
- Optional sort by date or comment count, checkbox filters, text search, comments-only.
- This is **not yet integrated with** the live password-protected `backpack-pilot` Edge Function, so do not advertise it as a deployed pilot.
- Dates in the existing database are mostly missing; date sorting will improve as post timestamps are supplied by ingest.

## How to review
Open `index.html` in a browser in the same directory as `facets.js`. Select an existing Bur JSON export or an archive catalog JSON export. Test filters, open original Facebook post, and verify original text/comment availability. Do not use data publicly.

## Next integration steps
1. Add the facet module to the existing authenticated backend/WordPress UI without changing session/password logic.
2. Use catalog `tags` and `cities` as persistently reviewed classifications; keep auto-suggestions visibly marked.
3. Distinguish actual geocoded place points from regions mentioned in a text; only display map pins with verified coordinates.
4. Run real end-to-end tests for closed login, post source links, pagination, and mobile.
5. Request explicit approval before production publication.

## Interface split
- This admin archive shows original posts and comments to the authorized administrator only.
- Public directory must use separate editorial records and anonymization/review workflows, not expose these raw archive views.


## Staged integration, 28 October
The current live `backpack-pilot` Edge Function (version 1) was read via connector and checked **without changing it**. The exact browse response mapping `items:(rows||[]).map((x:any)=>({...x,image_url:null}))` occurs once, and its source contains the expected session gate. The existing WP application already builds tag/city checkboxes and sorts by comments/date; the missing fields are the content classification.

Run `node backpack-admin-pilot/stage-edge-patch.js ORIGINAL.ts STAGED.ts` on a locally available authorized backup of the current function. The script fails on a missing/changed anchor or repeat invocation. It adds `backpackAutoFacets` and enriches only authenticated `browse` output; password/session/search logic is unchanged. It does not deploy or mutate the database.

GitHub Actions verifies theme/region facets, browse adapter, and fail-closed patching.

**Unreleased limitations:** tags are keyword-based text mentions, not validated geography. There are no geocoded points or ready map pins. Most original post dates are absent. Additional posts will appear automatically in the existing catalog if it includes them. Production switch requires owner approval, backup of live Edge Function, staging test with real login and >0 filter counts, and a rollback path to the previous function.
