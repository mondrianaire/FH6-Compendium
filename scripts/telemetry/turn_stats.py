#!/usr/bin/env python3
"""TRACE-DERIVED PER-TURN STATISTICS — what actually happened at each corner of the map, from every stored lap.

    python scripts/telemetry/turn_stats.py -7350_-2100        # one course, printed
    python scripts/telemetry/turn_stats.py --all              # every course
    python scripts/telemetry/turn_stats.py --selftest         # the golden assertions

WHY THIS EXISTS. A corner is only DETECTED when abs(lat_g) > 0.35 is sustained >= 0.8 s, so a fast sweeper taken
without lifting never produces a corner record, and its turn renders "not driven" though the car went through it
on every lap. The corners you take fastest were the ones the lab knew least about. Meanwhile data/laps.db already
holds [arc_m, mph, grip_code, x, z] for every lap: the answer was in the store, keyed by position, the whole time.

It is also the retroactive method the owner asked for -- when a turn is added, moved or removed, re-running this
re-derives its statistics from laps already driven, instead of waiting to drive the course again.

ADDITIVE, NEVER A REPLACEMENT. Output goes in its own `traced` namespace with its own denominator. 288 of 541
mapped turns (53%) sit on routes with zero usable traces, so a traces-only verdict would be a net regression
there; and a traced count divided by model["laps"] would render turns driven on 92-97% of stored laps as amber
"45%", because the model counts 194 laps where the store holds 94. Behavioural evidence stays the accumulated
record; this stands beside it.

=============================== THE WINDOWING RULE ===============================
ARC, NOT EUCLID. On Edamame G10 and G12 are 44 m apart in SPACE and 108 m apart along the ROAD, with G11 between
them -- any Euclidean radius >= 45 m merges them. Conversely G2/G3 and G8/G9 are 20 m apart in arc, so a fixed
+-20 m ball puts each one's apex inside the other's window.

Each turn's half-width is its own length, clipped to the midpoints of its neighbours, so windows are DISJOINT by
construction: no shared samples, no argmin that can be stolen by the corner next door.

SEGMENT PROJECTION, NOT NEAREST VERTEX -- this is not a nicety. Vertex snapping quantises arc to the ~4 m polyline
and stalls inside tight corners; on Edamame's 25 m hairpin it found 24 of 94 laps and read a min speed 12 mph too
low, where segment projection finds 90 of 94.

FORWARD-ONLY, SEQUENTIALLY. Global nearest-point projection jumps to the wrong branch where a course passes near
itself: p99 residual 285 m, max 517 m. Walking the lap in order and searching only forward gives p95 deviation
9.2 m and zero backward steps in 23,404 measured steps.

pts[i][0] IS NOT THE MAP'S ARC. The stored lap arc has a start-line origin: measured against map `s` at the same
physical point it is off by a median +796 m on one course, and the residual after removing a per-lap constant is
still p99 285 m. It must never index the map.

=============================== "FLAT OUT" ===============================
NOT speed drop, and NOT grip codes -- both are refuted on this data. A 6% drop rule badges three real corners flat
and nearly badges a 16 m hairpin, because a clipped window can sit entirely on the previous corner's exit ramp.
grip_code trips on CombinedSlip > 1, which committed cornering crosses by design; code 4 is a hard-cornering
detector wearing an impact's name; code 5 never appears in the store at all.

What works is the conjunction of two window-invariant measures:
  ratio      = min speed in the window / that LAP's own straight-line pace (median of its top-decile speeds)
  a_long_min = the most negative longitudinal g in the window, from (v2^2 - v1^2) / (2*ds)
Either alone badges five or three turns; together they leave exactly one. Sweeping the half-width from 0.5x to
2.0x moves the drop-percentage at all 13 turns but leaves the conjunction's answer unchanged -- it is a threshold
on the road, not on the window.

WHAT THE VERDICT MAY NOT CLAIM. pts carries no throttle or brake channel, so this cannot see a lift; it can only
see that speed was held. The label says "no lift measured", never "flat out", and always publishes the evidence
(passes, builds, samples) beside it.
"""
import argparse, glob, io, json, math, os, sqlite3, statistics, sys

try: sys.stdout.reconfigure(encoding="utf-8", errors="replace")   # in place: see merge_courses.py
except Exception: pass
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))

HALF_MIN = 20.0        # the analyzer's own half-width convention: max(20, len_m/2)
DEV_MAX = 15.0         # racing-line deviation veto; measured p90 <= 10.3 m inside every real turn window
MIN_SAMPLES = 5        # below this a window cannot resolve entry/min/exit
RATIO_FLAT = 0.70      # min speed as a fraction of the lap's own straight-line pace
ALONG_FLOOR = -0.20    # g; the noise edge, not a tuned value
AGREE_FLAT = 0.80
N_FLAT, N_BUILDS_FLAT, N_LIKELY = 8, 2, 3


def _pieces(geo):
    """The map's path AS PIECES, with each piece's arc offset by the running total.

    geo["path"] is the flat concatenation of the pieces and its joins are phantom straights: summed on the flat
    path the arc overstates by 1104 m / 1382 m / 627 m on the three multi-piece courses. Anything that indexes
    the map by arc has to walk the pieces."""
    ps = geo.get("paths") or ([geo["path"]] if geo.get("path") else [])
    out, off = [], 0.0
    for p in ps:
        if len(p) < 2:
            continue
        cum = [0.0]
        for a, b in zip(p, p[1:]):
            cum.append(cum[-1] + math.hypot(b[0] - a[0], b[1] - a[1]))
        out.append({"pts": p, "cum": [c + off for c in cum]})
        off += cum[-1]
    return out, off


def windows(turns, total_len):
    """Half-width per turn: its own length, clipped to the midpoint of each neighbour. Disjoint by construction."""
    n = len(turns)
    # NEIGHBOURS ARE THE NEIGHBOURS IN ARC ORDER, WHICH IS NOT THE ORDER THE LIST ARRIVES IN. This walked the
    # list as given and took turns[i-1] / turns[i+1] as the adjacent corners. Where a model describes the same
    # road more than once -- 2850_-200 holds G1/G2/G3 at s = 316, 312, 308, three records of one physical corner
    # in DESCENDING arc -- gp and gn come out negative, the negative wins the min(), and every window collapses
    # to the 1.0 m floor. A 1 m window catches nothing, so real corners reported as unmeasurable: measured
    # half-widths [1.0, 1.0, 1.0, 106.0, 56.0, 54.0] on that course.
    # Sorting by arc makes both gaps non-negative by construction, which is what the disjointness claim in the
    # docstring assumed all along. Half-widths are returned in the CALLER'S order; only the neighbour lookup is
    # reordered. A zero gap (two records at the same arc) still constrains nothing, so base stands.
    idx = sorted((i for i in range(n) if turns[i].get("s") is not None), key=lambda i: turns[i]["s"])
    pos = {i: r for r, i in enumerate(idx)}          # list index -> rank in arc order
    s = [t.get("s") for t in turns]
    half = [None] * n
    for i, t in enumerate(turns):
        base = max(HALF_MIN, (t.get("len_m") or 0) / 2.0)
        if n == 1 or s[i] is None or len(idx) < 2:
            half[i] = base; continue
        r = pos[i]; m = len(idx)
        ip, inx = idx[r - 1], idx[(r + 1) % m]
        gp = (s[i] - s[ip]) if r > 0 else (s[i] + total_len - s[idx[-1]])
        gn = (s[inx] - s[i]) if r + 1 < m else (s[idx[0]] + total_len - s[i])
        half[i] = max(1.0, min(base, (gp or base * 2) / 2.0, (gn or base * 2) / 2.0))
    return half


def project(pcs, pts, closed, total):
    """Walk a lap in order, projecting each point onto the map's path SEGMENTS, searching only forward.

    ON A CIRCUIT THE SEARCH MUST WRAP. A lap does not begin at the map's arc origin — it begins wherever the
    start line is — so partway through it crosses s=L and continues at s=0. A forward search that stops at the
    last segment loses lock there and never regains it, which measured 28-31 passes per turn against a true
    84-90: two thirds of the evidence discarded, and discarded WORST for the turns just after the line. Wrapping
    is correct only for a closed course; on a point-to-point the end of the road really is the end.

    Returns [(s_map, dev_xz)] aligned with pts."""
    flat = []
    for pi, pc in enumerate(pcs):
        for i in range(len(pc["pts"]) - 1):
            a, b = pc["pts"][i], pc["pts"][i + 1]
            flat.append((a, b, pc["cum"][i], pc["cum"][i + 1]))
    if not flat:
        return []

    def foot(q, seg):
        (ax, az), (bx, bz), ca, cb = seg
        dx, dz = bx - ax, bz - az
        L2 = dx * dx + dz * dz
        if L2 <= 1e-9:
            return ca, math.hypot(q[0] - ax, q[1] - az)
        u = max(0.0, min(1.0, ((q[0] - ax) * dx + (q[1] - az) * dz) / L2))
        return ca + u * (cb - ca), math.hypot(q[0] - (ax + u * dx), q[1] - (az + u * dz))

    N = len(flat)
    out = []
    idx = None
    for k, p in enumerate(pts):
        q = (p[3], p[4])
        if idx is None:                                   # SEED once, globally
            idx = min(range(N), key=lambda j: foot(q, flat[j])[1])
            sm, dv = foot(q, flat[idx])
            out.append((sm, dv)); continue
        # forward-only, over an arc budget proportional to how far the car moved since the last point
        step = abs(p[0] - pts[k - 1][0]) if len(pts[k - 1]) > 0 else 0.0
        budget = 3.0 * max(step, 1.0) + 20.0
        acc, bj, bd, bs, m = 0.0, idx, 1e18, out[-1][0], 0
        while acc <= budget and m < N:
            j = (idx + m) % N if closed else idx + m
            if j >= N:
                break
            sm, dv = foot(q, flat[j])
            if dv < bd:
                bd, bj, bs = dv, j, sm
            acc += flat[j][3] - flat[j][2]
            m += 1
        idx = bj
        out.append((bs, bd))
    return out


def _v_free(pts):
    """The LAP's own straight-line pace: the median of its top-decile speeds. Normalising by this is what makes
    the flat test invariant to the car — a slow car flat through a corner and a fast one are the same fact."""
    v = sorted((p[1] for p in pts), reverse=True)
    if not v:
        return 0.0
    top = v[: max(1, len(v) // 10)]
    return statistics.median(top)


def measure(root, route_key, model=None):
    """Per MAP turn: what every stored lap did there. Returns {turn_id: traced-dict}."""
    model = model or json.load(open(os.path.join(root, "data", "courses", route_key.replace(":", "_").replace(" ", "_") + ".json"), encoding="utf-8"))
    geo = model.get("geometry") or {}
    turns = [t for t in (geo.get("turns") or []) if t.get("s") is not None and t.get("apex")]
    if not turns:
        return {}
    pcs, total = _pieces(geo)
    if not pcs:
        return {}
    p0, p1 = pcs[0]["pts"][0], pcs[-1]["pts"][-1]
    closed = math.hypot(p0[0] - p1[0], p0[1] - p1[1]) <= max(60.0, 0.12 * total)
    half = windows(turns, total)

    def in_win(x, s0, s1):
        """Window membership modulo the lap, so a turn sitting across the start line is not silently unmeasurable."""
        if not closed:
            return s0 <= x <= s1
        w = (s1 - s0) % total or total
        return ((x - s0) % total) <= w

    db = os.path.join(root, "data", "laps.db")
    if not os.path.exists(db):
        return {}
    cx = sqlite3.connect(db); cx.row_factory = sqlite3.Row
    try:
        rows = [dict(r) for r in cx.execute(
            "SELECT cid, build_id, lap_s, arc_m, void, pts FROM lap_traces WHERE route_key=?", (route_key,))]
    finally:
        cx.close()

    acc = {i: {"passes": [], "builds": set(), "samples": [], "steps": []} for i in range(len(turns))}
    n_laps = 0
    # HOW FAR ALONG THE ROAD HAS ANYTHING BEEN DRIVEN? On a long route never completed — the owner's case, a
    # 13732 m point-to-point with one stored lap reaching 1409 m — most turns have no data because nobody has
    # been there yet, which is a different fact from "we could not measure it" and must not read the same.
    reach = []
    lost = 0
    for r in rows:
        try:
            pts = json.loads(r["pts"])
        except Exception:
            continue
        if len(pts) < 20 or len(pts[0]) < 5:
            continue
        n_laps += 1
        proj = project(pcs, pts, closed, total)
        vf = _v_free(pts)
        good = [j for j in proj if j[1] <= DEV_MAX]
        if len(good) < 0.5 * len(proj):
            lost += 1                                     # the projector never held lock on this lap
        if good:
            reach.append((min(x for x, _ in good), max(x for x, _ in good)))
        for i, t in enumerate(turns):
            s0, s1 = t["s"] - half[i], t["s"] + half[i]
            seg = [(pts[k], proj[k]) for k in range(len(pts))
                   if proj[k] and in_win(proj[k][0], s0, s1) and proj[k][1] <= DEV_MAX]
            if len(seg) < MIN_SAMPLES:
                continue
            # must BRACKET the apex, not merely touch the window — modulo the lap, so a turn on the start line counts
            rel = [(j[0] - s0) % total if closed else j[0] - s0 for _, j in seg]
            if not (min(rel) <= (t["s"] - s0) % total if closed else s0 <= t["s"]) or not (max(rel) >= ((t["s"] - s0) % total if closed else t["s"] - s0)):
                continue
            sp = [p[1] for p, _ in seg]
            vmin = min(sp)
            ratio = (vmin / vf) if vf else 0.0
            al = []
            for (pa, ja), (pb, jb) in zip(seg, seg[1:]):
                ds = jb[0] - ja[0]
                if ds > 0.5:
                    v1, v2 = pa[1] * 0.44704, pb[1] * 0.44704
                    al.append((v2 * v2 - v1 * v1) / (2 * ds * 9.81))
            amin = min(al) if al else 0.0
            acc[i]["passes"].append({"vmin": vmin, "ratio": ratio, "amin": amin, "vf": vf,
                                     "grip": max((p[2] for p, _ in seg), default=0),
                                     "flat": ratio >= RATIO_FLAT and amin >= ALONG_FLOOR})
            acc[i]["builds"].add(r.get("build_id") or r.get("cid"))
            acc[i]["samples"].append(len(seg))
            acc[i]["steps"].append(statistics.median([b[1][0] - a[1][0] for a, b in zip(seg, seg[1:])]) if len(seg) > 1 else 0)

    out = {}
    for i, t in enumerate(turns):
        a = acc[i]; ps = a["passes"]
        med_s = statistics.median(a["samples"]) if a["samples"] else 0
        if not ps:
            # THREE DIFFERENT SILENCES, and conflating them is what made "not driven" useless. A turn nobody has
            # reached yet is a fact about the driving; a turn inside the driven stretch with no usable window is a
            # fact about the data; a course the projector could not follow is a fact about the map.
            seen = any(lo - half[i] <= t["s"] <= hi + half[i] for lo, hi in reach)
            v = ("map could not be followed — the projector lost the road on %d of %d laps" % (lost, n_laps))                 if (n_laps and lost >= 0.5 * n_laps) else                 ("driven past, but no window resolves it" if seen else
                 "beyond the stretch driven so far — no lap has reached here yet")
            out[t.get("id") or ("G%d" % (i + 1))] = {
                "n_passes": 0, "n_laps_traced": n_laps, "half_m": round(half[i], 1),
                "med_samples": med_s, "reached": seen, "verdict": v}
            continue
        nf = sum(1 for p in ps if p["flat"])
        agree = nf / len(ps)
        if med_s < MIN_SAMPLES:
            verdict = "trace resolution insufficient"
        elif len(ps) >= N_FLAT and len(a["builds"]) >= N_BUILDS_FLAT and agree >= AGREE_FLAT:
            verdict = "no lift measured"
        elif len(ps) >= N_LIKELY and agree >= 0.50:
            verdict = "probably no lift"
        else:
            verdict = "measured"
        out[t.get("id") or ("G%d" % (i + 1))] = {
            "n_passes": len(ps), "n_laps_traced": n_laps, "n_builds": len(a["builds"]),
            "half_m": round(half[i], 1), "med_samples": med_s,
            "med_step_m": round(statistics.median(a["steps"]), 1) if a["steps"] else None,
            "min_mph": round(statistics.median([p["vmin"] for p in ps])),
            "ratio": round(statistics.median([p["ratio"] for p in ps]), 2),
            "a_long_min": round(statistics.median([p["amin"] for p in ps]), 2),
            # RAW agreement to 3 places, and the count it came from. G13 sits at 70/88 = 0.795 against a 0.80
            # gate — one pass short. Rounding that to 0.80 would have hidden a boundary case, and moving the gate
            # to catch it would be fitting a constant to one corner of one course.
            "n_flat": nf, "agreement": round(agree, 3),
            "reading": ("no lift measured on %d of %d stored laps — carried %d mph, %d%% of this lap's own "
                        "straight-line pace" % (nf, len(ps), round(statistics.median([p["vmin"] for p in ps])),
                                                round(100 * statistics.median([p["ratio"] for p in ps]))))
                       if verdict in ("no lift measured", "probably no lift") else None,
            "verdict": verdict}
    return out


def selftest():
    """The assertions the design brief demands, run against real data. Each is a MEASURED invariant, not a hope.

    They exist because this module's two constants (RATIO_FLAT, ALONG_FLOOR) were calibrated on one course that
    holds 71% of all usable laps in the lab. A calibration that cannot be restated as a falsifiable claim about
    other courses is a fit, not a finding."""
    ok, fail = [], []

    def chk(name, cond, detail=""):
        (ok if cond else fail).append("%s%s" % (name, (" — " + detail) if detail else ""))

    st = measure(ROOT, "-7350_-2100")
    chk("every mapped turn is measured", all(v.get("n_passes") for v in st.values()),
        "%d of %d have zero passes" % (sum(1 for v in st.values() if not v.get("n_passes")), len(st)))
    chk("half-widths are the brief's",
        [st[k]["half_m"] for k in st] == [20.0, 10.0, 10.0, 26.0, 24.0, 34.0, 32.0, 10.0, 10.0, 30.0, 18.0, 18.0, 42.0],
        str([st[k]["half_m"] for k in st]))
    # the hairpins must NEVER read as unlifted, at any setting of the two constants
    global RATIO_FLAT, ALONG_FLOOR
    r0, a0 = RATIO_FLAT, ALONG_FLOOR
    worst = {}
    for rr in (0.60, 0.65, 0.70, 0.75):
        for aa in (-0.05, -0.10, -0.20, -0.30):
            RATIO_FLAT, ALONG_FLOOR = rr, aa
            s2 = measure(ROOT, "-7350_-2100")
            for k in ("G10", "G11"):
                worst[k] = max(worst.get(k, 0), s2[k].get("agreement", 0))
    RATIO_FLAT, ALONG_FLOOR = r0, a0
    chk("the two hairpins are never unlifted at any setting", max(worst.values()) < 0.10, str(worst))
    # the flat set must not spread across thin routes, where n>=8 cannot be met honestly
    thin = 0
    cx = sqlite3.connect(os.path.join(ROOT, "data", "laps.db"))
    keys = [r[0] for r in cx.execute("SELECT route_key FROM lap_traces GROUP BY route_key HAVING COUNT(*) < 8")]
    cx.close()
    for rk in keys:
        try:
            thin += sum(1 for v in measure(ROOT, rk).values() if v.get("verdict") == "no lift measured")
        except Exception:
            pass
    chk("no route with <8 laps claims an unlifted turn", thin == 0, "%d claimed" % thin)

    print("SELFTEST — %d passed, %d failed" % (len(ok), len(fail)))
    for x in ok:
        print("  ✅ %s" % x)
    for x in fail:
        print("  ❌ %s" % x)
    return 1 if fail else 0


def report(route_key):
    st = measure(ROOT, route_key)
    if not st:
        print("  %s — no map turns or no traces" % route_key); return
    print("\n%s" % route_key)
    print("  %-5s %-7s %-7s %-7s %-7s %-6s %-6s  %s" % ("turn", "passes", "half_m", "min_mph", "ratio", "a_g", "agree", "reading"))
    for k, v in st.items():
        if not v.get("n_passes"):
            print("  %-5s %-7s %-7s %-7s %-7s %-6s %-6s  %s" % (k, 0, v.get("half_m"), "—", "—", "—", "—", v["verdict"])); continue
        print("  %-5s %-7d %-7s %-7s %-7s %-6s %-6s  %s" % (
            k, v["n_passes"], v["half_m"], v["min_mph"], v["ratio"], v["a_long_min"], v["agreement"], v["verdict"]))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("route", nargs="?")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    if a.selftest:
        sys.exit(selftest())
    if a.all:
        cx = sqlite3.connect(os.path.join(ROOT, "data", "laps.db"))
        for (rk,) in cx.execute("SELECT DISTINCT route_key FROM lap_traces"):
            report(rk)
        cx.close(); return
    report(a.route or "-7350_-2100")


if __name__ == "__main__":
    main()
