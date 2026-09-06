#!/usr/bin/env python3
"""fh6_owt.py -- read Forza Horizon 6 route centre-lines (.owt) and match our learned courses.

The game ships one ``Route<id>.owt`` per defined route under
``media/openworld/brio/aitracks``. Each is the route's centre-line, and the coordinates are the
SAME metre frame the telemetry reports, so a learned course and a game route can be compared
directly with no transform.

Layout (little-endian; verified byte-for-byte against all 169 files, 2026-09-06):

    0x00  char[4] 'FTWO'
    0x04  u16     version (2)
    0x0C  u32     payload size = file size - 32 (everything after this word, up to the trailer)
    0x20  u32     S, the section count: 1 on 163 files; 4, 5 or 6 on Route132/281/351/1181/1281/8008
    0x24  u32     N, point records in the file, summed over every section
    0x50  u32     section 0's point count;  0x54  u32  its flags
    0x58  (S-1) x 40  one entry per further section, in index order:
                  u32 start index, u32 0, 3 x (i32 link: the section a car may enter next, i32 0;
                  -1,-1 = unused), u32 point count, u32 flags
    align 16
          N x 56  per-point record; the first three floats are x, y (elevation), z
    align 16
    tail  16 bytes, a copy of the first 16 header bytes

    flags: low byte = number of outgoing links; high byte = line variant, 1 the primary line,
    2 or 4 an alternate line over the same stretch of road (same start and end as a primary
    section, never entered by the primary chain).

A route is therefore a small GRAPH of sections, not one array, and the point array does not
start at 0x60 unless S is 1. The Colossus (Route132) is six sections: a primary chain
0 -> 1 -> 2 -> 3 -> back to 0 of 37.7 km, plus two alternate lines that re-run sections 0 and 2.
Reading it as one array from 0x60 -- 192 bytes early, which is not a whole number of records --
gave 3.1 km and a zero bounding box; concatenating all six sections gives 69 km with a 2.7 km
gap. `parse` returns the primary chain as the polyline and exposes every section beside it.

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
HDR = 0x60              # where the point array starts when the file holds ONE section
STRIDE = 56
COUNT_OFF = 0x24
NSEC_OFF = 0x20
SEC0_OFF = 0x50         # section 0's (count, flags); the other sections' entries follow at 0x58
SEC_ENTRY = 40
TRAILER = 16            # copy of the first 16 header bytes, after the array is padded to 16
JOIN_M = 12.0           # a section begins where its predecessor ends: points are ~2 m apart
LOOP_GAP_M = 60.0       # first and last point closer than this = a circuit


def _align16(o):
    return (o + 15) // 16 * 16


def _xz_dist(a, b):
    """Planar distance between two records, inf when either is not finite."""
    if not all(math.isfinite(v) for v in (a[0], a[2], b[0], b[2])):
        return float("inf")
    return math.dist((a[0], a[2]), (b[0], b[2]))


def _layout(b, path):
    """Decode the chunk layout -> (N, sections, array offset).

    Every byte must be accounted for: [header][section table][pad][N records][pad][trailer] has
    to equal the file, and the section counts have to sum to N with cumulative starts. Anything
    else is refused rather than read from a guessed offset -- reading records from where they
    were assumed to be is exactly the defect this decode replaced (Route132: 3.1 km, bbox 0;
    Route1181: every x = 0), and the old size heuristic could not see it because a wrong offset
    and a wrong pad can cancel.
    """
    u32 = lambda o: struct.unpack_from("<I", b, o)[0]
    nsec, n_all, payload = u32(NSEC_OFF), u32(COUNT_OFF), u32(0x0C)
    if nsec < 1 or nsec > 64:
        raise ValueError("%s: %d sections is not a route" % (path, nsec))
    c0, f0 = struct.unpack_from("<2I", b, SEC0_OFF)
    secs = [{"i": 0, "start": 0, "count": c0, "flags": f0, "links": None}]
    o = SEC0_OFF + 8
    for k in range(1, nsec):
        st, _z, l0, _a, l1, _b, l2, _c, cnt, fl = struct.unpack_from("<2I6i2I", b, o)
        secs.append({"i": k, "start": st, "count": cnt, "flags": fl,
                     "links": [l for l in (l0, l1, l2) if l >= 0]})
        o += SEC_ENTRY
    for s in secs:
        s["variant"] = s["flags"] >> 8
        s["n_links"] = s["flags"] & 0xFF
    arr = _align16(o)
    if _align16(arr + n_all * STRIDE) + TRAILER != len(b) or 0x10 + payload + TRAILER != len(b):
        raise ValueError("%s: %d sections + %d records do not lay out to %d bytes (payload %d)"
                         % (path, nsec, n_all, len(b), payload))
    run = 0
    for s in secs:
        if s["start"] != run:
            raise ValueError("%s: section %d starts at %d, expected %d" % (path, s["i"], s["start"], run))
        run += s["count"]
    if run != n_all:
        raise ValueError("%s: sections hold %d records, header says %d" % (path, run, n_all))
    return n_all, secs, arr


def _chain(secs, raw):
    """The primary line through the section graph, as section indices in driving order.

    Section 0 is the start. Each later section names up to three sections a car may enter when
    it ends; where more than one is offered, the primary variant (flags high byte 1) is the
    route and the rest are alternate lines over the same road. Section 0 carries no entry of
    its own, so its successor is the section that begins where it ends. The walk stops when it
    would re-enter a section already used (a circuit) or reaches one with nowhere to go
    (point-to-point). Never a guess about which section is which: the table and the road agree
    on all six multi-section files, and on the 163 single-section files the chain is [0].
    """
    def first(k):
        return raw[secs[k]["start"]]

    def last(k):
        s = secs[k]
        return raw[s["start"] + s["count"] - 1]

    order = [0]
    while True:
        cur = order[-1]
        links = secs[cur]["links"]
        if links is None:
            cands = [k for k in range(len(secs)) if k != cur and _xz_dist(first(k), last(cur)) <= JOIN_M]
        else:
            cands = [k for k in links if 0 <= k < len(secs)]
        if not cands:
            break
        cands.sort(key=lambda k: (secs[k]["variant"] != 1, _xz_dist(first(k), last(cur)), k))
        if cands[0] in order:
            break
        order.append(cands[0])
    return order


def _length(pts):
    return sum(_xz_dist(pts[i], pts[i + 1]) for i in range(len(pts) - 1)) if len(pts) > 1 else 0.0


def parse(path, full=False):
    """-> {'route_id', 'n', 'points': [(x, y, z)], 'length_m', 'is_loop', 'bbox', 'sections', 'chain'}

    `points` is the primary chain of sections in driving order (the whole array on a
    single-section file). `sections` lists every section with its start/count/flags/links/
    length, and `chain` the section indices `points` was built from, so the alternate lines
    stay reachable without being mistaken for the route.
    """
    with open(path, "rb") as fh:
        b = fh.read()
    if b[:4] != MAGIC:
        raise ValueError("%s: not an .owt (magic %r)" % (path, b[:4]))
    n_all, secs, arr = _layout(b, path)
    # 14 floats per record: 0-2 position, 3-5 the lateral half-width vector (perpendicular to
    # travel on 98% of steps), 6-8 the unit surface normal (banking), 9-13 sparse link data.
    # full=True keeps all of them; the matcher only needs position and 3 floats is far cheaper.
    #
    # RECORD BYTES 44..51 ARE NOT FLOATS.  Slots [11] and [12] are four u16 -- that is why they
    # read as 65537 (0x00010001) and 131074 (0x00020002): two equal u16 side by side. All four
    # copies carry the same value on 486,424 of 568,336 points (85.59%), and the value is a
    # world-space road-class code: 0x0110/0x0111 land on nav road_type 'dirt' with 0.993/0.997
    # purity, 0x0020 on 'trail' with 0.998, 0x0000/0x0001 on paved 'a'/'b'/'freeway'. Bit 15 is
    # a separate flag (22,984 points); mask it off before comparing codes. The code is exposed
    # as 'codes' so a surface can be attached per point with no spatial matching at all -- see
    # scripts/db/import_surface.py, which uses it to reach the points the free-roam nav graph
    # does not cover.
    fmt = "<14f" if full else "<3f"
    raw, all_codes = [], []
    for i in range(n_all):
        o = arr + i * STRIDE
        raw.append(struct.unpack_from(fmt, b, o))
        all_codes.append(struct.unpack_from("<H", b, o + 44)[0])
    for s in secs:
        s["length_m"] = round(_length(raw[s["start"]:s["start"] + s["count"]]), 1)
    chain = _chain(secs, raw)
    idx = [i for k in chain for i in range(secs[k]["start"], secs[k]["start"] + secs[k]["count"])]
    # Non-finite points are dropped rather than the whole file. With the array read from its true
    # offset no shipped file has any (the "sentinel records" seen before were the section table
    # read as points); the guard stays so a damaged file still yields its surviving centre-line.
    keep = [i for i in idx if all(math.isfinite(v) for v in raw[i][:3])]
    pts = [raw[i] for i in keep]
    codes = [all_codes[i] for i in keep]
    n_bad = len(idx) - len(pts)
    if len(pts) < 2:
        raise ValueError("%s: only %d finite points of %d" % (path, len(pts), len(idx)))
    # x and z NAMED, not strided. `p[::2]` happens to be (x, z) on a 3-float point and becomes
    # seven dimensions once full=True keeps all 14 -- including the unexplained slots, whose
    # garbage made two routes report a NaN length. A stride is not an index.
    L = _length(pts)
    closed = _xz_dist(pts[0], pts[-1])
    xs = [p[0] for p in pts]
    zs = [p[2] for p in pts]
    rid = os.path.splitext(os.path.basename(path))[0]
    return {"route_id": rid[5:] if rid.lower().startswith("route") else rid,
            "file": os.path.basename(path), "n": len(pts), "n_dropped": n_bad, "points": pts,
            "codes": codes,
            "n_hdr": n_all, "n_sections": len(secs), "chain": chain, "sections": secs,
            "length_m": round(L, 1), "gap_m": round(closed, 1),
            "is_loop": closed < LOOP_GAP_M,
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


def match_courses(routes, course_dir=None, verbose=False, courses=None):
    """Match every course against `routes`.

    `courses` (a list of dicts shaped like a course model: route_key, name, geometry{path,
    length_m}) lets a caller supply already-loaded rows -- scripts/db/import_course_match.py
    reads them from the `course` table. When omitted, the on-disk data/courses/*.json models
    are globbed as before, so the CLI (--match) is unchanged.
    """
    if courses is None:
        course_dir = course_dir or os.path.join(ROOT, "data", "courses")
        courses = []
        for path in sorted(glob.glob(os.path.join(course_dir, "*.json"))):
            try:
                with open(path, encoding="utf-8") as fh:
                    courses.append(json.load(fh))
            except Exception:                            # noqa: BLE001
                continue
    results = []
    for m in courses:
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
