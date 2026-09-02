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
K_MIN = 1.0 / 260.0   # anything straighter than a 260 m radius is not a turn
MIN_DEG = 11.0        # and a turn must actually sweep this far
GAP_M = 18.0          # two runs of the same sign closer than this are one turn


def _finite(pts):
    """Points whose position AND geometry fields are all real. A record with a broken normal
    still has a usable position, but its width and banking would be nonsense."""
    return [p for p in pts if len(p) >= 9 and all(math.isfinite(v) for v in p[:9])]


def resample(pts, step=STEP_M):
    """Uniform-arc resample of (x, y, z, half_width, bank_deg) along the centre-line."""
    src = []
    for p in pts:
        half = math.sqrt(p[3] ** 2 + p[4] ** 2 + p[5] ** 2)
        nm = math.sqrt(p[6] ** 2 + p[7] ** 2 + p[8] ** 2)
        bank = math.degrees(math.acos(max(-1.0, min(1.0, p[7] / nm)))) if abs(nm - 1.0) < 1e-3 else None
        src.append((p[0], p[1], p[2], half, bank))
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
                        (a[4] + (b[4] - a[4]) * t) if (a[4] is not None and b[4] is not None) else None))
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


def turns_for(route, step=STEP_M):
    pts = _finite(route["points"])
    if len(pts) < 30:
        return []
    rs, arcs = resample(pts, step)
    if len(rs) < 30:
        return []
    loop = bool(route.get("is_loop"))
    k = curvature(rs, step, loop=loop)
    n = len(rs)

    # runs of sustained curvature of one sign
    runs, cur = [], None
    for i in range(n):
        s = 0 if abs(k[i]) < K_MIN else (1 if k[i] > 0 else -1)
        if s and cur and cur["s"] == s:
            cur["b"] = i
        elif s:
            if cur:
                runs.append(cur)
            cur = {"s": s, "a": i, "b": i}
        elif cur and (i - cur["b"]) * step > GAP_M:
            runs.append(cur); cur = None
    if cur:
        runs.append(cur)
    # a loop's last run can be the same corner as its first
    if loop and len(runs) > 1 and runs[0]["s"] == runs[-1]["s"] and \
            (runs[0]["a"] + (n - runs[-1]["b"])) * step < GAP_M:
        runs[0]["a"] = runs[-1]["a"] - n
        runs.pop()

    out = []
    for r in runs:
        idx = [i % n for i in range(r["a"], r["b"] + 1)]
        if len(idx) < 2:
            continue
        sweep = sum(abs(k[i]) for i in idx) * step
        deg = math.degrees(sweep)
        if deg < MIN_DEG:
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
        p = rs[ai]
        out.append({
            "seq": 0,
            "arc_m": round(arcs[idx[0] % len(arcs)] if idx[0] < len(arcs) else 0.0, 1),
            "apex_arc_m": round(arcs[ai] if ai < len(arcs) else 0.0, 1),
            "apex_x": round(p[0], 1), "apex_y": round(p[1], 1), "apex_z": round(p[2], 1),
            "radius_m": round(radius, 1),
            "peak_radius_m": round(1.0 / kap, 1),
            "angle_deg": round(deg, 1),
            "dir": "L" if k[ai] > 0 else "R",
            "kind": kind_of(radius),
            "length_m": round(arc_len, 1),
            "width_m": round(p[3] * 2.0, 1) if p[3] else None,
            "bank_deg": round(p[4], 2) if p[4] is not None else None,
        })
    out.sort(key=lambda t: t["apex_arc_m"])
    for i, t in enumerate(out, 1):
        t["seq"] = i
        t["turn_id"] = "T%d" % i
    return out


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
