// Isolated 50-post pilot. The browser only knows a random pilot token; this
// function holds its SHA-256 verifier and reads the service key at runtime.
const PROJECT = Deno.env.get('SUPABASE_URL') || 'https://ltznpjfnkpydautbsrej.supabase.co';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const TOKEN_HASH = '7679d2e31c87a40559bad9d7721fa4675e3b4fb8430c1f166203ef98c1af4e83';
const LIMIT = 50;
const cors = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'authorization, content-type', 'Cache-Control': 'no-store'};

function response(status, value) {
  return new Response(JSON.stringify(value), {status, headers: {...cors, 'Content-Type': 'application/json; charset=utf-8'}});
}
async function authorized(req) {
  const token = req.headers.get('Authorization')?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
  if (!token) return false;
  const bytes = new TextEncoder().encode(token);
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), x => x.toString(16).padStart(2, '0')).join('');
  let diff = 0;
  for (let i = 0; i < TOKEN_HASH.length; i++) diff |= digest.charCodeAt(i) ^ TOKEN_HASH.charCodeAt(i);
  return diff === 0;
}
async function supabase(path, method = 'GET', data, profile = 'archive') {
  if (!SERVICE_KEY) throw Error('Server key unavailable');
  const headers = {'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}`, 'Accept-Profile': profile, 'Content-Type': 'application/json'};
  if (method !== 'GET') headers['Content-Profile'] = profile;
  const result = await fetch(`${PROJECT}/rest/v1/${path}`, {method, headers, body: data === undefined ? undefined : JSON.stringify(data)});
  const text = await result.text();
  if (!result.ok) throw Error(`Supabase ${result.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}
async function batch(id) {
  const rows = await supabase(`collector_batches?select=batch_key,facebook_post_id,payload,updated_at&group_slug=eq.pumpkinlatte&facebook_post_id=eq.${encodeURIComponent(id)}&limit=2`);
  if (rows.length !== 1) throw Error('Batch missing or ambiguous');
  return rows[0];
}
const identity = (row) => String(row?.facebook_comment_id || row?.key || '');
function merge(old, fresh) {
  const merged = {...old};
  for (const row of fresh) {
    const key = identity(row);
    if (!key) throw Error('Comment without stable identity');
    const previous = merged[key];
    if (!previous || String(row?.text || '').length >= String(previous?.text || '').length) merged[key] = row;
  }
  return Object.values(merged);
}
function validId(id) { return typeof id === 'string' && /^[0-9]+$/.test(id); }
async function queue() {
  const rows = await supabase('collector_batches?select=batch_key,facebook_post_id,payload,updated_at&group_slug=eq.pumpkinlatte&facebook_post_id=not.is.null&order=updated_at.asc&limit=1000');
  const result = [];
  for (const row of rows) {
    const payload = row.payload || {};
    const posts = payload.posts || [];
    if (!Array.isArray(posts) || posts.length !== 1) continue;
    const meta = posts[0]?.raw_metadata || {};
    if (meta.needs_enrichment !== true || String(payload.collector_version || '').includes('v2.8.')) continue;
    const id = String(row.facebook_post_id || '');
    if (!validId(id) || row.batch_key !== `fb:pumpkinlatte:post:${id}`) continue;
    result.push({facebook_post_id: id, batch_key: row.batch_key, old_comment_count: (payload.comments || []).length, status: 'pending', attempts: 0, last_error: '', new_comment_count: null});
    if (result.length === LIMIT) break;
  }
  return {queue: result};
}
async function ingest(body) {
  const id = body?.id;
  if (!validId(id)) throw Error('Invalid post ID');
  const oldBatch = await batch(id);
  const previous = oldBatch.payload;
  const fresh = body?.payload;
  const key = `fb:pumpkinlatte:post:${id}`;
  if (!fresh || oldBatch.batch_key !== key || fresh.batch_key !== key || fresh.facebook_post_id !== id || !Array.isArray(fresh.posts) || fresh.posts.length !== 1) throw Error('Payload identity mismatch');
  if (fresh.posts[0]?.key !== key || String(fresh.posts[0]?.facebook_post_id) !== id) throw Error('Post identity mismatch');
  const oldPost = (previous.posts || [{}])[0];
  const oldText = String(oldPost.text || '').trim();
  const newText = String(fresh.posts[0].text || '').trim();
  if (oldText.length >= 30 && newText.length >= 30 && oldText.slice(0, 60) !== newText.slice(0, 60)) throw Error('Archived text fingerprint mismatch');
  if (newText.length < oldText.length) fresh.posts[0].text = oldText;
  for (const field of ['posted_at', 'author_key', 'canonical_url', 'first_seen_at']) if (!fresh.posts[0][field] && oldPost[field]) fresh.posts[0][field] = oldPost[field];
  fresh.posts[0].raw_metadata = {...(oldPost.raw_metadata || {}), ...(fresh.posts[0].raw_metadata || {})};
  const oldComments = previous.comments || [];
  if (!Number.isInteger(body.old_comment_count) || body.old_comment_count > oldComments.length) throw Error('Old count regression');
  const oldById = {};
  for (const comment of oldComments) oldById[identity(comment)] = comment;
  fresh.comments = merge(oldById, fresh.comments || []);
  if (fresh.comments.length < Object.keys(oldById).length) throw Error('Comment count regression');
  fresh.media = merge(Object.fromEntries((previous.media || []).map((x) => [String(x.key), x])), fresh.media || []);
  fresh.authors = merge(Object.fromEntries((previous.authors || []).map((x) => [String(x.key), x])), fresh.authors || []);
  const saved = await supabase('rpc/archive_ingest_batch', 'POST', {payload: fresh}, 'public');
  const confirmed = await batch(id);
  if ((confirmed.payload?.comments || []).length < Object.keys(oldById).length) throw Error('Readback count regression');
  return {saved, old_comment_count: Object.keys(oldById).length, new_comment_count: fresh.comments.length};
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, {status: 204, headers: cors});
  if (!(await authorized(req))) return response(401, {error: 'Unauthorized'});
  try {
    const path = new URL(req.url).pathname;
    if (req.method === 'GET' && path.endsWith('/queue')) return response(200, await queue());
    if (req.method === 'POST' && path.endsWith('/ingest')) {
      if (Number(req.headers.get('content-length')) > 700000) return response(413, {error: 'Invalid request size'});
      const raw = await req.text();
      if (!raw || new TextEncoder().encode(raw).length > 700000) return response(413, {error: 'Invalid request size'});
      return response(200, await ingest(JSON.parse(raw)));
    }
    return response(404, {error: 'Unknown endpoint'});
  } catch (error) {
    console.error('Pilot request failed', error);
    return response(400, {error: error instanceof Error ? error.message : 'Request failed'});
  }
});


