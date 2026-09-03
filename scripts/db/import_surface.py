#!/usr/bin/env python3
"""import_surface.py -- what the road at every turn is MADE of.

The project could already say a corner's radius, width and banking, all read off the game's
own centre-line. It could not say whether that corner was tarmac or dirt, and that is the
input every grip-side recommendation depends on: NatalSurfaceTypes.xml gives each surface an
OffRoadness of 0 or 1, and all 41 rows of List_TireCompound carry a separate friction bank per
surface. Compound choice, tyre pressure, damping, ride height and diff advice all fork on it.

TWO SOURCES, USED TOGETHER
--------------------------
Primary, named: Brio_00.nav. The free-roam road graph -- 38,473 nodes over 1,532 splines --
gives every road a `road_type` attribute whose value is a plain string in the file's own value
blob ('a', 'b', 'freeway', 'dirt', 'trail', 'hidden', 'shortcut'). The vocabulary is read, not
inferred, which is why this beats the per-point code as the label authority.

Secondary, exact: Route<id>.owt record bytes 44..51, four u16 previously logged as unexplained
floats. The low u16 is a world-space road-class code sitting in the very files the turns were
derived from, so it needs no spatial matching at all. Its meaning has to be learned -- and it
is learned HERE, from the nav graph, by majority vote over every point where both sources
speak. That makes the code table reproducible rather than a hand-written constant.

Where they overlap the two agree: 0x0110 -> dirt at 0.993 purity, 0x0111 -> dirt 0.997,
0x0020 -> trail 0.998, 0x0001 -> paved 0.982, 0x0000 -> paved 0.963.

RESULT on the 3,811 rows of ref_route_turn: 3,423 named by the nav graph (median 3.2 m from
the apex to the node it was read at), 75 more by the learned code, 313 left NULL. Of 169
routes, 111 paved, 39 mixed, 3 loose, 16 unknown. The NULLs are not a gap to be filled by
guessing: they are the stretches of cross-country and airfield routes that leave the road
network entirely, and the surface there is genuinely not in either file.

Run:  python scripts/db/import_surface.py [--db PATH] [--dir AITRACKS] [--nav BRIO] [-v]
"""
import argparse
import collections
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "scripts", "telemetry"))

import fh6db                                            # noqa: E402
import fh6_nav                                          # noqa: E402
import fh6_owt                                          # noqa: E402

# How far a centre-line point may sit from a free-roam nav node and still be read from it.
# Nodes are spaced about 20 m along a spline, so a point ON the road is typically 3 m from the
# nearest one; 25 m is "still the same road", not "close enough to guess".
NAV_MAX_M = 25.0

# A learned code only becomes a label when it is common enough to have been measured and
# clean enough to mean one thing. Both thresholds are deliberately blunt: the head codes clear
# them by a mile (0.99+) and the 25,000-value junk tail clears neither.
# Held out on the road network -- learn on 80% of the nav-matched points, score on the other
# 20% -- this table answers 92,261 of 95,059 points (97.1%) and is right on 99.20% of them.
CODE_MIN_N = 30
CODE_MIN_PURITY = 0.80

# ...but that 99.2% is a number for the ROAD NETWORK, and a code is only validated where
# something validated it. Off the network a code can be the writer's default rather than a
# surface, so each learned code is made to prove it still means the same thing out there,
# using the only witness available off the graph: the road's own shape.
#
# Median |y[i-1] - 2 y[i] + y[i+1]| over 2 m steps, on-network vs off-network:
#     0x0001   n_on 351,978  1.43 mm   n_off  2,350  0.09 mm   0.1x   -> keeps its meaning
#     0x0000   n_on  46,599  0.79 mm   n_off 12,070  2.67 mm   3.4x   -> does NOT
# 0x0000 is the value left where no road class applies. On the network it coincides with
# a-roads and freeways; off it, it is written over the cross-country terrain of routes like
# Nangan and Yahikoyama whose off-network stretches measure 6.18 and 5.42 mm against their own
# on-network 0.16 and 1.98 mm. Trusting it there labelled eight cross-country routes 'paved'.
# So: a code is refused off-network when its off-network roughness is both materially worse
# than its own on-network roughness and outside the paved band the classes themselves define
# (b, the roughest paved class, sits at 1.85 mm).
PAVED_MAX_MM = 1.85
OFFNET_RATIO = 2.0
ROUGH_MIN_N = 30

# A route whose centre-line is mostly OFF the road graph has not been measured, it has been
# glimpsed. Below this it gets no dominant label at all -- road_class_known says how much was
# read, and NULL is the honest answer for the rest.
MIN_KNOWN = 0.5

# A route is called paved or loose only when one side owns it. 60% dirt is not a dirt route --
# it is a mixed one, and the tune has to survive both halves.
#
# 0.90 is not a taste. Sort every route the game's own CareerRaceDataSet labels and the
# measured pct_loose falls into two blocks with nothing between them: all 46 'asphalt' routes
# sit at or below 0.031, all 21 'mixed_asphalt_dirt' routes at or above 0.186. Every threshold
# in that empty gap classifies all 67 identically, so the number is read off the data rather
# than chosen; 0.10 sits in the middle of the gap.
DOMINANT = 0.90

NEW_ROUTE_COLS = [
    ("road_class", "TEXT"), ("pct_loose", "REAL"), ("road_class_known", "REAL"),
    ("road_class_mix", "TEXT"),
]
NEW_TURN_COLS = [
    ("road_class", "TEXT"), ("road_type", "TEXT"), ("road_profile", "TEXT"),
    ("offroad", "INTEGER"), ("surface_src", "TEXT"), ("surface_m", "REAL"),
]

SURFACE_TABLE = """
CREATE TABLE IF NOT EXISTS ref_route_surface (
  route_id     TEXT NOT NULL REFERENCES ref_route(route_id) ON DELETE CASCADE,
  i            INTEGER NOT NULL,
  road_class   TEXT,
  road_type    TEXT,
  road_profile TEXT,
  offroad      INTEGER,
  code         INTEGER,
  nav_m        REAL,
  src          TEXT NOT NULL,
  PRIMARY KEY (route_id, i)
) WITHOUT ROWID"""


def ensure_columns(cx):
    """Add the surface columns to tables that predate them. ALTER TABLE ADD COLUMN with no
    default is metadata-only in SQLite, so this rewrites nothing."""
    cx.execute(SURFACE_TABLE)
    cx.execute("CREATE INDEX IF NOT EXISTS ix_route_surface "
               "ON ref_route_surface(route_id, surface)")
    added = 0
    for table, cols in (("ref_route", NEW_ROUTE_COLS), ("ref_route_turn", NEW_TURN_COLS)):
        have = {r[1] for r in cx.execute("PRAGMA table_info(%s)" % table)}
        for name, decl in cols:
            if name not in have:
                cx.execute("ALTER TABLE %s ADD COLUMN %s %s" % (table, name, decl))
                added += 1
    cx.commit()
    return added


def learn_code_table(samples):
    """samples: [(code, road_type)] -> two tables, each with its own evidence.

    This is the step that turns the .owt's 16-bit code from a number into a label, and it does
    it from the nav graph rather than from a table someone typed. A code is kept only when it
    was seen CODE_MIN_N times and one answer holds CODE_MIN_PURITY of them.

    It is learned at BOTH levels, and the two are not the same question. Code 0x0001 covers 62%
    of every centre-line in the game and lands on nav 'a' 54.6% of the time and 'b' 44.5% --
    it fails the purity test for a road_type and it should, because the code does not encode
    the a/b distinction at all. It lands on a PAVED road 98.2% of the time, which it does
    encode. So paved-vs-loose is learned separately and survives where the finer label cannot,
    and that is the split tuning actually turns on.
    """
    per_rt = collections.defaultdict(collections.Counter)
    per_su = collections.defaultdict(collections.Counter)
    for code, rt in samples:
        if rt:
            per_rt[code][rt] += 1
            su = fh6_nav.SURFACE_OF.get(rt)
            if su:
                per_su[code][su] += 1

    def vote(per):
        table, evidence = {}, {}
        for code, c in per.items():
            n = sum(c.values())
            best, k = c.most_common(1)[0]
            if n >= CODE_MIN_N and k / n >= CODE_MIN_PURITY:
                table[code] = best
                evidence[code] = {"label": best, "n": n, "purity": round(k / n, 4)}
        return table, evidence

    rt_table, rt_ev = vote(per_rt)
    su_table, su_ev = vote(per_su)
    return rt_table, su_table, {"road_type": rt_ev, "road_class": su_ev}


def _median(v):
    v = sorted(v)
    return v[len(v) // 2] if v else None


def offnet_trust(codes, rough_on, rough_off):
    """Which learned codes may be used where the road graph does not reach.

    A code is refused when its off-network roughness is more than OFFNET_RATIO times its
    on-network roughness AND lands outside the paved band. Nothing is hand-listed: the test
    runs over this corpus every import, so if the game ships new geometry the verdict moves
    with it. Returns (allowed set, per-code evidence).
    """
    allowed, ev = set(), {}
    for c in codes:
        a, b = rough_on.get(c, []), rough_off.get(c, [])
        ma, mb = (_median(a) if len(a) >= ROUGH_MIN_N else None,
                  _median(b) if len(b) >= ROUGH_MIN_N else None)
        ok = True
        if ma is not None and mb is not None:
            ok = not (mb > OFFNET_RATIO * ma and mb > PAVED_MAX_MM)
        if ok:
            allowed.add(c)
        if mb is not None:
            ev["0x%04X" % c] = {"n_on": len(a), "n_off": len(b),
                                "mm_on": None if ma is None else round(ma, 2),
                                "mm_off": round(mb, 2), "offnet": ok}
    return allowed, ev


def run(cx, aitracks, nav_path, verbose=False):
    ensure_columns(cx)

    ix = fh6_nav.SurfaceIndex(nav_path)
    # full=False keeps 3 floats a point; the surface code comes back either way
    routes = fh6_owt.load_all(aitracks, full=False)
    by_id = {}
    for r in routes:
        by_id[r["route_id"]] = r
    known = {r[0] for r in cx.execute("SELECT route_id FROM ref_route")}

    # ---- pass 1: read every centre-line point against the nav graph -------
    # read[route_id][i] = (code, nav hit or None), one entry per centre-line point
    read = {}
    samples = []
    rough_on = collections.defaultdict(list)
    rough_off = collections.defaultdict(list)
    for rid, r in by_id.items():
        if rid not in known:
            continue
        pts, codes = r["points"], r["codes"]
        got = []
        for i, p in enumerate(pts):
            code = codes[i] & 0x7FFF
            hit = ix.at(p[0], p[2], NAV_MAX_M)
            got.append((code, hit))
            # the road's own shape, kept per code and per side of the graph, so the fallback
            # can be made to prove itself off-network instead of being assumed
            if 0 < i < len(pts) - 1:
                d2 = 1000.0 * abs(pts[i - 1][1] - 2 * p[1] + pts[i + 1][1])
                (rough_on if (hit and hit["road_type"]) else rough_off)[code].append(d2)
            if hit and hit["road_type"]:
                samples.append((code, hit["road_type"]))
        read[rid] = got

    rt_table, su_table, code_evidence = learn_code_table(samples)
    offnet_ok, offnet_ev = offnet_trust(set(su_table), rough_on, rough_off)

    # ---- pass 2: resolve every point, nav first, learned code second -----
    # road_type is left NULL when only the coarse table fires: a code that cannot separate an
    # a-road from a b-road must not be made to name one.
    def resolve(code, hit):
        if hit and hit["road_type"]:
            return (hit["road_class"], hit["road_type"], hit["road_profile"], hit["offroad"],
                    code, hit["nav_m"], "nav")
        surf = su_table.get(code) if code in offnet_ok else None
        if surf:
            return (surf, rt_table.get(code), None, fh6_nav.OFFROAD_OF.get(surf),
                    code, None, "owt_code")
        return (None, None, None, None, code, None, "none")

    srows = []
    per_route = {}
    for rid, got in read.items():
        mix = collections.Counter()
        n_loose = n_known = 0
        for i, (code, hit) in enumerate(got):
            res = resolve(code, hit)
            if i % 2 == 0:                      # ref_route_point's own index set
                srows.append((rid, i) + res)
            if res[0]:
                mix[res[1] or res[0]] += 1     # the game's own word when we have it
                n_known += 1
                if res[0] == "loose":
                    n_loose += 1
        n = len(got)
        frac = (n_loose / n_known) if n_known else None
        # a route read on a tenth of its length has not been measured; say so rather than
        # extrapolating the tenth over the whole thing
        if not n_known or n_known / n < MIN_KNOWN:
            surf = None
        elif frac >= DOMINANT:
            surf = "loose"
        elif frac <= 1.0 - DOMINANT:
            surf = "paved"
        else:
            surf = "mixed"
        per_route[rid] = (surf, None if frac is None else round(frac, 4),
                          round(n_known / n, 4) if n else 0.0,
                          json.dumps(collections.OrderedDict(
                              (k, round(v / n_known, 4)) for k, v in mix.most_common()))
                          if n_known else None)

    # ---- pass 3: the turns ------------------------------------------------
    # A turn's apex IS one of these centre-line points -- the turn detector found it there --
    # so the surface at the apex is read off the route's own nearest point, not guessed.
    turns = cx.execute("SELECT route_id, turn_id, apex_x, apex_z FROM ref_route_turn").fetchall()
    trows = []
    snap = []
    for rid, tid, ax, az in turns:
        got = read.get(rid)
        r = by_id.get(rid)
        if not got or ax is None or az is None:
            trows.append((None, None, None, None, None, None, rid, tid))
            continue
        best, bd = None, None
        for i, p in enumerate(r["points"]):
            d = (p[0] - ax) ** 2 + (p[2] - az) ** 2
            if bd is None or d < bd:
                best, bd = i, d
        snap.append(bd ** 0.5)
        code, hit = got[best]
        surf, rt, prof, off, _c, navm, src = resolve(code, hit)
        trows.append((surf, rt, prof, off, src if surf else None, navm, rid, tid))

    with cx:
        cx.execute("DELETE FROM ref_route_surface")
        n_s = fh6db.upsert_many(cx, "ref_route_surface", [
            "route_id", "i", "road_class", "road_type", "road_profile", "offroad", "code",
            "nav_m", "src"], srows, chunk=5000)
        cx.executemany("""UPDATE ref_route_turn SET road_class=?, road_type=?, road_profile=?,
                          offroad=?, surface_src=?, surface_m=?
                          WHERE route_id=? AND turn_id=?""", trows)
        cx.executemany("""UPDATE ref_route SET road_class=?, pct_loose=?, road_class_known=?,
                          road_class_mix=? WHERE route_id=?""",
                       [v + (k,) for k, v in per_route.items()])

    labelled = cx.execute(
        "SELECT COUNT(*) FROM ref_route_turn WHERE surface IS NOT NULL").fetchone()[0]
    by_src = dict(cx.execute("SELECT COALESCE(surface_src,'none'), COUNT(*) "
                             "FROM ref_route_turn GROUP BY 1").fetchall())
    by_surf = dict(cx.execute("SELECT COALESCE(surface,'unknown'), COUNT(*) "
                              "FROM ref_route_turn GROUP BY 1").fetchall())
    by_rt = dict(cx.execute("SELECT COALESCE(road_type,'unknown'), COUNT(*) "
                            "FROM ref_route_turn GROUP BY 1").fetchall())
    by_route = dict(cx.execute("SELECT COALESCE(surface,'unknown'), COUNT(*) "
                               "FROM ref_route GROUP BY 1").fetchall())
    snap.sort()
    counts = {"ref_route_surface": n_s, "ref_route_turn": labelled,
              "ref_route": len(per_route)}
    detail = {"turn_surface": by_surf, "turn_road_type": by_rt, "turn_src": by_src,
              "route_surface": by_route,
              "codes_learned": {"road_class": len(su_table), "road_type": len(rt_table),
                                "usable_offnet": len(offnet_ok),
                                "refused_offnet": sorted(
                                    "0x%04X" % c for c in set(su_table) - offnet_ok)},
              "code_evidence": dict(
                  (lvl, dict(sorted((("0x%04X" % k, v) for k, v in ev.items()),
                                    key=lambda kv: -kv[1]["n"])[:14]))
                  for lvl, ev in code_evidence.items()),
              "offnet_evidence": dict(sorted(offnet_ev.items(),
                                             key=lambda kv: -kv[1]["n_off"])[:12]),
              "apex_snap_p50_m": round(snap[len(snap) // 2], 3) if snap else None,
              "apex_snap_p99_m": round(snap[int(len(snap) * 0.99)], 3) if snap else None}
    if verbose:
        print(json.dumps(detail, indent=1))
    return counts, detail


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--db", default=None)
    ap.add_argument("--dir", default=fh6_owt.AITRACKS)
    ap.add_argument("--nav", default=fh6_nav.BRIO_NAV)
    ap.add_argument("-v", "--verbose", action="store_true")
    a = ap.parse_args(argv)
    cx = fh6db.connect(a.db)
    rid = fh6db.run_begin(cx, "road_class", "%s + %s" % (os.path.basename(a.nav), a.dir))
    try:
        counts, detail = run(cx, a.dir, a.nav, a.verbose)
    except Exception as e:                               # noqa: BLE001
        cx.rollback()
        fh6db.run_end(cx, rid, 0, 0, "%s: %s" % (type(e).__name__, e))
        raise
    fh6db.run_end(cx, rid, sum(counts.values()), 1,
                  json.dumps({"counts": counts, "detail": detail}))
    for k in sorted(counts):
        print("  %-20s %8d" % (k, counts[k]))
    print("  turn surface   %s" % detail["turn_surface"])
    print("  turn road_type %s" % detail["turn_road_type"])
    print("  turn source    %s" % detail["turn_src"])
    print("  route surface  %s" % detail["route_surface"])
    print("  codes learned  %s   apex snap p50 %.2f m p99 %.2f m"
          % (detail["codes_learned"], detail["apex_snap_p50_m"], detail["apex_snap_p99_m"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
