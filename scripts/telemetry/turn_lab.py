#!/usr/bin/env python3
"""TURN-DETECTION LAB — evaluate turn-identification algorithms against evidence, not against a guess.

The problem with tuning a turn detector is that there are no labels. But there is a strong, label-free
criterion: A TURN IS A PROPERTY OF THE ROAD, so a correct detector must find THE SAME TURNS ON EVERY LAP of
the same road. Disagreement between laps is detector noise by definition — the road did not change.

So each candidate is scored by:
  * STABILITY  — the spread of per-lap turn counts (a correct detector returns the same count every lap)
  * AGREEMENT  — the share of detected turns that recur at the same place (±35 m) on a majority of laps
  * ORPHANS    — turns found on only one lap (pure noise)
  * DECLARED   — where the player declared a count, |detected - declared| (a check, never an input)

    python scripts/telemetry/turn_lab.py                # score every candidate on every multi-lap course
    python scripts/telemetry/turn_lab.py --course KEY   # one course, verbose per-lap detail
"""
import glob, io, json, math, os, statistics, sys

try: sys.stdout.reconfigure(encoding="utf-8", errors="replace")   # in place: see merge_courses.py
except Exception: pass
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))


# ───────────────────────── shared path maths ─────────────────────────
def resample(pts, step=4.0):
    if len(pts) < 3:
        return []
    S = [0.0]
    for a, b in zip(pts, pts[1:]):
        S.append(S[-1] + math.hypot(b[0] - a[0], b[1] - a[1]))
    if S[-1] < step * 5:
        return []
    out = []
    j = 0
    s = 0.0
    while s <= S[-1]:
        while j < len(S) - 2 and S[j + 1] < s:
            j += 1
        seg = S[j + 1] - S[j]
        f = (s - S[j]) / seg if seg > 0 else 0.0
        out.append((pts[j][0] + (pts[j + 1][0] - pts[j][0]) * f, pts[j][1] + (pts[j + 1][1] - pts[j][1]) * f, s))
        s += step
    return out


def smooth(v, n):
    if n <= 1 or len(v) < n:
        return list(v)
    out = []
    half = n // 2
    for i in range(len(v)):
        a, b = max(0, i - half), min(len(v), i + half + 1)
        out.append(sum(v[a:b]) / (b - a))
    return out


def heading_curvature(P, step, win):
    """Unwrapped heading, smoothed, then curvature (rad/m) at each interior sample."""
    th = [math.atan2(b[1] - a[1], b[0] - a[0]) for a, b in zip(P, P[1:])]
    for i in range(1, len(th)):
        while th[i] - th[i - 1] > math.pi:
            th[i] -= 2 * math.pi
        while th[i] - th[i - 1] < -math.pi:
            th[i] += 2 * math.pi
    ths = smooth(th, win)
    return [(ths[i + 1] - ths[i - 1]) / (2 * step) for i in range(1, len(ths) - 1)]


# ───────────────────────── candidate detectors ─────────────────────────
# Each returns a list of {s, pos, deg, radius_m} — one entry per detected turn.

def det_baseline(P, step=4.0):
    """What ships today: seed where radius < 250 m, extend at 0.6x, merge same-sign gaps <= 3 samples, keep >= 12 deg."""
    K = heading_curvature(P, step, 7)
    thr = 1.0 / 250.0
    g = []
    i = 0
    while i < len(K):
        if abs(K[i]) > thr:
            j = i
            while j < len(K) and abs(K[j]) > thr * 0.6:
                j += 1
            if j - i >= 4:
                ia = max(range(i, j), key=lambda q: abs(K[q]))
                g.append({"i0": i, "i1": j, "ia": ia, "sgn": 1 if K[ia] > 0 else -1})
            i = j
        else:
            i += 1
    merged = []
    for t in g:
        if merged and t["i0"] - merged[-1]["i1"] <= 3 and t["sgn"] == merged[-1]["sgn"]:
            merged[-1]["i1"] = t["i1"]
            if abs(K[t["ia"]]) > abs(K[merged[-1]["ia"]]):
                merged[-1]["ia"] = t["ia"]
        else:
            merged.append(dict(t))
    out = []
    for t in merged:
        deg = abs(sum(K[t["i0"]:t["i1"]]) * step) * 180 / math.pi
        if deg < 12:
            continue
        ia = t["ia"] + 1
        out.append({"s": P[ia][2], "pos": [P[ia][0], P[ia][1]], "deg": round(deg),
                    "radius_m": round(1 / max(1e-6, abs(K[t["ia"]])))})
    return out


def det_heading(P, step=4.0, win=9, floor_r=600.0, min_deg=22.0, tight_r=110.0, tight_deg=10.0, bridge_m=25.0,
                merge_m=30.0, apex="argmax", wrap=False):
    """CANDIDATE: a turn is a SUSTAINED CHANGE OF DIRECTION, not a radius threshold.

    Segment by curvature SIGN while |k| is above a very permissive floor (r < 600 m, so long sweepers survive),
    bridging short sub-floor gaps inside one turn. Accept a segment on the DIRECTION CHANGE it actually
    produces (>= min_deg), or on being genuinely tight even if short. Radius never gates existence — that was
    what made a 200 m sweeper invisible while a twitch in a hairpin counted.
    """
    K = heading_curvature(P, step, win)
    floor = 1.0 / floor_r
    bridge = max(1, int(bridge_m / step))
    segs = []
    cur = None
    gap = 0
    for i, k in enumerate(K):
        s = 1 if k > 0 else -1
        if abs(k) >= floor:
            if cur and cur["sgn"] == s and gap <= bridge:
                cur["i1"] = i + 1
                gap = 0
            else:
                if cur:
                    segs.append(cur)
                cur = {"i0": i, "i1": i + 1, "sgn": s}
                gap = 0
        elif cur:
            gap += 1
            if gap > bridge:
                segs.append(cur)
                cur = None
    if cur:
        segs.append(cur)
    out = []
    for t in segs:
        sl = K[t["i0"]:t["i1"]]
        if not sl:
            continue
        deg = abs(sum(sl) * step) * 180 / math.pi
        ia = t["i0"] + max(range(len(sl)), key=lambda q: abs(sl[q]))
        rmin = 1 / max(1e-6, abs(K[ia]))
        if not (deg >= min_deg or (rmin <= tight_r and deg >= tight_deg)):
            continue
        out.append({"i0": t["i0"], "i1": t["i1"], "ia": ia, "sgn": t["sgn"], "k": abs(K[ia]),
                    "deg": round(deg), "radius_m": round(rmin)})
    adj = max(1, int(merge_m / step)); mg = []
    for t in out:   # one continuous change of direction is one turn (compound corners)
        if mg and t["sgn"] == mg[-1]["sgn"] and (t["i0"] - mg[-1]["i1"]) <= adj:
            m = mg[-1]; m["i1"] = max(m["i1"], t["i1"]); m["deg"] += t["deg"]
            if t["k"] > m["k"]: m["k"] = t["k"]; m["ia"] = t["ia"]; m["radius_m"] = t["radius_m"]
        else: mg.append(dict(t))
    # A lap starts wherever the player crossed the line, which can be MID-CORNER: the same turn then appears
    # as a stub at s=0 and another at the end. On a closed circuit those are one turn, not two.
    if wrap and len(mg) > 1 and mg[0]["sgn"] == mg[-1]["sgn"] and \
            (len(K) - mg[-1]["i1"] + mg[0]["i0"]) <= adj:
        a, b = mg[-1], mg[0]
        b["deg"] += a["deg"]
        if a["k"] > b["k"]: b["k"] = a["k"]; b["ia"] = a["ia"]; b["radius_m"] = a["radius_m"]
        mg.pop()
    res = []
    for t in mg:
        if apex == "centroid":
            # WHERE a turn is = where its direction change is CONCENTRATED, not the single tightest sample.
            # argmax of a smoothed derivative wanders with the racing line, so the same road reported apexes
            # tens of metres apart lap to lap. The curvature-weighted centroid is a property of the road.
            sl = [abs(x) for x in K[t["i0"]:t["i1"]]]
            tot = sum(sl)
            j = int(round(t["i0"] + sum(q * w for q, w in enumerate(sl)) / tot)) if tot else t["ia"]
        else:
            j = t["ia"]
        j = min(max(j + 1, 0), len(P) - 1)
        res.append({"s": P[j][2], "pos": [P[j][0], P[j][1]], "deg": t["deg"], "radius_m": t["radius_m"]})
    return res


def tight(**kw):
    """The 30-degree family — the acceptance rule that won the first round. Everything below varies only
    WHERE the turn is reported and WHEN two spans are one corner, so the sweep isolates those two effects."""
    base = dict(win=9, floor_r=600.0, min_deg=30.0, tight_r=90.0, tight_deg=14.0, bridge_m=25.0)
    base.update(kw)
    return lambda P, step=4.0: det_heading(P, step, **base)


CANDIDATES = {
    "baseline(ships today)": det_baseline,
    "heading-30 argmax m30": tight(),                                             # round-1 winner
    "heading-30 centroid m30": tight(apex="centroid"),
    "heading-30 centroid m45": tight(apex="centroid", merge_m=45.0),
    "heading-30 centroid m60": tight(apex="centroid", merge_m=60.0),
    "heading-30 centroid m45 wrap": tight(apex="centroid", merge_m=45.0, wrap=True),
    "heading-30 centroid m60 wrap": tight(apex="centroid", merge_m=60.0, wrap=True),
}


# ───────────────────────── evaluation ─────────────────────────
def arc_of(pts):
    return sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(pts, pts[1:]))


def lap_paths(model):
    """FULL laps only. Aborted attempts and post-finish stubs are stored as 'laps' too, and comparing a
    complete lap against a 20% fragment is not a detector disagreement — it is a different piece of road."""
    g = model.get("geometry") or {}
    cand = [lp.get("pts") or [] for lp in (g.get("lap_paths") or [])]
    cand = [p for p in cand if len(p) >= 30]
    if not cand:
        return []
    arcs = [arc_of(p) for p in cand]
    full = max(arcs)
    return [p for p, a in zip(cand, arcs) if a >= 0.8 * full]


def score(det, laps):
    """Stability + agreement across laps of the same road."""
    per = []
    for pts in laps:
        P = resample(pts)
        if len(P) < 20:
            continue
        per.append(det(P))
    if len(per) < 2:
        return None
    counts = [len(x) for x in per]
    # cluster apexes across laps
    allt = [(li, t) for li, x in enumerate(per) for t in x]
    used = set()
    clusters = []
    for i, (li, t) in enumerate(allt):
        if i in used:
            continue
        grp = [(li, t)]
        used.add(i)
        for j, (lj, u) in enumerate(allt):
            if j in used or lj == li:
                continue
            if (u["pos"][0] - t["pos"][0]) ** 2 + (u["pos"][1] - t["pos"][1]) ** 2 <= 35 ** 2:
                grp.append((lj, u))
                used.add(j)
        clusters.append(grp)
    n_laps = len(per)
    recurring = [c for c in clusters if len({li for li, _ in c}) > n_laps / 2]
    orphans = [c for c in clusters if len({li for li, _ in c}) == 1]
    return {"laps": n_laps, "counts": counts, "mean": statistics.mean(counts),
            "sd": statistics.pstdev(counts) if len(counts) > 1 else 0.0,
            "clusters": len(clusters), "recurring": len(recurring), "orphans": len(orphans),
            "agreement": len(recurring) / max(1, len(clusters))}


def main():
    only = None
    if "--course" in sys.argv:
        only = sys.argv[sys.argv.index("--course") + 1]
    models = []
    for p in sorted(glob.glob(os.path.join(ROOT, "data", "courses", "*.json"))):
        try:
            m = json.load(open(p, encoding="utf-8"))
        except Exception:
            continue
        k = m.get("route_key") or os.path.basename(p)[:-5]
        if only and k != only:
            continue
        if len(lap_paths(m)) >= 3:
            models.append((k, m))
    if not models:
        print("no course has >= 3 recorded lap paths to compare")
        return
    print(f"{len(models)} courses with >= 3 laps · scoring {len(CANDIDATES)} detectors "
          f"on cross-lap agreement (a turn is a property of the road)\n")
    totals = {name: {"agree": [], "sd": [], "orph": [], "mean": []} for name in CANDIDATES}
    for k, m in models:
        laps = lap_paths(m)
        decl = m.get("expected_turns")
        print(f"── {k}  ({len(laps)} laps, {(m.get('geometry') or {}).get('length_m')} m"
              f"{', DECLARED ' + str(decl) if decl else ''})")
        for name, det in CANDIDATES.items():
            r = score(det, laps)
            if not r:
                continue
            totals[name]["agree"].append(r["agreement"])
            totals[name]["sd"].append(r["sd"])
            totals[name]["orph"].append(r["orphans"])
            totals[name]["mean"].append(r["mean"])
            dv = f" · vs declared {decl}: {r['mean'] - decl:+.1f}" if decl else ""
            print(f"    {name:>22}: turns/lap {r['mean']:5.1f} ±{r['sd']:.1f} · agreement {100*r['agreement']:3.0f}%"
                  f" · recurring {r['recurring']:>3} · orphans {r['orphans']:>3}{dv}")
        print()
    print("=" * 78)
    print(f"{'detector':>22} {'agreement':>10} {'count sd':>9} {'orphans':>8}   (higher agreement, lower sd/orphans = better)")
    for name in CANDIDATES:
        t = totals[name]
        if not t["agree"]:
            continue
        print(f"{name:>22} {100*statistics.mean(t['agree']):9.0f}% {statistics.mean(t['sd']):9.2f} "
              f"{statistics.mean(t['orph']):8.1f}")
    print("=" * 78)


if __name__ == "__main__":
    main()
