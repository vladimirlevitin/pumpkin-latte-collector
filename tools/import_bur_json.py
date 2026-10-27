#!/usr/bin/env python3
"""
Archive FB Bur JSON exports in Supabase Storage, then import them into the archive schema.

Usage:
  set SUPABASE_SECRET_KEY=sb_secret_...
  python tools/import_bur_json.py "bur-raw-backpackIL-2026-10-27 (2).json"

Multiple files may be passed in one command.
"""
from __future__ import annotations

import getpass
import hashlib
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

DEFAULT_SUPABASE_URL = "https://ltznpjfnkpydautbsrej.supabase.co"
STORAGE_BUCKET = "bur-raw"
RPC_PATH = "/rest/v1/rpc/bur_import_archived_json"


def validate_local(payload: dict, path: Path) -> None:
    if payload.get("schema") != "bur-collector/1":
        raise ValueError(f"{path.name}: unsupported schema")
    group = str(payload.get("group") or "")
    if not group:
        raise ValueError(f"{path.name}: missing group")
    posts = payload.get("posts")
    if not isinstance(posts, list) or not posts:
        raise ValueError(f"{path.name}: missing posts")
    ids = [str(p.get("post_id") or "") for p in posts]
    if any(not x.isdigit() for x in ids):
        raise ValueError(f"{path.name}: invalid post_id")
    if len(ids) != len(set(ids)):
        raise ValueError(f"{path.name}: duplicate post_id inside JSON")
    order = (payload.get("job_summary") or {}).get("discovery_order") or []
    if order and set(map(str, order)) != set(ids):
        raise ValueError(f"{path.name}: discovery_order does not match posts")


def safe_component(value: str) -> str:
    clean = re.sub(r"[^A-Za-z0-9._-]+", "_", value.strip())
    return clean.strip("._-") or "unknown"


def storage_object_path(payload: dict, file_sha256: str) -> str:
    group = safe_component(str(payload.get("group") or "unknown"))
    created = str(payload.get("created_at") or "")
    match = re.match(r"^(\d{4})-(\d{2})", created)
    if match:
        year, month = match.groups()
    else:
        year, month = "undated", "00"
    # Content-addressed storage: exact same raw JSON always maps to exact same object.
    return f"{group}/{year}/{month}/{file_sha256}.json"


def upload_raw_json(
    raw_bytes: bytes,
    object_path: str,
    base_url: str,
    secret: str,
) -> str:
    encoded_bucket = urllib.parse.quote(STORAGE_BUCKET, safe="")
    encoded_path = urllib.parse.quote(object_path, safe="/")
    url = (
        base_url.rstrip("/")
        + f"/storage/v1/object/{encoded_bucket}/{encoded_path}"
    )

    req = urllib.request.Request(
        url,
        data=raw_bytes,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "apikey": secret,
            "x-upsert": "false",
            # Paths are content-addressed and immutable.
            "cache-control": "31536000",
        },
    )

    try:
        with urllib.request.urlopen(req, timeout=300) as resp:
            resp.read()
        return "uploaded"
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        lowered = detail.lower()
        if exc.code in (400, 409) and (
            "already exists" in lowered
            or "duplicate" in lowered
            or "resource exists" in lowered
        ):
            return "exists"
        raise RuntimeError(f"Storage HTTP {exc.code}: {detail}") from exc


def import_file(path: Path, base_url: str, secret: str) -> dict:
    raw_bytes = path.read_bytes()
    file_sha256 = hashlib.sha256(raw_bytes).hexdigest()

    try:
        payload = json.loads(raw_bytes.decode("utf-8"))
    except UnicodeDecodeError as exc:
        raise ValueError(f"{path.name}: JSON is not UTF-8") from exc

    validate_local(payload, path)
    object_path = storage_object_path(payload, file_sha256)

    storage_status = upload_raw_json(
        raw_bytes=raw_bytes,
        object_path=object_path,
        base_url=base_url,
        secret=secret,
    )

    body = json.dumps(
        {
            "payload": payload,
            "source_filename": path.name,
            "storage_bucket": STORAGE_BUCKET,
            "storage_path": object_path,
            "source_file_sha256": file_sha256,
        },
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")

    req = urllib.request.Request(
        base_url.rstrip("/") + RPC_PATH,
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "apikey": secret,
        },
    )

    try:
        with urllib.request.urlopen(req, timeout=300) as resp:
            raw = resp.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(
            f"Database import failed after Storage {storage_status}: "
            f"HTTP {exc.code}: {detail}"
        ) from exc

    result = json.loads(raw)
    if not result.get("ok"):
        raise RuntimeError(json.dumps(result, ensure_ascii=False))

    result["storage_status"] = storage_status
    return result


def get_secret() -> str:
    secret = os.environ.get("SUPABASE_SECRET_KEY", "").strip()
    if not secret and sys.stdin.isatty():
        secret = getpass.getpass("Supabase secret key (sb_secret_...): ").strip()
    if not secret:
        raise RuntimeError("SUPABASE_SECRET_KEY is not set")
    if not secret.startswith("sb_secret_"):
        raise RuntimeError("Use a Supabase secret key (sb_secret_...), never a publishable key")
    return secret


def main() -> int:
    if len(sys.argv) < 2:
        print("Usage: python tools/import_bur_json.py <file1.json> [file2.json ...]", file=sys.stderr)
        return 2

    try:
        secret = get_secret()
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        return 2

    base_url = os.environ.get("SUPABASE_URL", DEFAULT_SUPABASE_URL).strip()
    failed = 0

    for raw_path in sys.argv[1:]:
        path = Path(raw_path)
        try:
            result = import_file(path, base_url, secret)
            print(
                f"OK  {path.name}: group={result.get('group')} "
                f"posts={result.get('posts_seen')} new={result.get('posts_new')} "
                f"updated={result.get('posts_updated')} comments={result.get('comments_seen')} "
                f"last={result.get('last_collected_post_id')} reused={bool(result.get('reused'))} "
                f"storage={result.get('storage_status')}:{result.get('storage_path')}"
            )
        except Exception as exc:
            failed += 1
            print(f"FAIL {path}: {exc}", file=sys.stderr)

    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
