#!/usr/bin/env python3
"""canon_routes.py -- collapse the game's duplicate route ids onto one canonical road.

The game catalogues some physical roads twice: a base id (Route311) and a parallel 30xxx id
(Route30004) whose centre-lines are the SAME road to within a metre or two. Our two identity
paths then disagree -- analyze_session._catalogue_key picks one id for a course's route_key,
import_course_match picks the other for course_route.route_id -- and the same road shows up as
several courses under several ids. Before either identity can be trusted, the ids have to be
clustered back onto the single road they describe.

    canonical_map(cx) -> (canon_of, clusters, meta)
      canon_of  {route_id: canonical route_id}      every id, singletons map to themselves
      clusters  [set(route_id, ...)]                 only the multi-member roads
      meta      {route_id: {name, is_loop, length_m, laps hints ...}}

Two ref_routes are the SAME road when each covers >= CANON_COV of the other's centre-line
(fh6_owt.compare, both directions) -- the same mutual-overlap test import_course_match uses to
decide a course drove a whole route, applied route-to-route. A one-directional test is not
enough: routes legitimately share stretches of highway.

The canonical id inside a cluster is the one the GAME'S OWN CATALOGUE treats as the road's
identity, never a numeric guess: a Rivals binding first, then a start sphere (is_race), then a
game:trackinfo name, then -- only to break a tie the catalogue cannot -- the non-30xxx id, then
the lowest id. This is the project's hard identity rule (course -> route id -> ref_track_info ->
name) applied to the routes themselves, so a merge inherits the catalogued name, not the twin's.

Pure geometry + catalogue: reads ref_route / ref_route_point / ref_track_info / route_anchor /
v_rivals_route, never our lap data, so the map is a property of the game and is the same whatever
we have driven.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "scripts", "telemetry"))

import fh6_owt                                            # noqa: E402

CANON_COV = 0.90        # each route must cover >= this fraction of the other to be the same road
BBOX_MIN = 0.5          # cheap reject: bounding boxes must overlap at least this much both ways
LEN_LO, LEN_HI = 0.75, 1.334   # and lengths be within a third, before the expensive compare


def _bbox_overlap(a, b):
    ax0, ax1, az0, az1 = a
    bx0, bx1, bz0, bz1 = b
    ix = max(0.0, min(ax1, bx1) - max(ax0, bx0))
    iz = max(0.0, min(az1, bz1) - max(az0, bz0))
    area = max(1.0, (ax1 - ax0) * (az1 - az0))
    return (ix * iz) / area


def route_geometry(cx):
    """{route_id: {name, length_m, is_loop, bbox, pts}} for every ref_route with >= 12 points."""
    routes = {}
    for r in cx.execute("SELECT route_id, name, length_m, is_loop, "
                        "bbox_x0, bbox_x1, bbox_z0, bbox_z1 FROM ref_route"):
        routes[r["route_id"]] = {
            "id": r["route_id"], "name": r["name"], "length_m": r["length_m"] or 0.0,
            "is_loop": r["is_loop"],
            "bbox": [r["bbox_x0"], r["bbox_x1"], r["bbox_z0"], r["bbox_z1"]], "pts": []}
    for p in cx.execute("SELECT route_id, x, y, z FROM ref_route_point ORDER BY route_id, i"):
        r = routes.get(p["route_id"])
        if r is not None:
            r["pts"].append((p["x"], p["y"], p["z"]))
    return {rid: r for rid, r in routes.items() if len(r["pts"]) >= 12}


def catalogue_signals(cx):
    """{route_id: {rivals, is_race, in_trackinfo, name, name_source}} -- the game's identity evidence."""
    sig = {}

    def slot(rid):
        return sig.setdefault(str(rid), {"rivals": False, "is_race": False,
                                         "in_trackinfo": False, "name": None, "name_source": None})

    for r in cx.execute("SELECT route_id, name, name_source, is_race FROM ref_route"):
        s = slot(r["route_id"])
        s["name"], s["name_source"], s["is_race"] = r["name"], r["name_source"], bool(r["is_race"])
    if fh6_owt and _has(cx, "ref_track_info"):
        for (rid,) in cx.execute("SELECT route_id FROM ref_track_info"):
            slot(rid)["in_trackinfo"] = True
    if _has(cx, "v_rivals_route"):
        for (rid,) in cx.execute("SELECT DISTINCT route_id FROM v_rivals_route"):
            slot(rid)["rivals"] = True
    return sig


def _has(cx, name):
    return cx.execute("SELECT 1 FROM sqlite_master WHERE type IN ('table','view') AND name=?",
                      (name,)).fetchone() is not None


def _canon_score(rid, sig):
    """Higher is more canonical. Catalogue evidence first; numeric tie-breaks only at the end."""
    s = sig.get(str(rid), {})
    is30 = str(rid).startswith("30")
    try:
        numeric = int(rid)
    except (TypeError, ValueError):
        numeric = 10 ** 12
    return (
        1 if s.get("rivals") else 0,
        1 if s.get("is_race") else 0,
        1 if (s.get("name_source") or "").startswith("game:") else 0,
        1 if s.get("in_trackinfo") else 0,
        1 if s.get("name") else 0,
        0 if is30 else 1,        # a real base id beats its 30xxx twin
        -numeric,                # then the lowest id, deterministically
    )


def clusters(cx, geom=None, cov=CANON_COV):
    """[set(route_id, ...)] of ref_routes that trace the same physical road (mutual coverage >= cov)."""
    geom = geom if geom is not None else route_geometry(cx)
    ids = list(geom)
    parent = {rid: rid for rid in ids}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for i in range(len(ids)):
        A = geom[ids[i]]
        for j in range(i + 1, len(ids)):
            B = geom[ids[j]]
            if _bbox_overlap(A["bbox"], B["bbox"]) < BBOX_MIN or _bbox_overlap(B["bbox"], A["bbox"]) < BBOX_MIN:
                continue
            la, lb = A["length_m"], B["length_m"]
            if not (la and lb) or not (LEN_LO <= la / lb <= LEN_HI):
                continue
            ab = fh6_owt.compare([(p[0], p[2]) for p in A["pts"]], B["pts"])
            ba = fh6_owt.compare([(p[0], p[2]) for p in B["pts"]], A["pts"])
            if ab and ba and ab["covered"] >= cov and ba["covered"] >= cov:
                parent[find(ids[i])] = find(ids[j])

    groups = {}
    for rid in ids:
        groups.setdefault(find(rid), set()).add(rid)
    return [g for g in groups.values() if len(g) > 1]


def canonical_map(cx, cov=CANON_COV):
    """(canon_of, clusters, meta). canon_of maps EVERY route id to its canonical id."""
    geom = route_geometry(cx)
    sig = catalogue_signals(cx)
    cls = clusters(cx, geom=geom, cov=cov)
    canon_of = {rid: rid for rid in geom}
    for group in cls:
        best = max(group, key=lambda rid: _canon_score(rid, sig))
        for rid in group:
            canon_of[rid] = best
    meta = {rid: {"name": geom[rid]["name"], "is_loop": geom[rid]["is_loop"],
                  "length_m": geom[rid]["length_m"],
                  "canonical": canon_of[rid]} for rid in geom}
    return canon_of, cls, meta


def main(argv=None):
    import argparse
    sys.path.insert(0, HERE)
    import fh6db                                          # noqa: E402
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--db", default=None)
    a = ap.parse_args(argv)
    cx = fh6db.connect(a.db, ro=True)
    canon_of, cls, meta = canonical_map(cx)
    sig = catalogue_signals(cx)
    print("%d routes, %d canonical roads (%d multi-id)" % (
        len(canon_of), len(set(canon_of.values())), len(cls)))
    for group in sorted(cls, key=lambda g: -len(g)):
        can = max(group, key=lambda rid: _canon_score(rid, sig))
        print("  %-8s <- %s  (%s)" % (
            can, ", ".join(sorted(group)), meta[can]["name"] or "unnamed"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
