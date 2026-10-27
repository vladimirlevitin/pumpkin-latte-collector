#!/usr/bin/env python3
"""
Import FB Bur JSON exports into the Supabase archive schema.

Usage:
  set SUPABASE_SECRET_KEY=sb_secret_...
  python tools/import_bur_json.py "bur-raw-backpackIL-2026-10-27 (2).json"

Multiple files may be passed in one command.
"""
from __future__ import annotations

import getpass
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

DEFAULT_SUPABASE_URL = "https://ltznpjfnkpydautbsrej.supabase.co"
RPC_PATH = "/rest/v1/rpc/bur_import_json_safe"


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


def import_file(path: Path, base_url: str, secret: str) -> dict:
    payload = json.loads(path.read_text(encoding="utf-8"))
    validate_local(payload, path)

    body = json.dumps(
        {"payload": payload, "source_filename": path.name},
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
        raise RuntimeError(f"HTTP {exc.code}: {detail}") from exc

    result = json.loads(raw)
    if not result.get("ok"):
        raise RuntimeError(json.dumps(result, ensure_ascii=False))
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
                f"last={result.get('last_collected_post_id')} reused={bool(result.get('reused'))}"
            )
        except Exception as exc:
            failed += 1
            print(f"FAIL {path}: {exc}", file=sys.stderr)

    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
