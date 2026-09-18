#!/usr/bin/env python3
"""import_deterministic.py -- refresh the per-session deterministic sidecars, incrementally.

A stage wrapper, not a second implementation. The detectors live in
scripts/telemetry/deterministic.py, next to the other things that read raw captures; this exists so
the rebuild can call them the way it calls every other stage (scripts/db/import_*.py --db).

IT MUST RUN BEFORE `diagnosis`. import_diagnosis reads the .det.json sidecars this writes and turns
them into diag_event rows; it does not read the captures itself, because it runs on every session
close and a full 25 GB rescan would turn a seconds-long cascade into a half-hour one. This stage is
the thing that keeps that affordable: it skips any session whose sidecar is already newer than its
capture, so the steady-state cost is one session.

Run:  python scripts/db/import_deterministic.py [--db PATH] [-v] [--force]
"""
import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "scripts", "telemetry"))

import deterministic                                     # noqa: E402
import fh6db                                             # noqa: E402


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--db", default=None)
    ap.add_argument("--captures", default=None)
    ap.add_argument("--force", action="store_true", help="rescan even sidecars that are current")
    ap.add_argument("-v", "--verbose", action="store_true")
    a = ap.parse_args(argv)
    cx = fh6db.connect(a.db)
    rid = fh6db.run_begin(cx, "deterministic", "raw captures -> per-session .det.json sidecars")
    try:
        counts = deterministic.scan_all(a.db, a.captures, a.force, a.verbose, ignore_run_id=rid)
    except BaseException as e:                           # noqa: BLE001
        # BaseException, not Exception: a SystemExit here would otherwise skip run_end and leave
        # this run open forever, and since the scanner refuses while any run is open, one aborted
        # scan would permanently block every later one.
        fh6db.run_end(cx, rid, 0, 0, "%s: %s" % (type(e).__name__, e))
        raise
    fh6db.run_end(cx, rid, counts.get("scanned", 0), 1, json.dumps(counts))
    return 0


if __name__ == "__main__":
    sys.exit(main())
