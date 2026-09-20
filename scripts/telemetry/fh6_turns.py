#!/usr/bin/env python3
"""fh6_turns.py -- turns computed from the game's own centre-line, not from how anyone drove.

Until now a turn existed only once the analyzer had seen enough laps through it, so the turn
list moved as you drove: the Highway Circuit held 24 established turns out of 90 candidates, and
a corner you took badly, or never took, was not a corner. That makes the turn list a property of
the driving rather than of the road.

The route files give the road itself, so a turn can be derived instead of observed:

    curvature k(s) = d(heading)/d(arc), from the centre-line resampled to a uniform step
    a turn        = a run where |k| stays above K_MIN and the heading sweeps at least MIN_DEG
    apex          = the point of greatest |k| in that run
    radius        = 1/|k| at the apex

and because each centre-line point also carries a lateral half-width vector and a unit surface
normal, every turn arrives with two things telemetry could never measure: how wide the road is
there, and how much it is banked.

The same route yields the same turns every time, in the same order, whoever is driving.

    python scripts/telemetry/fh6_turns.py --route 281          # one route, printed
    python scripts/telemetry/fh6_turns.py --all --json OUT.json
"""
import argparse
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import fh6_owt                                           # noqa: E402

STEP_M = 2.0          # resample step; the files are already ~2 m
HEAD_WIN_M = 8.0      # heading is measured across this much road, to ride over surveying noise
SMOOTH_M = 10.0       # curvature smoothing window
# PINNED TURN-IDENTITY CONSTANTS (2026-09-07). turns_for() is the SINGLE source of a route's turn set
# and its arc-anchored ids, so these three fix the identity: do NOT tune them and do NOT derive them
# dynamically (e.g. per road-class). K_MIN is load-bearing -- a +/-50% change swings a highway route's
# turn count up to 3.6x, silently re-versioning every turn id on that route (GAP_M is safe, MIN_DEG
# intermediate). Changing any of them is a deliberate catalogue-wide re-derivation, not a tweak.
# See docs/turn-consistency-research-2026-09-07.md.
K_MIN = 1.0 / 260.0   # anything straighter than a 260 m radius is not a turn
MIN_DEG = 11.0        # and a turn must actually sweep this far
GAP_M = 18.0          # two runs of the same sign closer than this are one turn
# STRAIGHTEN-AWARE SPLIT (2026-09-10): GAP_M bridges a sub-K_MIN dip so a genuine COMPOUND corner (the
# road keeps curving) stays whole, but where the road actually STRAIGHTENS between two same-sign bends
# they are two turns, not one. Cut a run at an interior stretch that falls below SPLIT_FLOOR x K_MIN
# (near-straight) for at least SPLIT_GAP_M; MIN_DEG then drops any sliver. Fixes ~28% merged compounds
# (Hakone T13 = two 90-deg lefts over a 12 m straight, and the 200-730-deg cross-country monsters).
SPLIT_FLOOR = 0.5     # "straight" = |curvature| below half the turn threshold
SPLIT_GAP_M = 8.0     # ... held that straight for at least this far


def _finite(pts):
    """Points whose position AND geometry fields are all real. A record with a broken normal
    still has a usable position, but its width and banking would be nonsense."""
    return [p for p in pts if len(p) >= 9 and all(math.isfinite(v) for v in p[:9])]


# BANKING (2026-09-20). bank_deg used to be acos(n_y): the angle between the surface normal and
# straight up. That is the road's TOTAL tilt -- grade and camber together, unsigned -- so a 10%
# climb read as 6 deg of "banking", and where the normal points below horizontal it ran past 90
# (max 139.69 deg, all on Route30106). Banking is the tilt ACROSS the road, toward or away from the
# turn centre: sin(bank) = n . c, with c the horizontal unit vector pointing at the centre of the
# curve. It is signed: + = banked into the turn (outside edge high), - = off-camber.
#
# FRAME CHECK. On 168 of 169 routes floats 6-8 are a true surface normal: unit length on every
# point (551,399/551,399), perpendicular to the recorded lateral vector (|n.l| p50 0.0008) and to
# travel, and its tilt matches the one the lateral + travel vectors imply to a median 0.2 deg.
# Route30106 (unnamed, is_race 0, no course matches it) is the exception: 524 points face DOWN
# (n_y < 0) and 18% fail the perpendicularity check while the road itself stays at y ~ 114 m. So a
# normal is used only where the surface faces up AND it is perpendicular to the lateral vector the
# same record carries; otherwise the bank is unknown (NULL), not clamped -- a clamp would publish a
# made-up number for a frame that is not a surface at all.
#
# Even its self-consistent frames give 39-89 deg "banks" on a road that never leaves y 101-118 m, so a
# route with ANY down-facing normal has its banking withheld whole (turns_for). Measured with that in
# place: every other turn is within +/-31.1 deg (Temple Cross Country, "steep banked turns"; the real
# world tops out near 31-33 deg), and the sign agrees with the one the lateral vector's own tilt
# gives on 2,717/2,727 turns (median |diff| 0.10 deg). BANK_MAX_DEG is a guard above that, not a clamp.
FRAME_MAX_LAT_DOT = 0.2   # |n . lateral| above this: the two vectors disagree (~11.5 deg off square)
BANK_MAX_DEG = 45.0       # a steeper reading is NULL: no surveyed road here is past 31.1 deg


def _frame_ok(p):
    nm = math.sqrt(p[6] ** 2 + p[7] ** 2 + p[8] ** 2)
    lm = math.sqrt(p[3] ** 2 + p[4] ** 2 + p[5] ** 2)
    if abs(nm - 1.0) >= 1e-3 or lm <= 0 or p[7] <= 0:
        return False
    return abs(p[3] * p[6] + p[4] * p[7] + p[5] * p[8]) / (nm * lm) <= FRAME_MAX_LAT_DOT


def bank_at(rs, i, turn_sign, step=STEP_M, loop=False):
    """Signed banking at resampled point i, degrees. turn_sign is the sign of the curvature there
    (+ = heading increasing). None where the point has no trusted normal."""
    nv = rs[i][4]
    if nv is None:
        return None
    n = len(rs)
    w = max(1, int(round(HEAD_WIN_M / step / 2)))
    a, b = (i - w) % n, (i + w) % n
    if not loop:
        a, b = max(0, i - w), min(n - 1, i + w)
    dx, dz = rs[b][0] - rs[a][0], rs[b][2] - rs[a][2]
    h = math.hypot(dx, dz)
    nm = math.sqrt(sum(v * v for v in nv))
    if h <= 0 or nm <= 0:
        return None
    # the tangent (dx, dz)/h rotated 90 deg toward the side the heading turns to = toward the centre
    cx, cz = (-dz / h, dx / h) if turn_sign > 0 else (dz / h, -dx / h)
    return math.degrees(math.asin(max(-1.0, min(1.0, (nv[0] * cx + nv[2] * cz) / nm))))


def resample(pts, step=STEP_M):
    """Uniform-arc resample of (x, y, z, half_width, normal) along the centre-line.

    `normal` is the record's unit surface normal (floats 6-8), or None where the frame fails
    _frame_ok(). Banking is NOT an angle to interpolate: it is read off the normal at the apex by
    bank_at(), which needs the turn's direction to give it a sign."""
    src = []
    for p in pts:
        half = math.sqrt(p[3] ** 2 + p[4] ** 2 + p[5] ** 2)
        src.append((p[0], p[1], p[2], half, tuple(p[6:9]) if _frame_ok(p) else None))
    out, acc = [src[0]], 0.0
    arcs = [0.0]
    for i in range(1, len(src)):
        d = math.dist(src[i - 1][::2][:2], src[i][::2][:2]) if False else math.hypot(
            src[i][0] - src[i - 1][0], src[i][2] - src[i - 1][2])
        if d <= 0:
            continue
        acc += d
        while arcs[-1] + step <= acc:
            t = (arcs[-1] + step - (acc - d)) / d
            a, b = src[i - 1], src[i]
            out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t,
                        a[2] + (b[2] - a[2]) * t,
                        a[3] + (b[3] - a[3]) * t,
                        tuple(u + (v - u) * t for u, v in zip(a[4], b[4]))
                        if (a[4] is not None and b[4] is not None) else None))
            arcs.append(arcs[-1] + step)
    return out, arcs


def curvature(pts, step=STEP_M, win_m=HEAD_WIN_M, smooth_m=SMOOTH_M, loop=False):
    """Signed curvature per point: + is one hand, - the other. rad per metre."""
    n = len(pts)
    w = max(1, int(round(win_m / step / 2)))
    head = [None] * n
    for i in range(n):
        a, b = i - w, i + w
        if loop:
            a %= n; b %= n
        else:
            a = max(0, a); b = min(n - 1, b)
        dx, dz = pts[b][0] - pts[a][0], pts[b][2] - pts[a][2]
        if dx or dz:
            head[i] = math.atan2(dz, dx)
    k = [0.0] * n
    for i in range(n):
        j = (i + 1) % n if loop else min(i + 1, n - 1)
        if head[i] is None or head[j] is None:
            continue
        d = head[j] - head[i]
        while d > math.pi:
            d -= 2 * math.pi
        while d < -math.pi:
            d += 2 * math.pi
        k[i] = d / step
    m = max(1, int(round(smooth_m / step / 2)))
    sm = [0.0] * n
    for i in range(n):
        acc = c = 0
        for o in range(-m, m + 1):
            j = (i + o) % n if loop else i + o
            if 0 <= j < n:
                acc += k[j]; c += 1
        sm[i] = acc / max(1, c)
    return sm


KINDS = [(28, "hairpin"), (55, "tight"), (110, "medium"), (200, "fast")]


def kind_of(radius_m):
    for lim, name in KINDS:
        if radius_m < lim:
            return name
    return "sweeper"


def turns_for(route, step=STEP_M, k_min=K_MIN, min_deg=MIN_DEG, gap_m=GAP_M):
    # k_min/min_deg/gap_m default to the PINNED identity constants, so every caller is unchanged.
    # They are parameters ONLY so turn_lab's Path-B gate can perturb them and measure how fragile a
    # route's turn identity is -- never to derive a different production turn set.
    pts = _finite(route["points"])
    if len(pts) < 30:
        return []
    rs, arcs = resample(pts, step)
    if len(rs) < 30:
        return []
    # one down-facing normal anywhere = this file's frames are not a road surface (see BANKING)
    frames_ok = all(p[7] > 0 for p in pts)
    loop = bool(route.get("is_loop"))
    k = curvature(rs, step, loop=loop)
    n = len(rs)

    # runs of sustained curvature of one sign
    runs, cur = [], None
    for i in range(n):
        s = 0 if abs(k[i]) < k_min else (1 if k[i] > 0 else -1)
        if s and cur and cur["s"] == s:
            cur["b"] = i
        elif s:
            if cur:
                runs.append(cur)
            cur = {"s": s, "a": i, "b": i}
        elif cur and (i - cur["b"]) * step > gap_m:
            runs.append(cur); cur = None
    if cur:
        runs.append(cur)
    # a loop's last run can be the same corner as its first
    if loop and len(runs) > 1 and runs[0]["s"] == runs[-1]["s"] and \
            (runs[0]["a"] + (n - runs[-1]["b"])) * step < gap_m:
        runs[0]["a"] = runs[-1]["a"] - n
        runs.pop()

    # split each run wherever the road straightens (see SPLIT_FLOOR/SPLIT_GAP_M) -- a real straight
    # between two same-sign bends means two turns, not one merged compound
    floor = SPLIT_FLOOR * k_min
    split = []
    for rr in runs:
        seg_start, in_s, s_len, s_from = rr["a"], False, 0.0, None
        for j in range(rr["a"], rr["b"] + 1):
            if abs(k[j % n]) < floor:
                if not in_s:
                    in_s, s_from, s_len = True, j, 0.0
                s_len += step
            else:
                if in_s and s_len >= SPLIT_GAP_M and s_from > seg_start:
                    split.append({"s": rr["s"], "a": seg_start, "b": s_from - 1})
                    seg_start = j
                in_s = False
        split.append({"s": rr["s"], "a": seg_start, "b": rr["b"]})
    runs = split

    out = []
    for r in runs:
        idx = [i % n for i in range(r["a"], r["b"] + 1)]
        if len(idx) < 2:
            continue
        sweep = sum(abs(k[i]) for i in idx) * step
        deg = math.degrees(sweep)
        if deg < min_deg:
            continue
        ai = max(idx, key=lambda i: abs(k[i]))
        kap = abs(k[ai])
        if kap <= 0:
            continue
        # RADIUS COMES FROM THE WHOLE SWEEP, NOT THE PEAK. Peak curvature over a 2 m step is a
        # spike detector: a survey wobble or a junction gave a 4 m "hairpin" on a highway. The
        # radius a driver actually experiences is the arc the corner turns through:
        #     R = arc length / sweep angle
        # which is stable against a single noisy sample. Peak curvature still locates the apex.
        arc_len = len(idx) * step
        radius = arc_len / sweep if sweep > 1e-6 else 1.0 / kap
        # GEOMETRIC APEX (2026-09-10): the marker/id sit at the VERTEX of the bend -- the run point
        # farthest from the chord joining entry and exit -- not the max-curvature point (ai), which
        # drifts off the visible apex on asymmetric and long corners. ai still gives dir + peak radius.
        _p0, _p1 = rs[idx[0]], rs[idx[-1]]
        _dx, _dz = _p1[0] - _p0[0], _p1[2] - _p0[2]
        _cl = math.hypot(_dx, _dz) or 1.0
        gi = max(idx, key=lambda i: abs((rs[i][0] - _p0[0]) * _dz - (rs[i][2] - _p0[2]) * _dx) / _cl)
        p = rs[gi]
        # 5-SEGMENT PHASES (WHERE, 2026-09-10): turn-in / mid / exit split by 80% of PEAK curvature --
        # the geometry analogue of the daemon's 80%-of-peak-lat-g phases (memory fh6-turn-design-language).
        # Mid = the >=80% window around the apex; braking (before) + straight/crest (after) fill in the
        # post-pass once neighbours are known.
        _thr = 0.8 * kap
        _mid = [q for q, i in enumerate(idx) if abs(k[i]) >= _thr] or [idx.index(ai)]
        _aarc = lambda i: round(arcs[i] if i < len(arcs) else arcs[-1], 1)
        out.append({
            "seq": 0,
            "arc_m": round(arcs[idx[0] % len(arcs)] if idx[0] < len(arcs) else 0.0, 1),
            "apex_arc_m": round(arcs[gi] if gi < len(arcs) else 0.0, 1),
            "apex_x": round(p[0], 1), "apex_y": round(p[1], 1), "apex_z": round(p[2], 1),
            "radius_m": round(radius, 1),
            "peak_radius_m": round(1.0 / kap, 1),
            "angle_deg": round(deg, 1),
            "dir": "L" if k[ai] > 0 else "R",
            "kind": kind_of(radius),
            "length_m": round(arc_len, 1),
            "width_m": round(p[3] * 2.0, 1) if p[3] else None,
            "bank_deg": (lambda _b: round(_b, 2) if _b is not None and abs(_b) <= BANK_MAX_DEG else None)(
                bank_at(rs, gi, 1 if k[ai] > 0 else -1, step, loop) if frames_ok else None),
            "_ti": _aarc(idx[0]), "_m0": _aarc(idx[_mid[0]]), "_m1": _aarc(idx[_mid[-1]]), "_ex": _aarc(idx[-1]),
        })
    out.sort(key=lambda t: t["apex_arc_m"])
    taken = set()
    for i, t in enumerate(out, 1):
        t["seq"] = i                                        # route order, for DISPLAY (T1..Tn); recomputed each pass
        t["turn_id"] = stable_turn_id(t["apex_arc_m"], t.get("dir"), taken)   # arc-anchored KEY: pass-invariant
    # BRAKING (before turn-in) + STRAIGHT/CREST (after exit): the connectors, each capped so it never
    # reaches into the neighbouring corner. Every turn then carries all five WHERE-segments as arc spans.
    total = arcs[-1] or 1.0
    BRAKE_M = RUNOUT_M = 45.0
    m = len(out)
    for i, t in enumerate(out):
        prev = out[i - 1] if i > 0 else (out[-1] if (loop and m > 1) else None)
        nxt = out[i + 1] if i + 1 < m else (out[0] if (loop and m > 1) else None)
        b0 = (t["_ti"] - min(BRAKE_M, (t["_ti"] - prev["_ex"]) % total)) % total if prev \
            else max(0.0, t["_ti"] - BRAKE_M)
        s1 = (t["_ex"] + min(RUNOUT_M, (nxt["_ti"] - t["_ex"]) % total)) % total if nxt \
            else min(total, t["_ex"] + RUNOUT_M)
        t["segments"] = {"braking": [round(b0, 1), t["_ti"]], "turn_in": [t["_ti"], t["_m0"]],
                         "mid": [t["_m0"], t["_m1"]], "exit": [t["_m1"], t["_ex"]],
                         "straight": [t["_ex"], round(s1, 1)]}
    for t in out:                                           # drop the temp boundaries after all neighbours are read
        for kk in ("_ti", "_m0", "_m1", "_ex"):
            t.pop(kk, None)
    return out


def stable_turn_id(apex_arc_m, direction, taken):
    """Arc-anchored, pass-invariant turn id: T<round(apex_arc_m)>. Unlike a positional T1..Tn rank, it does
    NOT change when a turn is inserted or removed elsewhere on the route -- the whole point of the identity.
    A same-metre collision (never seen across the 169-route game catalogue) takes a direction letter, then a
    numeric suffix, so the id stays unique and deterministic. Shared by the geometry detector and the learned
    -course model (analyze_session) so both are stable WITHIN their own arc domain. See
    docs/turn-consistency-research-2026-09-07.md."""
    base = "T%d" % round(apex_arc_m)
    tid = base
    if tid in taken:
        tid = base + (direction or "")
        k = 2
        while tid in taken:
            tid = "%s_%d" % (base, k)
            k += 1
    taken.add(tid)
    return tid


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--dir", default=fh6_owt.AITRACKS)
    ap.add_argument("--route", default=None, help="one route id, e.g. 281")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--json", default=None)
    a = ap.parse_args(argv)

    routes = fh6_owt.load_all(a.dir, full=True)
    if a.route:
        routes = [r for r in routes if r["route_id"] == str(a.route)]
    res = {}
    for r in routes:
        res[r["route_id"]] = turns_for(r)
    if a.route or not a.all:
        for rid, ts in res.items():
            r = next(x for x in routes if x["route_id"] == rid)
            print("Route%s  %.0f m  %s  %d turns" %
                  (rid, r["length_m"], "loop" if r["is_loop"] else "point-to-point", len(ts)))
            print("  %-5s %-7s %8s %7s %6s %6s %7s %7s" %
                  ("turn", "kind", "apex m", "radius", "deg", "dir", "width", "bank"))
            for t in ts:
                print("  %-5s %-7s %8.0f %7.0f %6.0f %6s %7s %7s"
                      % (t["turn_id"], t["kind"], t["apex_arc_m"], t["radius_m"], t["angle_deg"],
                         t["dir"], t["width_m"] if t["width_m"] else "—",
                         t["bank_deg"] if t["bank_deg"] is not None else "—"))
    else:
        tot = sum(len(v) for v in res.values())
        print("%d routes, %d turns (%.1f per route)" % (len(res), tot, tot / max(1, len(res))))
    if a.json:
        with open(a.json, "w", encoding="utf-8") as fh:
            json.dump(res, fh, indent=1)
        print("wrote %s" % a.json)
    return 0


if __name__ == "__main__":
    sys.exit(main())
