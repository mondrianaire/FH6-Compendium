#!/usr/bin/env python3
"""import_corners.py -- what every lap did at every turn, with the turn's own geometry beside it.

This is the join that makes a lap-time difference explainable. Until now two laps could differ by
a second and the only honest thing to say was "the tune changed, or the driving did". A lap is
now cut against turns that come from the ROAD -- fixed radius, width and banking, identical for
every lap -- so a difference lands on a specific corner, and that corner arrives with the physical
reasons it might behave differently.

Association is SPATIAL, not by arc. Our lap arc is measured along the course we learned; the turn
arc is measured along the game's route, and the two do not share an origin or even a length (the
Highway Circuit is 6,980 m of a 8,749 m route). Distance to the apex is the same number in both
frames, so that is what is used.

Per lap per turn it records the speed entering, at the apex and leaving, the slowest point, how
long the car was in the corner, and the worst grip state seen there.

Run:  python scripts/db/import_corners.py [--db PATH] [-v]
"""
import argparse
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)

import fh6db                                            # noqa: E402

# how close a sample must be to the apex to count as "in this corner". A corner is not a point:
# scale with the road's own width so a wide sweeper claims a wider window than a narrow hairpin.
def window_m(turn):
    w = turn["width_m"] or 10.0
    r = turn["radius_m"] or 60.0
    return max(18.0, min(70.0, 0.5 * w + 0.25 * r))


try:
    import numpy as _np                                   # spatial nearest-route-point for the segment map
except Exception:                                         # noqa: BLE001
    _np = None

# a route point in two phases' spans (a straight is the previous turn's straight AND the next turn's
# braking) goes to the higher-priority one -- the corner phases win over the connectors.
_SEG_PRI = {"mid": 3, "turn_in": 2, "exit": 2, "braking": 1, "straight": 0}


def _route_segment_map(rp, seg_turns):
    """Per route point, the (turn_id, phase) it belongs to, plus the point coords as arrays -- so a lap
    sample's nearest route point names the 5-segment phase it was driven in (association stays spatial)."""
    rx = [p["x"] for p in rp]
    rz = [p["z"] for p in rp]
    arc = [0.0]
    for i in range(1, len(rp)):
        arc.append(arc[-1] + math.hypot(rx[i] - rx[i - 1], rz[i] - rz[i - 1]))
    ivs = []
    for t in seg_turns:
        try:
            segs = json.loads(t["segments"])
        except Exception:                                 # noqa: BLE001
            continue
        for name, ab in segs.items():
            ivs.append((ab[0], ab[1], t["turn_id"], name, _SEG_PRI.get(name, 0)))

    def seg_at(x):
        best = (-1, (None, None))
        for a, b, tid, name, pri in ivs:
            inside = (a <= x <= b) if a <= b else (x >= a or x <= b)   # a>b spans the start/finish (loops)
            if inside and pri > best[0]:
                best = (pri, (tid, name))
        return best[1]
    return [seg_at(arc[i]) for i in range(len(rp))], _np.array(rx, float), _np.array(rz, float)


def run(cx, verbose=False):
    # only courses whose game route we identified BY SHAPE can carry road-derived turns: an
    # 'anchored' course (start sphere only, route_id NULL) never reaches here, and the kind is
    # named so a future kind cannot slip in on route_id alone (review, 2026-09-05)
    courses = cx.execute("""
        SELECT c.route_key, c.name, cr.route_id, cr.match_kind
        FROM course c JOIN course_route cr ON cr.route_key = c.route_key
        WHERE cr.route_id IS NOT NULL AND cr.match_kind IN ('verified', 'probable', 'partial')""").fetchall()
    rows, seg_rows, skipped = [], [], 0
    for co in courses:
        turns = [dict(t) for t in cx.execute("""
            SELECT turn_id, seq, apex_x, apex_z, radius_m, width_m, bank_deg, kind, angle_deg
            FROM ref_route_turn WHERE route_id=? ORDER BY seq""", (co["route_id"],))]
        if not turns:
            continue
        for t in turns:
            t["_w2"] = window_m(t) ** 2
        # the 5-segment lap map for this route: every route point's phase, when segments are stored
        rpt_seg = RX = RZ = None
        if _np is not None:
            rp = cx.execute("SELECT x,z FROM ref_route_point WHERE route_id=? ORDER BY i", (co["route_id"],)).fetchall()
            st = cx.execute("SELECT turn_id, segments FROM ref_route_turn WHERE route_id=? AND segments IS NOT NULL", (co["route_id"],)).fetchall()
            if rp and st:
                rpt_seg, RX, RZ = _route_segment_map(rp, st)
        laps = cx.execute("SELECT lap_id FROM lap WHERE route_key=?", (co["route_key"],)).fetchall()
        for lp in laps:
            pts = cx.execute("""SELECT i, arc_m, mph, grip, x, z FROM lap_point
                                WHERE lap_id=? ORDER BY i""", (lp["lap_id"],)).fetchall()
            if len(pts) < 8:
                skipped += 1
                continue
            # bucket samples by the turn whose apex they are nearest, when inside its window
            per = {}
            for p in pts:
                if p["x"] is None or p["z"] is None:
                    continue
                best, bd = None, None
                for t in turns:
                    d = (p["x"] - t["apex_x"]) ** 2 + (p["z"] - t["apex_z"]) ** 2
                    if d <= t["_w2"] and (bd is None or d < bd):
                        best, bd = t, d
                if best is not None:
                    per.setdefault(best["turn_id"], []).append((p, bd))
            for tid, hits in per.items():
                seq = [h[0] for h in hits]
                if len(seq) < 3:
                    continue
                mphs = [s["mph"] for s in seq if s["mph"] is not None]
                if not mphs:
                    continue
                apex = min(hits, key=lambda h: h[1])[0]        # the sample closest to the apex
                arcs = [s["arc_m"] for s in seq if s["arc_m"] is not None]
                span = (max(arcs) - min(arcs)) if len(arcs) > 1 else 0.0
                avg = sum(mphs) / len(mphs)
                # time in the corner from distance and mean speed: the traces carry no timestamp
                secs = (span / (avg * 0.44704)) if avg > 1 else None
                grips = [s["grip"] for s in seq if s["grip"] is not None]
                rows.append((lp["lap_id"], tid, co["route_key"],
                             mphs[0], apex["mph"], mphs[-1], min(mphs),
                             max(grips) if grips else None,
                             round(secs, 3) if secs else None, None))
            # 5-SEGMENT PASS: each sample -> its nearest route point -> that point's phase, then per
            # (turn, phase) the same speeds/grip/time as corner_obs but cut per WHERE-segment.
            if rpt_seg is not None:
                sp = [p for p in pts if p["x"] is not None and p["z"] is not None]
                if len(sp) >= 8:
                    PX = _np.array([p["x"] for p in sp], float)
                    PZ = _np.array([p["z"] for p in sp], float)
                    nn = ((RX[None, :] - PX[:, None]) ** 2 + (RZ[None, :] - PZ[:, None]) ** 2).argmin(axis=1)
                    sb = {}
                    for kk, p in enumerate(sp):
                        ts = rpt_seg[int(nn[kk])]
                        if ts[0] is not None:
                            sb.setdefault(ts, []).append(p)
                    for (stid, sname), ss in sb.items():
                        smphs = [s["mph"] for s in ss if s["mph"] is not None]
                        if len(ss) < 2 or not smphs:
                            continue
                        sarc = [s["arc_m"] for s in ss if s["arc_m"] is not None]
                        sspan = (max(sarc) - min(sarc)) if len(sarc) > 1 else 0.0
                        savg = sum(smphs) / len(smphs)
                        ssecs = (sspan / (savg * 0.44704)) if savg > 1 else None
                        sgr = [int(s["grip"]) for s in ss if s["grip"] is not None]
                        # the phase's TYPICAL grip, not its worst moment (Jett 2026-09-10): a single
                        # at-the-limit sample used to promote the whole phase to "drift". Store the full
                        # 5-state sample histogram, and let grip_state be the MODAL (most-of-the-phase)
                        # state -- calm-leaning on a tie (max() returns the lowest index).
                        ghist = gstate = None
                        if sgr:
                            hist = [0, 0, 0, 0, 0]
                            for g in sgr:
                                if 0 <= g <= 4:
                                    hist[g] += 1
                            gstate = max(range(5), key=lambda k: hist[k])
                            ghist = json.dumps(hist)
                        seg_rows.append((lp["lap_id"], stid, co["route_key"], sname, len(ss),
                                         smphs[0], smphs[-1], min(smphs), round(savg, 1),
                                         gstate, ghist, round(ssecs, 3) if ssecs else None))
    with cx:
        cx.execute("DELETE FROM corner_obs")
        n = fh6db.upsert_many(cx, "corner_obs", [
            "lap_id", "turn_id", "route_key", "entry_mph", "apex_mph", "exit_mph", "min_mph",
            "grip_state", "time_s", "score"], rows, chunk=5000)
        m = 0
        if fh6db.has_table(cx, "corner_segment"):
            cx.execute("DELETE FROM corner_segment")
            m = fh6db.upsert_many(cx, "corner_segment", [
                "lap_id", "turn_id", "route_key", "segment", "n_samples", "entry_mph", "exit_mph",
                "min_mph", "mean_mph", "grip_state", "grip_hist", "time_s"], seg_rows, chunk=5000)
    return {"corner_obs": n, "corner_segment": m, "_laps_skipped": skipped}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--db", default=None)
    ap.add_argument("-v", "--verbose", action="store_true")
    a = ap.parse_args(argv)
    cx = fh6db.connect(a.db)
    rid = fh6db.run_begin(cx, "corners", "lap_point x ref_route_turn")
    try:
        counts = run(cx, a.verbose)
    except Exception as e:                               # noqa: BLE001
        cx.rollback()
        fh6db.run_end(cx, rid, 0, 0, "%s: %s" % (type(e).__name__, e))
        raise
    fh6db.run_end(cx, rid, counts["corner_obs"], 1, json.dumps(counts))
    for k in sorted(counts):
        print("  %-18s %8d" % (k, counts[k]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
