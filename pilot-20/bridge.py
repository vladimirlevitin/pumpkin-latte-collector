"""Loopback-only Supabase bridge. Set SUPABASE_SERVICE_ROLE_KEY and PILOT_TOKEN."""
import json
import os
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.request import Request, urlopen
from urllib.parse import quote

PROJECT = "https://ltznpjfnkpydautbsrej.supabase.co"
SECRET = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
TOKEN = os.environ["PILOT_TOKEN"]
LIMIT = 20

def supabase(path, method="GET", data=None, profile="archive"):
    headers = {"apikey": SECRET, "Authorization": "Bearer " + SECRET,
               "Accept-Profile": profile, "Content-Type": "application/json"}
    if method != "GET":
        headers["Content-Profile"] = profile
    request = Request(PROJECT + "/rest/v1/" + path, data=json.dumps(data).encode() if data is not None else None,
                      headers=headers, method=method)
    with urlopen(request, timeout=30) as response:
        return json.load(response)

def batch(post_id):
    rows = supabase("collector_batches?select=batch_key,facebook_post_id,payload,updated_at&group_slug=eq.pumpkinlatte&facebook_post_id=eq." + quote(post_id) + "&limit=1")
    if len(rows) != 1:
        raise ValueError("Batch missing or ambiguous")
    return rows[0]

def comment_identity(row):
    return str(row.get("facebook_comment_id") or row.get("key") or "")

def merge(old, new):
    merged = dict(old)
    for row in new:
        key = comment_identity(row)
        if not key:
            raise ValueError("Comment without stable identity")
        previous = merged.get(key)
        if previous is None or len(str(row.get("text") or "")) >= len(str(previous.get("text") or "")):
            merged[key] = row
    return list(merged.values())

class Handler(BaseHTTPRequestHandler):
    def respond(self, status, value):
        data = json.dumps(value, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def handle_request(self):
        if self.headers.get("Authorization") != "Bearer " + TOKEN:
            return self.respond(401, {"error": "Unauthorized"})
        if self.path == "/queue" and self.command == "GET":
            rows = supabase("collector_batches?select=batch_key,facebook_post_id,payload,updated_at&group_slug=eq.pumpkinlatte&facebook_post_id=not.is.null&order=updated_at.asc&limit=1000")
            queue = []
            for row in rows:
                payload = row.get("payload") or {}
                posts = payload.get("posts") or []
                if len(posts) != 1:
                    continue
                post = posts[0]
                meta = post.get("raw_metadata") or {}
                if meta.get("needs_enrichment") is not True or "v2.8." in str(payload.get("collector_version") or ""):
                    continue
                post_id = str(row.get("facebook_post_id") or "")
                if not re.fullmatch(r"[0-9]+", post_id) or row.get("batch_key") != f"fb:pumpkinlatte:post:{post_id}":
                    continue
                queue.append({"facebook_post_id": post_id, "batch_key": row["batch_key"],
                              "old_comment_count": len(payload.get("comments") or []), "status": "pending",
                              "attempts": 0, "last_error": "", "new_comment_count": None})
                if len(queue) == LIMIT:
                    break
            return self.respond(200, {"queue": queue})
        if self.path == "/ingest" and self.command == "POST":
            n = int(self.headers.get("Content-Length", "0"))
            if n <= 0 or n > 700000:
                raise ValueError("Invalid request size")
            body = json.loads(self.rfile.read(n))
            post_id = str(body.get("id") or "")
            if not re.fullmatch(r"[0-9]+", post_id):
                raise ValueError("Invalid post ID")
            old_batch = batch(post_id)
            previous = old_batch["payload"]
            fresh = body.get("payload") or {}
            key = f"fb:pumpkinlatte:post:{post_id}"
            if fresh.get("batch_key") != key or fresh.get("facebook_post_id") != post_id or len(fresh.get("posts") or []) != 1:
                raise ValueError("Payload identity mismatch")
            if fresh["posts"][0].get("key") != key or str(fresh["posts"][0].get("facebook_post_id")) != post_id:
                raise ValueError("Post identity mismatch")
            old_post = (previous.get("posts") or [{}])[0]
            old_text = str(old_post.get("text") or "").strip()
            new_text = str(fresh["posts"][0].get("text") or "").strip()
            if len(old_text) >= 30 and len(new_text) >= 30 and old_text[:60] != new_text[:60]:
                raise ValueError("Archived text fingerprint mismatch")
            if len(new_text) < len(old_text):
                fresh["posts"][0]["text"] = old_text
            for field in ("posted_at", "author_key", "canonical_url", "first_seen_at"):
                if not fresh["posts"][0].get(field) and old_post.get(field):
                    fresh["posts"][0][field] = old_post[field]
            fresh["posts"][0]["raw_metadata"] = {
                **(old_post.get("raw_metadata") or {}),
                **(fresh["posts"][0].get("raw_metadata") or {})}
            if int(body.get("old_comment_count", -1)) > len(previous.get("comments") or []):
                raise ValueError("Old count regression")
            old_comments = {comment_identity(x): x for x in previous.get("comments") or []}
            fresh["comments"] = merge(old_comments, fresh.get("comments") or [])
            if len(fresh["comments"]) < len(old_comments):
                raise ValueError("Comment count regression")
            fresh["media"] = merge({str(x.get("key")): x for x in previous.get("media") or []}, fresh.get("media") or [])
            fresh["authors"] = merge({str(x.get("key")): x for x in previous.get("authors") or []}, fresh.get("authors") or [])
            # Only call the existing archive RPC after every identity and regression check.
            saved = supabase("rpc/archive_ingest_batch", "POST", {"payload": fresh}, "public")
            confirmed = batch(post_id)
            if len((confirmed.get("payload") or {}).get("comments") or []) < len(old_comments):
                raise ValueError("Readback count regression")
            return self.respond(200, {"saved": saved, "old_comment_count": len(old_comments),
                                      "new_comment_count": len(fresh["comments"])})
        return self.respond(404, {"error": "Unknown endpoint"})

    def do_GET(self):
        try: self.handle_request()
        except Exception as error: self.respond(400, {"error": str(error)})

    def do_POST(self):
        try: self.handle_request()
        except Exception as error: self.respond(400, {"error": str(error)})

if __name__ == "__main__":
    print("Pumpkin Latte bridge listening on 127.0.0.1:8765")
    ThreadingHTTPServer(("127.0.0.1", 8765), Handler).serve_forever()
