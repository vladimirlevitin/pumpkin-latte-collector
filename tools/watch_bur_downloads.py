#!/usr/bin/env python3
"""
Watch Downloads for new FB Bur 0.5.19+ JSON batches.

For every accepted file:
  1. archive the untouched JSON in private Supabase Storage bucket "bur-raw";
  2. import/upsert its structured data into the archive schema.

On first start, four previously accepted backpackIL packages are also backfilled,
but only when their exact raw-file SHA-256 matches the trusted allowlist below.
Other legacy 0.5.12/0.5.17/0.5.18 files are ignored.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import time
from pathlib import Path

from import_bur_json import (
    DEFAULT_SUPABASE_URL,
    get_secret,
    import_file,
    validate_local,
)

# Exact raw-file hashes of the four historical backpackIL packages that were
# reviewed and accepted before the continuous 0.5.19 pipeline.
TRUSTED_BACKFILL_SHA256 = {
    "0591a2a7fd6c7918a326fe0390a5127beae657e0bc53d03e9e63e101117219a2":
        "backpackIL accepted batch 0.5.12 (7)",
    "8886279193fb2a3525168dbeee29c2d7f2101fe0c67be3ea0e748b4d4ed720eb":
        "backpackIL accepted batch 0.5.17 (9)",
    "70dc7f1a36bf8f2bfb3ca9020c9f3b6ac1587b5345891932baba426ed84231d3":
        "backpackIL accepted batch 0.5.18 (1)",
    "c51212c8fd734878ed131e5dbc43e68a94b3dbd61bf50739aedb16898a81404d":
        "backpackIL accepted batch 0.5.18 (2)",
}


def parse_version(value: str) -> tuple[int, int, int]:
    core = value.split("-", 1)[0]
    parts = core.split(".")
    if len(parts) != 3:
        return (0, 0, 0)
    try:
        return tuple(int(x) for x in parts)  # type: ignore[return-value]
    except ValueError:
        return (0, 0, 0)


def sha256_path(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def is_auto_eligible(path: Path) -> tuple[bool, str]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        validate_local(payload, path)
    except Exception as exc:
        return False, f"invalid JSON: {exc}"

    version = str(payload.get("collector_version") or "")
    if parse_version(version) < (0, 5, 19):
        return False, f"legacy collector {version}"

    job = payload.get("job_summary") or {}
    if job.get("stage") != "done":
        return False, f"stage={job.get('stage')!r}"

    algorithm = str(job.get("checkpoint_algorithm") or "")
    if parse_version(version) == (0, 5, 19) and algorithm != "continuous_feed_v3":
        return False, f"unexpected checkpoint algorithm {algorithm!r}"

    # 0.5.19 continuous exports must identify the batch. Newer versions may
    # evolve the format, but still need a batch number for safe auto-ingest.
    batch_number = job.get("batch_number")
    if batch_number is None:
        return False, "missing batch_number"

    return True, "ok"


def state_path() -> Path:
    base = Path(os.environ.get("LOCALAPPDATA") or (Path.home() / ".fb-bur"))
    p = base / "FB-Bur"
    p.mkdir(parents=True, exist_ok=True)
    return p / "supabase-imported.json"


def load_state(path: Path) -> dict:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except FileNotFoundError:
        return {}
    except Exception:
        return {}


def save_state(path: Path, data: dict) -> None:
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def file_key(path: Path) -> str:
    st = path.stat()
    return f"{path.resolve()}|{st.st_size}|{st.st_mtime_ns}"


def scan_candidates(folder: Path) -> list[Path]:
    files = [p for p in folder.glob("bur-raw-*.json") if p.is_file()]
    return sorted(files, key=lambda p: (p.stat().st_mtime_ns, p.name))


def scan_backfill_candidates(folder: Path) -> list[Path]:
    # One-time recursive scan is intentional: accepted legacy files may have
    # been moved into a subfolder. Ongoing 0.5.19 scans remain non-recursive.
    files = [p for p in folder.rglob("bur-raw-*.json") if p.is_file()]
    return sorted(files, key=lambda p: (p.stat().st_mtime_ns, p.name))


def record_result(target: dict, result: dict) -> None:
    target.update({
        "status": "ok",
        "at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "crawl_run_id": result.get("crawl_run_id"),
        "group": result.get("group"),
        "posts_seen": result.get("posts_seen"),
        "posts_new": result.get("posts_new"),
        "posts_updated": result.get("posts_updated"),
        "comments_seen": result.get("comments_seen"),
        "last_collected_post_id": result.get("last_collected_post_id"),
        "reused": bool(result.get("reused")),
        "storage_bucket": result.get("storage_bucket"),
        "storage_path": result.get("storage_path"),
        "storage_status": result.get("storage_status"),
        "source_file_sha256": result.get("source_file_sha256"),
    })


def backfill_trusted_legacy(
    folder: Path,
    base_url: str,
    secret: str,
    state: dict,
    state_file: Path,
) -> None:
    backfill = state.setdefault("trusted_backfill", {})

    for path in scan_backfill_candidates(folder):
        digest = sha256_path(path)
        label = TRUSTED_BACKFILL_SHA256.get(digest)
        if not label or backfill.get(digest, {}).get("status") == "ok":
            continue

        print(f"BACKFILL {path.name}: {label}")
        try:
            result = import_file(path, base_url, secret)
            entry = {"label": label, "file": str(path)}
            record_result(entry, result)
            backfill[digest] = entry
            save_state(state_file, state)
            print(
                f"OK   backfill {path.name}: storage={result.get('storage_status')} "
                f"path={result.get('storage_path')} reused={bool(result.get('reused'))}"
            )
        except Exception as exc:
            backfill[digest] = {
                "status": "failed",
                "label": label,
                "file": str(path),
                "error": str(exc),
                "at": time.strftime("%Y-%m-%dT%H:%M:%S"),
            }
            save_state(state_file, state)
            print(f"FAIL backfill {path.name}: {exc}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("folder", nargs="?", default=str(Path.home() / "Downloads"))
    parser.add_argument("--once", action="store_true", help="backfill + scan once and exit")
    parser.add_argument("--interval", type=float, default=5.0)
    args = parser.parse_args()

    folder = Path(args.folder).expanduser()
    if not folder.exists():
        print(f"Folder does not exist: {folder}")
        return 2

    try:
        secret = get_secret()
    except Exception as exc:
        print(f"Secret key error: {exc}")
        return 2

    base_url = os.environ.get("SUPABASE_URL", DEFAULT_SUPABASE_URL).strip()
    state_file = state_path()
    state = load_state(state_file)
    imported = state.setdefault("imported", {})
    stable_sizes: dict[str, int] = {}

    print(f"Watching: {folder}")
    print(f"State:    {state_file}")
    print("Storage:  private bucket bur-raw (archive first, DB second)")
    print("Auto-import: FB Bur 0.5.19+ continuous-session JSON.")
    print("Legacy backfill: exact SHA-256 allowlist only.")

    backfill_trusted_legacy(folder, base_url, secret, state, state_file)

    if not args.once:
        print("Press Ctrl+C to stop.")

    try:
        while True:
            for path in scan_candidates(folder):
                key = file_key(path)
                if key in imported:
                    continue

                size = path.stat().st_size
                prev = stable_sizes.get(str(path))
                stable_sizes[str(path)] = size
                if prev is None or prev != size:
                    continue

                eligible, reason = is_auto_eligible(path)
                if not eligible:
                    # Legacy files are handled only by the exact-hash backfill above.
                    if reason.startswith("legacy collector"):
                        continue
                    print(f"SKIP {path.name}: {reason}")
                    imported[key] = {"status": "skipped", "reason": reason}
                    save_state(state_file, state)
                    continue

                try:
                    result = import_file(path, base_url, secret)
                    entry: dict = {}
                    record_result(entry, result)
                    imported[key] = entry
                    save_state(state_file, state)
                    print(
                        f"OK   {path.name}: group={result.get('group')} "
                        f"posts={result.get('posts_seen')} new={result.get('posts_new')} "
                        f"comments={result.get('comments_seen')} "
                        f"last={result.get('last_collected_post_id')} "
                        f"storage={result.get('storage_status')}:{result.get('storage_path')} "
                        f"reused={bool(result.get('reused'))}"
                    )
                except Exception as exc:
                    print(f"FAIL {path.name}: {exc}")

            if args.once:
                return 0
            time.sleep(max(1.0, args.interval))
    except KeyboardInterrupt:
        print("\nStopped.")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
