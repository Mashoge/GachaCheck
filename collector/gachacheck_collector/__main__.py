"""Command line.

  python -m gachacheck_collector wuwa --print     fetch and parse, print the payload, send nothing
  python -m gachacheck_collector wuwa --dry-run   send to the ingest function as a dry run (saves nothing)
  python -m gachacheck_collector wuwa             send for real

Sending needs two environment variables: INGEST_URL and INGEST_SECRET.
"""

from __future__ import annotations

import argparse
import json
import os
import sys

from . import nte, wuwa
from .ingest import IngestError, send
from .models import build_payload

ADAPTERS = {"wuwa": wuwa, "nte": nte}


def main(argv: list[str] | None = None) -> int:
    # Always write UTF-8. On Windows, piped output otherwise falls back to cp1252, which has no
    # characters like 「 or ✦ that the official pages use, and printing would crash.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(prog="gachacheck_collector", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("game", choices=sorted(ADAPTERS))
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--print", action="store_true", dest="print_only", help="print the payload and send nothing")
    mode.add_argument("--dry-run", action="store_true", help="send as a dry run; nothing is saved")
    args = parser.parse_args(argv)

    adapter = ADAPTERS[args.game]
    try:
        articles = adapter.collect()
    except Exception as err:  # network errors, a changed format, ...
        print(f"Could not read the {args.game} source: {err}", file=sys.stderr)
        return 1

    for a in articles:
        print(f"{a.external_id}  {a.title}")
        print(f"    {len(a.observations)} items, complete={a.complete}")
        if a.version_release:
            print(f"    version {a.version_release['version']} goes live {a.version_release['released_at']}")
        for problem in a.problems:
            print(f"    PROBLEM: {problem}")
    if not articles:
        print("No current articles to read. Nothing sent.")
        return 0

    payload = build_payload(adapter.SOURCE, adapter.GAME, articles)
    if args.print_only:
        print(json.dumps(payload, indent=2, ensure_ascii=False))
        return 0

    url, secret = os.environ.get("INGEST_URL"), os.environ.get("INGEST_SECRET")
    if not url or not secret:
        print("Set INGEST_URL and INGEST_SECRET first (see collector/README.md).", file=sys.stderr)
        return 2

    try:
        reply = send(payload, url, secret, dry_run=args.dry_run)
    except (IngestError, OSError) as err:
        print(f"Sending failed: {err}", file=sys.stderr)
        return 1

    print(("DRY RUN, nothing saved: " if args.dry_run else "Saved: ") + json.dumps(reply.get("counts", {})))
    if reply.get("versions"):
        print("    versions: " + json.dumps(reply["versions"]))
    for item in reply.get("items", []):
        status = f" ({item['status']})" if item.get("status") else ""
        print(f"    {item.get('action')}{status}: {item.get('name', item.get('key'))}")
    # A parsing problem is worth a failed run, so it gets noticed
    return 3 if any(a.problems for a in articles) else 0


if __name__ == "__main__":
    raise SystemExit(main())
