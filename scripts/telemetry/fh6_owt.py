#!/usr/bin/env python3
"""fh6_owt.py -- read Forza Horizon 6 route centre-lines (.owt) and match our learned courses.

The game ships one ``Route<id>.owt`` per defined route under
``media/openworld/brio/aitracks``. Each is the route's centre-line, and the coordinates are the
SAME metre frame the telemetry reports, so a learned course and a game route can be compared
directly with no transform.

Layout (little-endian; verified against 169 files):

    0x00  char[4] 'FTWO'
    0x04  u16     version (2)
    0x24  u32     point count N
    0x60  N x 56  per-point record; the first three floats are x, y (elevation), z
    tail  24 bytes

Why this matters: the game knows exactly where a track is, and we know exactly how fast it was
driven. Neither half is useful alone. This module supplies the first half so a course row can
carry the game's own route identity beside our measured lap times.

    python scripts/telemetry/fh6_owt.py --list
    python scripts/telemetry/fh6_owt.py --match          # match our courses, print the table
    python scripts/telemetry/fh6_owt.py --match --json OUT.json
"""
import argparse
import glob
import json
import math
import os
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
AITRACKS = r"C:\XboxGames\Forza Horizon 6\Content\media\openworld\brio\aitracks"

MAGIC = b"FTWO"
HDR = 0x60
STRIDE = 56
COUNT_OFF = 0x24


def parse(path, full=False):
    """-> {'route_id', 'n', 'points': [(x, y, z)], 'length_m', 'is_loop', 'bbox'}"""
    with open(path, "rb") as fh:
        b = fh.read()
    if b[:4] != MAGIC:
        raise ValueError("%s: not an .owt (magic %r)" % (path, b[:4]))
    n = struct.unpack_from("<I", b, COUNT_OFF)[0]
    need = HDR + n * STRIDE
    if need > len(b):
        raise ValueError("%s: %d points need %d bytes, file is %d" % (path, n, need, len(b)))
    # 14 floats per record: 0-2 position, 3-5 the lateral half-width vector (perpendicular to
    # travel on 98% of steps), 6-8 the unit surface normal (banking), 9-13 sparse link data.
    # full=True keeps all of them; the matcher only needs position and 3 floats is far cheaper.
    fmt = "<14f" if full else "<3f"
    raw = [struct.unpack_from(fmt, b, HDR + i * STRIDE) for i in range(n)]
    # A few routes carry non-finite points (unfinished or stitched geometry). Drop them rather
    # than the whole file: the surviving polyline is still the route's real centre-line.
    pts = [p for p in raw if all(math.isfinite(v) for v in p[:3])]
    n_bad = len(raw) - len(pts)
    if len(pts) < 2:
        raise ValueError("%s: only %d finite points of %d" % (path, len(pts), n))
    L = sum(math.dist(pts[i][::2], pts[i + 1][::2]) for i in range(len(pts) - 1))
    closed = math.dist(pts[0][::2], pts[-1][::2]) if len(pts) > 1 else 0.0
    xs = [p[0] for p in pts]
    zs = [p[2] for p in pts]
    rid = os.path.splitext(os.path.basename(path))[0]
    return {"route_id": rid[5:] if rid.lower().startswith("route") else rid,
            "file": os.path.basename(path), "n": len(pts), "n_dropped": n_bad, "points": pts,
            "length_m": round(L, 1), "gap_m": round(closed, 1),
            "is_loop": closed < 60.0,
            "bbox": [round(min(xs)), round(max(xs)), round(min(zs)), round(max(zs))]}


def load_all(d=AITRACKS, full=False):
    out = []
    for p in sorted(glob.glob(os.path.join(d, "*.owt"))):
        try:
            out.append(parse(p, full=full))
        except Exception as e:                           # noqa: BLE001
            print("  !! %s: %s" % (os.path.basename(p), e), file=sys.stderr)
    return out


# ---------------------------------------------------------------------------
# matching
# ---------------------------------------------------------------------------

def _grid(pts, cell=40.0):
    g = {}
    for x, z in pts:
        g.setdefault((int(x // cell), int(z // cell)), []).append((x, z))
    return g


def _nearest(g, x, z, cell=40.0):
    cx, cz = int(x // cell), int(z // cell)
    best = 1e18
    for dx in (-1, 0, 1):
        for dz in (-1, 0, 1):
            for (px, pz) in g.get((cx + dx, cz + dz), ()):
                d = (px - x) ** 2 + (pz - z) ** 2
                if d < best:
                    best = d
    return math.sqrt(best) if best < 1e17 else None


ON_ROUTE_M = 15.0          # within this of the centre-line counts as "on the route"


def compare(ours, theirs):
    """Compare a learned path with a game centre-line in BOTH directions.

    Forward alone is not identity. Game routes share roads: a short loop that happens to run
    along a highway lies within a couple of metres of every route using that highway, so a
    one-directional test called two different courses the same route. Identity needs three
    things together -- we are on it, we covered it, and the lengths agree.

      mean/p95  how far our points sit from their centre-line (are we on this road)
      covered   fraction of THEIR points we came within ON_ROUTE_M of (did we drive all of it)
    """
    them = [(p[0], p[2]) for p in theirs]
    g_them = _grid(them)
    ds = []
    for x, z in ours:
        d = _nearest(g_them, x, z)
        ds.append(d if d is not None else 9999.0)
    if not ds:
        return None
    g_ours = _grid(list(ours))
    hit = 0
    for x, z in them:
        d = _nearest(g_ours, x, z)
        if d is not None and d <= ON_ROUTE_M:
            hit += 1
    ds_sorted = sorted(ds)
    return {"mean": sum(ds) / len(ds), "p95": ds_sorted[int(0.95 * (len(ds_sorted) - 1))],
            "max": ds_sorted[-1], "covered": hit / float(len(them))}


def match_courses(routes, course_dir=None, verbose=False):
    course_dir = course_dir or os.path.join(ROOT, "data", "courses")
    results = []
    for path in sorted(glob.glob(os.path.join(course_dir, "*.json"))):
        try:
            with open(path, encoding="utf-8") as fh:
                m = json.load(fh)
        except Exception:                                # noqa: BLE001
            continue
        key = m.get("route_key")
        ours = (m.get("geometry") or {}).get("path") or []
        if not key or len(ours) < 12:
            continue
        our_len = (m.get("geometry") or {}).get("length_m")
        # cheap reject: a route whose bounding box does not contain most of our path
        oxs = [p[0] for p in ours]
        ozs = [p[1] for p in ours]
        cand = []
        for r in routes:
            bx0, bx1, bz0, bz1 = r["bbox"]
            if max(oxs) < bx0 - 300 or min(oxs) > bx1 + 300:
                continue
            if max(ozs) < bz0 - 300 or min(ozs) > bz1 + 300:
                continue
            cand.append(r)
        scored = []
        for r in cand:
            c = compare(ours, r["points"])
            if not c:
                continue
            # rank by a score that punishes BOTH being off the road and failing to cover the
            # route, so a short loop can no longer win a long highway it merely touches
            lr = (our_len / r["length_m"]) if (our_len and r["length_m"]) else 0.0
            score = c["mean"] + 40.0 * (1.0 - c["covered"]) + 25.0 * abs(1.0 - min(lr, 1 / lr if lr else 0))
            scored.append((score, c, r))
        scored.sort(key=lambda t: t[0])
        best = scored[0] if scored else None
        run2 = scored[1] if len(scored) > 1 else None
        results.append({
            "route_key": key, "our_name": m.get("name"), "our_len": our_len,
            "n_candidates": len(cand),
            "route_id": best[2]["route_id"] if best else None,
            "game_len": best[2]["length_m"] if best else None,
            "game_loop": best[2]["is_loop"] if best else None,
            "mean_dev_m": round(best[1]["mean"], 2) if best else None,
            "p95_dev_m": round(best[1]["p95"], 2) if best else None,
            "covered": round(best[1]["covered"], 3) if best else None,
            "len_ratio": round((our_len / best[2]["length_m"]), 3) if (best and our_len and best[2]["length_m"]) else None,
            "score": round(best[0], 2) if best else None,
            "runner_up": run2[2]["route_id"] if run2 else None,
            "runner_up_score": round(run2[0], 2) if run2 else None,
        })
    return results


def verdict(r):
    """verified / probable / partial / none.

    'partial' is a real and useful answer, not a failure: it means we are demonstrably driving
    ON that route but have only ever lapped part of it. Calling that a match would attach lap
    records to a track we never completed.
    """
    if r["mean_dev_m"] is None:
        return "none"
    m, cov, lr = r["mean_dev_m"], r["covered"] or 0.0, r["len_ratio"] or 0.0
    ru = r["runner_up_score"]
    clear = (ru is None) or (r["score"] is not None and ru > r["score"] + 8)
    close = m <= 8.0
    whole = cov >= 0.85 and 0.85 <= lr <= 1.18
    if close and whole and clear:
        return "verified"
    if close and whole:
        return "probable"
    if close and cov >= 0.25:
        return "partial"
    return "none"


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--dir", default=AITRACKS)
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--match", action="store_true")
    ap.add_argument("--json", default=None)
    a = ap.parse_args(argv)

    routes = load_all(a.dir)
    print("%d route centre-lines" % len(routes))
    if a.list:
        for r in sorted(routes, key=lambda r: -r["length_m"])[:40]:
            print("  Route%-7s %6.0f m  %5d pts  %-4s bbox x[%d..%d] z[%d..%d]"
                  % (r["route_id"], r["length_m"], r["n"], "loop" if r["is_loop"] else "p2p",
                     *r["bbox"]))
    if a.match:
        res = match_courses(routes)
        res.sort(key=lambda r: (r["score"] is None, r["score"]))
        print("\n%-15s %-20s %7s %7s %6s %6s %5s  %-10s %s" %
              ("our course", "name", "our m", "game m", "dev m", "cover", "len", "route", "verdict"))
        for r in res:
            v = verdict(r)
            print("%-15s %-20s %7s %7s %6s %6s %5s  Route%-9s %s"
                  % (r["route_key"], (r["our_name"] or "")[:20],
                     int(r["our_len"] or 0), int(r["game_len"] or 0) if r["game_len"] else "-",
                     r["mean_dev_m"] if r["mean_dev_m"] is not None else "-",
                     ("%.0f%%" % (100 * r["covered"])) if r["covered"] is not None else "-",
                     ("%.2f" % r["len_ratio"]) if r["len_ratio"] else "-",
                     r["route_id"] or "-", v))
        from collections import Counter
        tally = Counter(verdict(r) for r in res)
        print("\n%s  (of %d courses)"
              % (", ".join("%d %s" % (n, k) for k, n in tally.most_common()), len(res)))
        if a.json:
            for r in res:
                r["verdict"] = verdict(r)
            with open(a.json, "w", encoding="utf-8") as fh:
                json.dump(res, fh, indent=1)
            print("wrote %s" % a.json)
    return 0


if __name__ == "__main__":
    sys.exit(main())
