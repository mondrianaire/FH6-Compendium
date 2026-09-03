#!/usr/bin/env python3
"""rebuild.py -- rebuild data/fh6.db from every source, in order.

    python scripts/db/rebuild.py                 # everything
    python scripts/db/rebuild.py --only gamedb   # one stage
    python scripts/db/rebuild.py --check         # verify only, import nothing

Stage order matters: the ref_ layer must exist before containers can resolve a part name, and
containers must exist before laps can be bound to the setup that drove them.

Every stage is idempotent, so running this twice is a no-op the second time. That is the property
that makes the database safe to rebuild rather than patch.
"""
import argparse
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)

import fh6db                                            # noqa: E402

STAGES = [
    ("gamedb", "import_gamedb.py", "the game's own catalogue, strings, physics and cars"),
    ("containers", "import_containers.py", "save containers -> parts, sliders, gears, packages"),
    ("telemetry", "import_telemetry.py", "sessions, courses, laps and per-sample trace rows"),
    ("routes", "import_routes.py", "the game's route centre-lines and how our courses map on"),
    ("surface", "import_surface.py", "what the road at every turn is made of, from the nav graph"),
    ("corners", "import_corners.py", "what every lap did at every road-derived turn"),
    ("observations", "import_observations.py", "human evidence, name grading, clone readiness"),
    ("diagnosis", "import_diagnosis.py", "failure catalogue x detectors, placed on turns"),
]


def run_stage(name, script, db, verbose):
    cmd = [sys.executable, os.path.join(HERE, script)]
    if db:
        cmd += ["--db", db]
    if verbose:
        cmd += ["-v"]
    t0 = time.time()
    print("\n== %s: %s" % (name, dict((s[0], s[2]) for s in STAGES)[name]))
    env = dict(os.environ, PYTHONIOENCODING="utf-8")
    p = subprocess.run(cmd, cwd=ROOT, env=env)
    if p.returncode:
        raise SystemExit("stage %s failed with exit %d" % (name, p.returncode))
    print("   (%.1fs)" % (time.time() - t0))


def report(db):
    cx = fh6db.connect(db, ro=True)
    counts = fh6db.table_counts(cx)
    groups = [("reference (the game's truth)", "ref_"), ("saves", "tune_"),
              ("hardware packages", "hw_"), ("telemetry", ("session", "course", "lap", "corner")),
              ("observations", "obs_"), ("materialized", "plan_")]
    print("\n%s" % ("-" * 58))
    for label, pref in groups:
        rows = [(t, n) for t, n in counts.items()
                if (t.startswith(pref) if isinstance(pref, str) else t.startswith(pref))]
        if not rows:
            continue
        print("%s" % label)
        for t, n in sorted(rows):
            print("   %-22s %9d" % (t, n))
    p = fh6db.db_path(db)
    print("%s\n%-25s %9.1f MB" % ("-" * 58, os.path.basename(p), os.path.getsize(p) / 1048576.0))
    return cx


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--db", default=None)
    ap.add_argument("--only", choices=[s[0] for s in STAGES], action="append")
    ap.add_argument("--check", action="store_true", help="report and verify, import nothing")
    ap.add_argument("-v", "--verbose", action="store_true")
    a = ap.parse_args(argv)

    if not a.check:
        cx = fh6db.connect(a.db)
        fh6db.ensure_schema(cx)
        cx.close()
        for name, script, _ in STAGES:
            if a.only and name not in a.only:
                continue
            run_stage(name, script, a.db, a.verbose)

    cx = report(a.db)
    bad = cx.execute("PRAGMA foreign_key_check").fetchall()
    integ = cx.execute("PRAGMA integrity_check").fetchone()[0]
    empty = [t for t, n in fh6db.table_counts(cx).items()
             if t.startswith("ref_") and n == 0]
    print("\nintegrity: %s   foreign keys: %s   empty ref_ tables: %s"
          % (integ, "clean" if not bad else "%d violations" % len(bad), empty or "none"))
    return 0 if (integ == "ok" and not bad) else 1


if __name__ == "__main__":
    sys.exit(main())
