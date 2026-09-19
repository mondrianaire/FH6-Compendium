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
import datetime
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


# ---------------------------------------------------------------------------
# GRIP ENVELOPE (schema 11) -- see db/schema.sql's grip_envelope block and
# docs/plan-grip-envelope.md. Computed here rather than as its own rebuild.py
# stage so it inherits the `corners` stage's DOWNSTREAM membership: telemetry,
# routes, anchors, course_match and consolidate all already cascade into
# corners, so a routine session import can never leave a stale envelope.
# ---------------------------------------------------------------------------

#: Scope is 15-200 m (Jett, 2026-09-18). Outside it the yaw-rate radius degrades
#: badly -- 200-400 m reads -0.182 g and 400 m+ reads -0.270 g, because at
#: near-straight radii the yaw rate is steering correction, not cornering.
ENV_BANDS = [("15-30", 15.0, 30.0), ("30-50", 30.0, 50.0), ("50-80", 50.0, 80.0),
             ("80-120", 80.0, 120.0), ("120-200", 120.0, 200.0)]
ENV_MIN_SAMPLES = 20
ENV_MIN_LAPS = 8            # gate 6: 20 correlated samples from one steady lap are not 20 trials
ENV_SATURATION_G = 2.9      # lat_g is censored at 3.00 g
ENV_MAX_SATURATED = 0.02    # gate 5: over this share, the bin's true p90 is unknowable
#: Classes whose WHOLE corpus is below the sample gate before any split. Not
#: "thin" -- unpublishable. Re-check the lap counts before removing either.
ENV_THIN_CLASSES = {"D", "X"}
#: Only a resolved, single-surface road can carry an envelope. `mixed` blends two
#: grip regimes along one route and `unknown` has no road_class at all; both are
#: computed and stored, but not published. The real fix is per-SAMPLE surface via
#: ref_route_surface (which is per route POINT), not a better route-level label.
ENV_PUBLISHABLE_SURFACES = {"tarmac", "dirt"}

_MPS = 0.44704              # mph -> m/s
_G = 9.80665


def r_mid_of(band):
    lo, hi = next((lo, hi) for b, lo, hi in ENV_BANDS if b == band)
    return (lo + hi) / 2.0


def _pct(sorted_vals, q):
    """Percentile by nearest-rank over an already-sorted list."""
    if not sorted_vals:
        return None
    k = max(0, min(len(sorted_vals) - 1, int(round(q * (len(sorted_vals) - 1)))))
    return sorted_vals[k]


def _median(sorted_vals):
    return _pct(sorted_vals, 0.5)


def build_envelope(cx, verbose=False):
    """Recompute grip_envelope from lap_point. Returns {'grip_envelope': n_rows}.

    The sample definition is the documented one: driven radius present, no
    impact, off the brakes, throttle <= 50 (the friction-circle control -- a
    sample taken under power or braking is not measuring the lateral limit), and
    a STEADY radius, meaning the radius changed by under 15 % from the previous
    sample of the same lap. Transitional samples read high: the estimator is
    measuring a direction change, not a corner.
    """
    if not fh6db.has_table(cx, "grip_envelope"):
        return {"grip_envelope": 0}
    cols = {r[1] for r in cx.execute("PRAGMA table_info(lap_point)")}
    if not {"r_m", "lat_g", "thr", "brk"} <= cols:
        return {"grip_envelope": 0}           # pre-schema-9 DB: nothing to build from

    rows = cx.execute("""
        WITH s AS (
          SELECT p.lap_id, p.r_m, ABS(p.lat_g) AS ag, p.mph, p.grip,
                 l.class AS cls, l.build_id,
                 CASE WHEN r.road_class = 'paved' THEN 'tarmac'
                      WHEN r.road_class = 'loose' THEN 'dirt'
                      WHEN r.road_class = 'mixed' THEN 'mixed'
                      ELSE 'unknown' END AS surf,
                 LAG(p.r_m) OVER (PARTITION BY p.lap_id ORDER BY p.i) AS prev_r
            FROM lap_point p
            JOIN lap l ON l.lap_id = p.lap_id
            LEFT JOIN course_route cr ON cr.route_key = l.route_key
            LEFT JOIN ref_route  r  ON r.route_id  = cr.route_id
           WHERE p.r_m IS NOT NULL AND p.lat_g IS NOT NULL
             AND p.grip != 4                      -- impacts are never grip
             AND p.brk = 0 AND p.thr <= 50        -- friction-circle control
             AND p.r_m BETWEEN 15 AND 200
             AND p.mph IS NOT NULL AND l.class IS NOT NULL)
        SELECT cls, surf, r_m, ag, mph, grip, lap_id, build_id FROM s
         WHERE prev_r IS NOT NULL AND ABS(r_m - prev_r) / r_m < 0.15""").fetchall()

    bins = {}
    for cls, surf, r_m, ag, mph, grip, lap_id, build_id in rows:
        band = next((b for b, lo, hi in ENV_BANDS if lo <= r_m < hi), None)
        if band is None:
            continue
        d = bins.setdefault(("class", cls, surf, band),
                            {"ag": [], "imp": [], "vmid": [], "laps": set(), "builds": set(),
                             "sat": 0, "g3": 0})
        d["ag"].append(ag)
        # Speed projected to the band midpoint. v ~ sqrt(r) at constant lateral g, so this
        # removes the within-band radius spread before the percentile is taken -- without it
        # a sample at 79 m and one at 51 m are pooled as though they were the same corner.
        d["vmid"].append(mph * (r_mid_of(band) / r_m) ** 0.5)
        # implied lateral g from the driven radius: a = v^2 / r
        v = mph * _MPS
        d["imp"].append((v * v / r_m) / _G)
        d["laps"].add(lap_id)
        d["builds"].add(build_id)
        if ag >= ENV_SATURATION_G:
            d["sat"] += 1
        if grip == 3:
            d["g3"] += 1

    now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    out = []
    for (scope, key, surf, band), d in sorted(bins.items()):
        lo, hi = next((lo, hi) for b, lo, hi in ENV_BANDS if b == band)
        r_mid = (lo + hi) / 2.0
        ag = sorted(d["ag"])
        n = len(ag)
        n_laps, n_builds = len(d["laps"]), len(d["builds"])
        pct_sat = d["sat"] / n
        pct_g3 = d["g3"] / n

        # Why a bin is not published, most disqualifying first. Every reason is a
        # measured fact, so the UI can say WHY a bin is absent instead of it
        # simply not being there.
        why = None
        if key in ENV_THIN_CLASSES:
            why = "class %s is below the sample gate before any split" % key
        elif surf not in ENV_PUBLISHABLE_SURFACES:
            why = ("surface '%s' is not a resolved single surface" % surf if surf != "unknown"
                   else "no road_class on the matched route")
        elif n < ENV_MIN_SAMPLES:
            why = "%d samples, needs %d" % (n, ENV_MIN_SAMPLES)
        elif n_laps < ENV_MIN_LAPS:
            why = "%d distinct laps, needs %d" % (n_laps, ENV_MIN_LAPS)

        a_p50 = _median(ag)
        # gate 5: a saturated bin's p90 is unknowable, so it publishes none.
        a_p90 = _pct(ag, 0.90) if pct_sat <= ENV_MAX_SATURATED else None
        # THE SPEED BOUND IS MEASURED, NOT DERIVED (2026-09-19). It was
        # sqrt(a_p90 * r_mid), which is NOT the p90 of speed: within a band a sample can be
        # fast at low g or slow at high g, so the two distributions do not map and the derived
        # bound under-covered -- 76.2 % of held-out samples against a nominal 90 %. Taking the
        # percentile over observed speed directly gives 88.5 %. It also works where the derived
        # form could not: mph has no ceiling (max seen 273.3) while lat_g censors at 3.00 g, so
        # the saturated A and S1 bins get a bound too -- 2,022 held-out samples scored against
        # 252. Quoted AT r_mid_m; project to a specific radius with v * sqrt(r / r_mid).
        v_env = _pct(sorted(d["vmid"]), 0.90) if len(d["vmid"]) >= ENV_MIN_SAMPLES else None
        # Saturation nulls the P90 -- and therefore the envelope speed -- but it does NOT
        # unpublish the row. The median sits far below the 3.00 g censoring point and stays
        # sound; only the upper tail is clipped. Discarding a valid a_p50 with it would have
        # silently dropped classes A and S1, the two biggest in the corpus, whose bins run
        # 3.0-12.1 % saturated. A consumer reads `v_envelope_mph IS NULL` with `pct_saturated`
        # to say why there is no speed here.

        # The flag, measured from this row's own samples (handoff §5). Signed:
        # positive means the radius estimator reads optimistically here.
        bias = _median(sorted(d["imp"])) - a_p50
        note = None
        if bias is not None and abs(bias) >= 0.05:
            note = ("%+.2f g optimistic - body slip makes r = v/omega read tight" % bias if bias > 0
                    else "%+.2f g conservative - yaw rate under-reads curvature here" % bias)

        out.append((scope, key, surf, band, r_mid, n, n_laps, n_builds,
                    round(a_p50, 4) if a_p50 is not None else None,
                    round(a_p90, 4) if a_p90 is not None else None,
                    round(v_env, 2) if v_env is not None else None,
                    round(pct_sat, 5), round(pct_g3, 5),
                    round(bias, 4) if bias is not None else None, note,
                    0 if why else 1, why, now))

    with cx:
        cx.execute("DELETE FROM grip_envelope")
        fh6db.upsert_many(cx, "grip_envelope", [
            "scope", "scope_key", "surface", "radius_band", "r_mid_m", "n_samples", "n_laps",
            "n_builds", "a_p50", "a_p90", "v_envelope_mph", "pct_saturated", "pct_grip3",
            "bias_g", "bias_note", "publishable", "why_not", "computed_utc"], out, chunk=500)
    if verbose:
        pub = sum(1 for r in out if r[15])
        print("  grip_envelope: %d bins, %d publishable" % (len(out), pub))
    return {"grip_envelope": len(out)}


def run(cx, verbose=False):
    # only courses whose game route we identified BY SHAPE can carry road-derived turns: an
    # 'anchored' course (start sphere only, route_id NULL) never reaches here, and the kind is
    # named so a future kind cannot slip in on route_id alone (review, 2026-09-05)
    courses = cx.execute("""
        SELECT c.route_key, c.name, cr.route_id, cr.match_kind
        FROM course c JOIN course_route cr ON cr.route_key = c.route_key
        WHERE cr.route_id IS NOT NULL AND cr.match_kind IN ('verified', 'probable', 'partial')""").fetchall()
    rows, seg_rows, skipped = [], [], 0
    # schema 7: carry peak |lat_g| per phase when the columns exist. Gate on PRAGMA (not just SCHEMA_VERSION)
    # so a `--only corners` run against a not-yet-migrated DB degrades to no-column rather than crashing.
    _has_lat = "lat_g" in {r[1] for r in cx.execute("PRAGMA table_info(lap_point)")}
    _seg_has_lat = "peak_lat_g" in {r[1] for r in cx.execute("PRAGMA table_info(corner_segment)")}
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
            pts = cx.execute("SELECT i, arc_m, mph, grip, x, z" + (", lat_g" if _has_lat else "")
                             + " FROM lap_point WHERE lap_id=? ORDER BY i", (lp["lap_id"],)).fetchall()
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
                        # peak |lat_g| in this phase for this lap (schema 7). MAX is fine at this granularity
                        # (n is small); the robust cross-lap reduction to a_max is a p90, done later in build_web.
                        speak = None
                        if _has_lat:
                            slat = [s["lat_g"] for s in ss if s["lat_g"] is not None]
                            if slat:
                                speak = round(max(slat), 3)
                        seg_rows.append((lp["lap_id"], stid, co["route_key"], sname, len(ss),
                                         smphs[0], smphs[-1], min(smphs), round(savg, 1),
                                         gstate, ghist, round(ssecs, 3) if ssecs else None, speak))
    with cx:
        cx.execute("DELETE FROM corner_obs")
        n = fh6db.upsert_many(cx, "corner_obs", [
            "lap_id", "turn_id", "route_key", "entry_mph", "apex_mph", "exit_mph", "min_mph",
            "grip_state", "time_s", "score"], rows, chunk=5000)
        m = 0
        if fh6db.has_table(cx, "corner_segment"):
            cx.execute("DELETE FROM corner_segment")
            _cs_cols = ["lap_id", "turn_id", "route_key", "segment", "n_samples", "entry_mph", "exit_mph",
                        "min_mph", "mean_mph", "grip_state", "grip_hist", "time_s"] + (["peak_lat_g"] if _seg_has_lat else [])
            _cs_rows = seg_rows if _seg_has_lat else [r[:12] for r in seg_rows]
            m = fh6db.upsert_many(cx, "corner_segment", _cs_cols, _cs_rows, chunk=5000)
    counts = {"corner_obs": n, "corner_segment": m, "_laps_skipped": skipped}
    counts.update(build_envelope(cx, verbose))
    return counts


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
