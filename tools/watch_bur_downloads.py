#!/usr/bin/env python3
"""
Watch a directory for new FB Bur 0.5.19+ JSON batches and import them into Supabase.

Default directory: ~/Downloads
Only continuous-session Bur batches are auto-imported.
Older/manual JSON files must be imported explicitly with import_bur_json.py.
"""
from __future__ import annotations

import argparse
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


def parse_version(value: str) -> tuple[int, int, int]:
    core = value.split("-", 1)[0]
    parts = core.split(".")
    if len(parts) != 3:
        return (0, 0, 0)
    try:
        return tuple(int(x) for x in parts)  # type: ignore[return-value]
    except ValueError:
        return (0, 0, 0)


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
    if algorithm not in {"continuous_feed_v3"} and parse_version(version) == (0, 5, 19):
        return False, f"unexpected checkpoint algorithm {algorithm!r}"

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
    files = []
    for path in folder.glob("bur-raw-*.json"):
        if path.is_file():
            files.append(path)
    return sorted(files, key=lambda p: (p.stat().st_mtime_ns, p.name))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("folder", nargs="?", default=str(Path.home() / "Downloads"))
    parser.add_argument("--once", action="store_true", help="scan once and exit")
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
    print("Auto-import: FB Bur 0.5.19+ continuous-session JSON only.")
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
                    # Do not record legacy/incomplete files as imported; they may be
                    # intentionally handled later with the one-shot importer.
                    if reason.startswith("legacy collector"):
                        continue
                    print(f"SKIP {path.name}: {reason}")
                    imported[key] = {"status": "skipped", "reason": reason}
                    save_state(state_file, state)
                    continue

                try:
                    result = import_file(path, base_url, secret)
                    imported[key] = {
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
                    }
                    save_state(state_file, state)
                    print(
                        f"OK   {path.name}: group={result.get('group')} "
                        f"posts={result.get('posts_seen')} new={result.get('posts_new')} "
                        f"comments={result.get('comments_seen')} "
                        f"last={result.get('last_collected_post_id')} "
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
