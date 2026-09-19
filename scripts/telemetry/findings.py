#!/usr/bin/env python3
"""findings.py -- turn the raw symptom events into findings that have earned the right to be stated.

diag_event answers "did this fire". It does not answer "often enough to tune against", and the two
look identical on screen today: on the densest cell we own, 19 of the 45 (symptom, turn) pairs fire
on a tenth of laps or fewer, and they render beside one that fires on 70%. This applies
confidence.py to every pair and sorts them into report / watching / insufficient.

THE DENOMINATOR IS THE POINT. A finding is k passes of a turn out of n, so n has to be the number of
passes that COULD have shown it -- every whole lap in the cell, not the number of laps that happened
to fire. Counting only the laps that fired is how a fault seen twice becomes "seen on 100% of laps".
So n comes from the lap table and k from diag_event, and partial laps are excluded on both sides:
a lap that covered two thirds of the course did not pass every turn, and silently treating it as a
miss would understate every rate on the far side of the course.

ONE CELL AT A TIME, NEVER POOLED. A cell is (route, car, hw_hash, tune_hash). Pooling two tunes'
passes to reach a sample size would measure a car that never existed. If a cell is short of data the
answer is more laps on that cell, which is what the report prints.

ENTRY SPEED IS APPROXIMATED, AND HERE IS HOW. The driver test needs the speed each pass carried into
the turn. There is no per-pass entry-speed column, so this takes the highest mph among the lap's
samples that fall inside the turn's own radius -- a pass carrying more speed into the corner has a
higher figure. It is a proxy, it is only ever fed to a standardised mean difference between hit and
miss passes, and a proxy is adequate for that because the test asks whether the two groups differ,
not by how much in mph.

NEVER READ A REBUILD IN FLIGHT. import_diagnosis empties diag_event and repopulates it inside one
run, so a read landing in that window sees a partial table and every rate comes out understated --
and at the extreme, "no findings at all", which this module would then report with a straight face.
Caught live on 2026-09-18: a read mid-rebuild returned 8,126 diag_event rows against the 38,474 the
run went on to write, and the densest cell reported zero fired pairs. So every entry point checks
import_run for an unfinished diagnosis run first and refuses rather than answering from a half-built
table. Refusing is the whole doctrine of this module applied to itself.

Run:
    python scripts/telemetry/findings.py --route route:6001 --top 25
    python scripts/telemetry/findings.py --cells            # which cells hold enough data to say anything
"""
import argparse
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "scripts", "db"))
sys.path.insert(0, HERE)

import confidence as C                                   # noqa: E402
import fh6db                                             # noqa: E402

WHOLE_LAP = 0.97          # coverage at or above this passed every turn; below it, some turns never came up

# Which detectors read a physical stop (one occurrence is the occurrence) and which read a tendency.
# Stated per symptom rather than guessed from the name, because the distinction decides whether a
# single lap may raise a flag.
DETERMINISTIC = {
    "Bottoming out (suspension on the stop)",
    "Kerbs throw the car off line",
    "Floaty after crests, slow to settle",
}


def require_settled(cx):
    """Refuse to answer from a table a rebuild is still writing. See the module docstring."""
    r = cx.execute("""SELECT kind, started_utc FROM import_run
                      WHERE finished_utc IS NULL ORDER BY run_id DESC LIMIT 1""").fetchone()
    if r:
        sys.exit("a '%s' import started %s has not finished -- rerun once the rebuild settles; "
                 "reading now would understate every rate" % (r["kind"], r["started_utc"]))
    r = cx.execute("""SELECT ok, notes, finished_utc FROM import_run
                      WHERE kind='diagnosis' ORDER BY run_id DESC LIMIT 1""").fetchone()
    if not r:
        sys.exit("no diagnosis import has ever run -- `python scripts/db/rebuild.py` first")
    if not r["ok"]:
        sys.exit("the last diagnosis import (%s) failed; its diag_event rows cannot be trusted"
                 % r["finished_utc"])
    return r


def cell_laps(cx, route, cid, hw, tune):
    return cx.execute("""SELECT lap_id, coverage FROM lap
                         WHERE route_key=? AND cid=? AND hw_hash=? AND tune_hash=?
                           AND coalesce(void,0)=0 AND coalesce(coverage,0) >= ?
                         ORDER BY lap_id""", (route, cid, hw, tune, WHOLE_LAP)).fetchall()


def entry_speeds(cx, lap_ids, route):
    """{(lap_id, turn_id): proxy entry mph} -- the fastest sample inside each turn's own radius."""
    turns = cx.execute("""SELECT g.turn_id, g.apex_x, g.apex_z, g.radius_m, g.width_m
                          FROM ref_route_turn g
                          JOIN course_route cr ON cr.route_id = g.route_id
                          WHERE cr.route_key=?""", (route,)).fetchall()
    if not turns:
        return {}
    tl = []
    for t in turns:
        w = (t["width_m"] or 10.0) * 0.5 + 0.25 * (t["radius_m"] or 60.0)
        tl.append((t["turn_id"], t["apex_x"], t["apex_z"], max(18.0, min(70.0, w)) ** 2))
    out = {}
    for lap_id in lap_ids:
        for p in cx.execute("SELECT mph, x, z FROM lap_point WHERE lap_id=? AND x IS NOT NULL", (lap_id,)):
            for tid, ax, az, w2 in tl:
                if (p["x"] - ax) ** 2 + (p["z"] - az) ** 2 <= w2:
                    k = (lap_id, tid)
                    if p["mph"] is not None and (k not in out or p["mph"] > out[k]):
                        out[k] = p["mph"]
    return out


def assess_cell(cx, route, cid, hw, tune, passes_per_lap=1.0):
    laps = cell_laps(cx, route, cid, hw, tune)
    lap_ids = [r["lap_id"] for r in laps]
    n = len(lap_ids)
    if not n:
        return n, []
    ph = ",".join("?" * len(lap_ids))
    hits = {}
    for r in cx.execute("""SELECT symptom, turn_id, lap_id, max(severity) sev FROM diag_event
                           WHERE lap_id IN (%s) GROUP BY symptom, turn_id, lap_id""" % ph, lap_ids):
        hits.setdefault((r["symptom"], r["turn_id"]), {})[r["lap_id"]] = r["sev"]
    speeds = entry_speeds(cx, lap_ids, route)

    findings = []
    for (sym, tid), lap_sev in hits.items():
        k = len(lap_sev)
        hit_mph = [speeds[(l, tid)] for l in lap_sev if (l, tid) in speeds]
        miss_mph = [speeds[(l, tid)] for l in lap_ids if l not in lap_sev and (l, tid) in speeds]
        sev = max(v for v in lap_sev.values() if v is not None) if any(
            v is not None for v in lap_sev.values()) else None
        a = C.assess(k, n,
                     evidence_class="deterministic" if sym in DETERMINISTIC else "statistical",
                     severity=sev, hit_entry_mph=hit_mph, miss_entry_mph=miss_mph,
                     passes_per_lap=passes_per_lap)
        a["symptom"], a["turn_id"], a["severity"] = sym, tid, sev
        findings.append(a)
    order = {C.REPORT: 0, C.WATCHING: 1, C.INSUFFICIENT: 2, C.NOT_RECURRENT: 3}
    findings.sort(key=lambda f: (order[f["verdict"]], -f["lo"], -f["rate"]))
    return n, findings


def cmd_cells(args):
    cx = fh6db.connect(ro=True)
    require_settled(cx)
    rows = cx.execute("""SELECT route_key, cid, hw_hash, tune_hash, count(*) n
                         FROM lap WHERE coalesce(void,0)=0 AND tune_hash IS NOT NULL
                           AND coalesce(coverage,0) >= ? AND route_key IS NOT NULL
                         GROUP BY 1,2,3,4 HAVING n >= ? ORDER BY n DESC""",
                      (WHOLE_LAP, args.min_laps)).fetchall()
    print("cells with >= %d whole clean laps on one build and one tune:" % args.min_laps)
    for r in rows:
        print("  %-14s %-18s hw %s tune %s  %3d laps" % (r["route_key"], r["cid"], r["hw_hash"],
                                                         r["tune_hash"], r["n"]))
    if not rows:
        print("  (none)")
    print("\n%d cells. Everything below the floor needs more laps on ONE tune, not more tunes."
          % len(rows))


def cmd_report(args):
    cx = fh6db.connect(ro=True)
    run = require_settled(cx)
    if args.cid:
        cells = [(args.route, args.cid, args.hw, args.tune)]
    else:
        cells = [(r["route_key"], r["cid"], r["hw_hash"], r["tune_hash"]) for r in cx.execute(
            """SELECT route_key, cid, hw_hash, tune_hash, count(*) n FROM lap
               WHERE route_key=? AND coalesce(void,0)=0 AND tune_hash IS NOT NULL
                 AND coalesce(coverage,0) >= ?
               GROUP BY 1,2,3,4 ORDER BY n DESC LIMIT 1""", (args.route, WHOLE_LAP))]
    for route, cid, hw, tune in cells:
        n, fs = assess_cell(cx, route, cid, hw, tune)
        name = cx.execute("SELECT name FROM course WHERE route_key=?", (route,)).fetchone()
        print("== %s  car %s  hw %s  tune %s" % (name["name"] if name else route, cid, hw, tune))
        print("   %d whole clean laps  (diagnosis built %s)" % (n, run["finished_utc"]))
        tally = {}
        for f in fs:
            tally[f["verdict"]] = tally.get(f["verdict"], 0) + 1
        print("   %d pairs fired: %d report, %d watching, %d need more laps, %d ruled out" % (
            len(fs), tally.get(C.REPORT, 0), tally.get(C.WATCHING, 0),
            tally.get(C.INSUFFICIENT, 0), tally.get(C.NOT_RECURRENT, 0)))
        print()
        for f in fs[:args.top]:
            tag = {C.REPORT: "REPORT  ", C.WATCHING: "WATCH   ", C.INSUFFICIENT: "MORE    ",
                   C.NOT_RECURRENT: "RULEDOUT"}[f["verdict"]]
            flag = " [driver-linked]" if f["driver_linked"] else ""
            print("  %s T%-5s %-46s %2d/%-3d  %.0f-%.0f%%%s" % (
                tag, f["turn_id"], f["symptom"][:46], f["k"], f["n"],
                f["lo"] * 100, f["hi"] * 100, flag))
            print("          %s" % f["why"])
        print()


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd")
    r = ap
    r.add_argument("--route", default="route:6001")
    r.add_argument("--cid"); r.add_argument("--hw"); r.add_argument("--tune")
    r.add_argument("--top", type=int, default=20)
    r.add_argument("--cells", action="store_true", help="list cells with enough laps instead")
    r.add_argument("--min-laps", type=int, default=10)
    a = ap.parse_args()
    (cmd_cells if a.cells else cmd_report)(a)


if __name__ == "__main__":
    main()
