#!/usr/bin/env python3
"""import_route_names.py -- derive course and ref_route names from map identity + catalogue length.

DB-only: no game files, no course models. Every input is already a column (course, course_route,
ref_route, ref_event); this stage is pure recomputation over them, so it resets its own outputs
first and rebuilds them from scratch every run -- idempotent, deterministic.

FOUR TIERS, in precedence order declared > game > map > length:

  game     (2026-09-05) cr.match_kind IN ('verified','probable') identifies a game route R, and the
           game's own catalogue (ref_track_info, stage objectmodel) names R -- the name is the
           game's, not derived: course.name_source 'derived:game', confidence verified, and
           ref_route.name for EVERY route the catalogue names ('game:trackinfo'), driven or not.
           A 'probable' whose runner_up is the catalogued twin of an uncatalogued route_id (6001
           vs its mirror 30006) takes the catalogued one. No length test: the catalogue is the
           authority on WHICH name, the map on WHERE; a length disagreement is reported, not vetoed.
  map      cr.match_kind IN ('verified','probable') identifies a game route R. R and a Rivals
           catalogue event agree in length (both against R's own length AND the driven course's
           length) -> the map itself names the course, and the route too (ref_route.name).
  length   no map identity (cr missing/partial/none) and the course's path closes (start ~= end,
           < LOOP_GAP_M apart) -> its length alone can match a *Circuit* event, PROVIDED the match
           is bijective: no other length-tier course claims the same event. Never names ref_route
           -- a length match is evidence about the course, not proof of which physical route it is.
  declared what data/routes.json (or the course model) said a person typed. Read confidence, not
           derived: it is not cross-checked against the map, only recorded. THE TYPED WORD IS THE
           FINAL WORD: when it disagrees with a map- or length-derived name, the typed name is what
           course.name shows and the derivation stays a chosen=0 course_event row, reported in the
           run notes as declared_overrides. The map keeps its authority over WHERE (course_route),
           never over what a person called the place.

Every candidate considered becomes a course_event row, chosen=1 marking whichever one actually
named the course -- an ambiguity or a conflict is a row, never a silent guess.

Run:  python scripts/db/import_route_names.py [--db PATH] [-v]
"""
import argparse
import json
import math
import os
import sys
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)

import fh6db                                            # noqa: E402

MI = 1609.344
BAND_M = 0.05 * MI            # 80.47 -- half a display step; the Rivals screen rounds to 0.1 mi
LOOP_GAP_M = 60                # fh6_owt's own is_loop rule, reused for a driven course's closure

CONF_RANK = {"verified": 0, "derived": 1, "read": 2}


def _dist(p0, p1):
    return math.hypot(p1[0] - p0[0], p1[1] - p0[1])


# SURFACE IS A KEY, NOT A FILTER. ref_route.road_class is the route's place in the free-roam road
# network (paved = on it, loose = off it, mixed = both), never a material. A Road/Street/Drag event
# runs on the network; a Dirt/Cross Country event leaves it. Loading the Dirt catalogue (2026-09-05)
# put Chiheisen Scramble and Hokubu Circuit, both 1.6 mi, on the same courses -- the route's
# class was already the answer: 101 is paved, 201 is half off-network.
_ON_NETWORK = {"road", "street", "drag"}
_OFF_NETWORK = {"dirt", "cross-country"}


def _surface_ok(discipline, road_class):
    if road_class is None or discipline is None:
        return True
    if discipline in _ON_NETWORK:
        return road_class == "paved"
    if discipline in _OFF_NETWORK:
        return road_class in ("mixed", "loose")
    return True


def _closure_gap(geometry_json):
    """Distance between the first and last geometry.path point; None on < 2 points."""
    if not geometry_json:
        return None
    try:
        geo = json.loads(geometry_json)
    except (ValueError, TypeError):
        return None
    path = geo.get("path")
    if not path or len(path) < 2:
        return None
    try:
        return _dist(path[0], path[-1])
    except (TypeError, IndexError):
        return None


def run(cx, verbose=False):
    now = fh6db.utcnow()

    with cx:
        cx.execute("DELETE FROM course_event")
        cx.execute("UPDATE course SET name=NULL, name_source=NULL, name_confidence=NULL, "
                   "event_id=NULL WHERE route_key NOT LIKE 'loop:%'")
        cx.execute("UPDATE ref_route SET name=NULL, event_id=NULL, name_source=NULL, "
                   "name_confidence=NULL")

    # ---- inputs, loaded once -------------------------------------------------
    events = [dict(r) for r in cx.execute(
        "SELECT event_id, name, length_m, is_loop, discipline, route_id FROM ref_event "
        "WHERE kind='rivals' AND length_m IS NOT NULL")]
    events_by_id = {e["event_id"]: e for e in events}

    # the declared tier searches ANY kind, ANY length -- a wider net than the map/length tiers
    all_events = {r["event_id"]: dict(r) for r in cx.execute(
        "SELECT event_id, name, length_m, is_loop FROM ref_event")}
    # a name that both a Rivals event and a career race carry resolves to the Rivals one; career
    # races that share a name with each other (47 names do) all stay listed, so the declared tier's
    # "exactly one event" test still sees the ambiguity (review, 2026-09-05)
    name_index = defaultdict(list)
    for eid, e in sorted(all_events.items(), key=lambda t: (0 if t[0].startswith("rivals:") else 1, t[0])):
        if e["name"] is None:
            continue
        if eid.startswith("career:") and any(x.startswith("rivals:") for x in name_index[e["name"]]):
            continue
        name_index[e["name"]].append(eid)

    routes = {r["route_id"]: dict(r) for r in cx.execute(
        "SELECT route_id, length_m, is_loop, road_class, bbox_x0, bbox_x1, bbox_z0, bbox_z1 FROM ref_route")}
    course_routes = {r["route_key"]: dict(r) for r in cx.execute(
        "SELECT route_key, route_id, match_kind, runner_up FROM course_route")}

    # ---- the game's catalogue: route_id -> (name, event_id) ------------------------------
    # One TrackInfo row per route, chosen when the game lists two for one id (2091 carries both
    # 'Shikisai Sprint' and the carried-over 'Panoramica Sprint'): the row a Rivals event reaches,
    # else the row a career race reaches, else the lowest key.
    game_routes = {}
    if fh6db.has_table(cx, "ref_track_info"):
        rivals_of = {}
        for r in cx.execute("SELECT name, track_key FROM v_rivals_route"):
            rivals_of.setdefault(r["track_key"], set()).add(r["name"])
        raced = {r[0] for r in cx.execute("SELECT DISTINCT track_key FROM ref_career_race")}
        ev_by_name = defaultdict(list)
        for r in cx.execute("SELECT event_id, name, kind FROM ref_event WHERE route_id IS NOT NULL"):
            ev_by_name[r["name"]].append((0 if r["kind"] == "rivals" else 1, r["event_id"]))
        cand = defaultdict(list)
        for r in cx.execute("SELECT track_key, route_id, display_name FROM ref_track_info WHERE route_id IS NOT NULL"):
            rank = (0 if r["track_key"] in rivals_of else (1 if r["track_key"] in raced else 2), r["track_key"])
            cand[r["route_id"]].append((rank, r["display_name"], r["track_key"]))
        for rid, lst in cand.items():
            lst.sort()
            _rank, name, tk = lst[0]
            evs = sorted(ev_by_name.get(name, []))
            game_routes[rid] = {"name": name, "track_key": tk, "event_id": evs[0][1] if evs else None,
                                "alternates": [x[1] for x in lst[1:]]}
    courses = [dict(r) for r in cx.execute(
        "SELECT route_key, length_m, declared_name, geometry FROM course "
        "WHERE route_key NOT LIKE 'loop:%'")]

    used_pairs = defaultdict(set)          # route_key -> {event_id} already given a course_event row

    # ---- pass 0: game tier -- the catalogue names the identified route -----------------
    rows_game = []
    chosen_game = {}                       # route_key -> (event_id, name, source, confidence)
    game_route_of = {}                     # route_key -> the route_id the game name came from
    for c in courses:
        rk = c["route_key"]
        cr = course_routes.get(rk)
        if not (cr and cr["match_kind"] in ("verified", "probable")):
            continue
        pick = None
        if cr["route_id"] in game_routes:
            pick = cr["route_id"]
        elif cr["match_kind"] == "probable" and cr.get("runner_up") in game_routes:
            pick = cr["runner_up"]           # the catalogued twin of an uncatalogued mirror
        if pick is None:
            continue
        g = game_routes[pick]
        R = routes.get(pick) or {}
        ev = all_events.get(g["event_id"]) if g["event_id"] else None
        L_c = c["length_m"]
        d_route_m = (R.get("length_m") - ev["length_m"]) if (ev and ev["length_m"] is not None and R.get("length_m") is not None) else None
        d_course_m = (L_c - ev["length_m"]) if (ev and ev["length_m"] is not None and L_c is not None) else None
        D = c["declared_name"]
        declared_ok = None if D is None else (1 if D == g["name"] else 0)
        if g["event_id"]:
            rows_game.append((rk, g["event_id"], "game", pick, d_route_m, d_course_m, None, None,
                              declared_ok, 0, now))
            used_pairs[rk].add(g["event_id"])
        # A catalogued route no event reaches (IE Drive sections, cut content) still names the
        # course -- the game's word for that road is the point -- with event_id NULL and, since
        # course_event is keyed by event, no evidence row; --check I5 allows 'derived:game' that way.
        chosen_game[rk] = (g["event_id"], g["name"], "derived:game", "verified")
        game_route_of[rk] = pick

    # two routes' bounding boxes touch (300 m slack): they are the same stretch of road -- a
    # catalogued twin/mirror, not two places. Used to keep the map tier from borrowing a name
    # off a same-length event that lives elsewhere on the island.
    def _overlap(a, b):
        A, B = routes[a], routes[b]
        if None in (A["bbox_x0"], B["bbox_x0"]):
            return False
        return not (A["bbox_x1"] < B["bbox_x0"] - 300 or B["bbox_x1"] < A["bbox_x0"] - 300
                    or A["bbox_z1"] < B["bbox_z0"] - 300 or B["bbox_z1"] < A["bbox_z0"] - 300)

    # ---- pass 1: map tier (full) + length tier candidates --------------------
    rows_map, rows_length = [], []
    chosen_map = {}                        # route_key -> (event_id, name, source, confidence)
    map_route_id = {}                      # route_key -> route_id, for ref_route naming later
    candidate_len = {}                     # route_key -> single B2 event_id (bijection pending)
    L_c_of, D_of, cr_of = {}, {}, {}

    for c in courses:
        rk = c["route_key"]
        L_c, D = c["length_m"], c["declared_name"]
        L_c_of[rk], D_of[rk] = L_c, D
        cr = course_routes.get(rk)
        cr_of[rk] = cr

        if cr and cr["match_kind"] in ("verified", "probable") and cr["route_id"] in routes:
            route_id = cr["route_id"]
            R = routes[route_id]
            Rlen, Rloop, Rroad = R["length_m"], R["is_loop"], R["road_class"]
            candidates = {}
            A_ids, B_ids = set(), set()
            for e in events:
                # route_id guard: the events are route-bound, so a length match to an event whose
                # own route lies elsewhere (route 162 Bamboo Forest Scramble, ~4.99 km, 5.5 km from
                # route 1311 Legend Island XC, ~4.92 km) is a same-length coincidence, not this
                # course's name. Borrow a name only from this route or a twin sharing its ground.
                er = e["route_id"]
                if er is not None and er != route_id and er in routes and not _overlap(er, route_id):
                    continue
                in_A = (Rlen is not None and abs(Rlen - e["length_m"]) <= BAND_M
                        and (e["is_loop"] is None or e["is_loop"] == Rloop)
                        and _surface_ok(e["discipline"], Rroad))
                in_B = (L_c is not None and abs(L_c - e["length_m"]) <= BAND_M)
                if in_A:
                    A_ids.add(e["event_id"])
                if in_B:
                    B_ids.add(e["event_id"])
                if in_A or in_B:
                    candidates[e["event_id"]] = e
            for eid, e in candidates.items():
                if eid in used_pairs[rk]:
                    continue               # the game tier already holds this pair's row (PK is route_key, event_id)
                d_route_m = (Rlen - e["length_m"]) if Rlen is not None else None
                d_course_m = (L_c - e["length_m"]) if L_c is not None else None
                loop_ok = (None if (e["is_loop"] is None or Rloop is None)
                           else (1 if e["is_loop"] == Rloop else 0))
                road_ok = None if Rroad is None else (1 if _surface_ok(e["discipline"], Rroad) else 0)
                declared_ok = None if D is None else (1 if D == e["name"] else 0)
                rows_map.append((rk, eid, "map", route_id, d_route_m, d_course_m,
                                  loop_ok, road_ok, declared_ok, 0, now))
                used_pairs[rk].add(eid)
            map_route_id[rk] = route_id

            C_ids = A_ids & B_ids
            if len(C_ids) == 1:
                eid = next(iter(C_ids))
                chosen_map[rk] = (eid, candidates[eid]["name"], "derived:map", "verified")
            elif len(C_ids) > 1:
                matches = [eid for eid in C_ids if D is not None and candidates[eid]["name"] == D]
                if matches:
                    eid = matches[0]
                    chosen_map[rk] = (eid, candidates[eid]["name"], "derived:map+declared", "derived")
            continue                       # map-eligible courses never reach the length tier

        g = _closure_gap(c["geometry"])
        if g is not None and g < LOOP_GAP_M:
            B2 = [e for e in events
                  if L_c is not None and abs(L_c - e["length_m"]) <= BAND_M and e["is_loop"] == 1]
            for e in B2:
                if e["event_id"] in used_pairs[rk]:
                    continue
                d_course_m = (L_c - e["length_m"]) if L_c is not None else None
                declared_ok = None if D is None else (1 if D == e["name"] else 0)
                rows_length.append((rk, e["event_id"], "length", None, None, d_course_m,
                                     1, None, declared_ok, 0, now))
                used_pairs[rk].add(e["event_id"])
            if len(B2) == 1:
                candidate_len[rk] = B2[0]["event_id"]

    # ---- pass 1.25: ONE EVENT, ONE PLACE (map tier, global) --------------------
    # Hokubu Circuit (1.6 mi) fits route 201 and route 101 by length, and a course on each fit it
    # by lap length too -- so both came out 'verified' 5 km apart (2026-09-05). A Rivals route is
    # one stretch of road: an event claimed by courses on routes whose boxes do not overlap is a
    # tie, settled only by the typed name, otherwise left as chosen=0 rows for the picker.
    # (_overlap is defined above pass 1, where the map tier's route_id guard first uses it.)
    claims = defaultdict(list)             # event_id -> [route_key]
    for rk, (eid, _n, _s, _c) in chosen_map.items():
        claims[eid].append(rk)
    event_claims = []
    for eid, rks in claims.items():
        rids = sorted({map_route_id[rk] for rk in rks})
        if len(rids) < 2:
            continue
        # cluster the routes by box overlap; twins (30001~101) are one place
        clusters = []
        for rid in rids:
            for cl in clusters:
                if any(_overlap(rid, o) for o in cl):
                    cl.append(rid); break
            else:
                clusters.append([rid])
        if len(clusters) < 2:
            continue
        keep = [rk for rk in rks if D_of[rk] is not None and D_of[rk] == events_by_id[eid]["name"]]
        if len(keep) == 1:
            for rk in rks:
                if rk != keep[0]:
                    chosen_map.pop(rk, None)
            chosen_map[keep[0]] = (eid, events_by_id[eid]["name"], "derived:map+declared", "derived")
        else:
            for rk in rks:
                chosen_map.pop(rk, None)
        event_claims.append({"event_id": eid, "route_keys": sorted(rks), "route_ids": rids,
                             "settled_by_declared": keep[0] if len(keep) == 1 else None})

    # ---- pass 1.5: length tier bijection (global across all courses) --------
    counts = Counter(candidate_len.values())
    chosen_length = {}
    for rk, eid in candidate_len.items():
        if counts[eid] == 1:
            e = events_by_id[eid]
            src = "derived:length+declared" if (D_of[rk] is not None and e["name"] == D_of[rk]) \
                else "derived:length"
            chosen_length[rk] = (eid, e["name"], src, "derived")

    # ---- pass 1.75: game over map -- and record where the derivation disagreed --------------
    game_vs_map = []
    for rk, g in chosen_game.items():
        m = chosen_map.get(rk) or chosen_length.get(rk)
        if m and m[1] != g[1]:
            game_vs_map.append({"route_key": rk, "game": g[1], "derived": m[1], "via": m[2]})

    # ---- pass 2: declared tier + final precedence ----------------------------
    rows_declared = []
    final = {}                             # route_key -> (event_id, name, source, confidence) | None
    overridden = []

    for c in courses:
        rk = c["route_key"]
        D = D_of[rk]
        chosen = chosen_game.get(rk) or chosen_map.get(rk) or chosen_length.get(rk)

        if D is not None:
            m = name_index.get(D, [])
            ev_d = m[0] if len(m) == 1 else None
            if ev_d is not None and ev_d not in used_pairs[rk]:
                ev = all_events[ev_d]
                cr = cr_of[rk]
                route_id = cr["route_id"] if (cr and cr["match_kind"] in ("verified", "probable")) else None
                R = routes.get(route_id) if route_id else None
                L_c = L_c_of[rk]
                d_route_m = (R["length_m"] - ev["length_m"]) \
                    if (R and R["length_m"] is not None and ev["length_m"] is not None) else None
                d_course_m = (L_c - ev["length_m"]) \
                    if (L_c is not None and ev["length_m"] is not None) else None
                loop_ok = (None if not (R and R["is_loop"] is not None and ev["is_loop"] is not None)
                           else (1 if R["is_loop"] == ev["is_loop"] else 0))
                road_ok = None if not (R and R["road_class"] is not None) \
                    else (0 if R["road_class"] == "loose" else 1)
                rows_declared.append((rk, ev_d, "declared", route_id, d_route_m, d_course_m,
                                       loop_ok, road_ok, 1, 0, now))
                used_pairs[rk].add(ev_d)

            if chosen is None:
                final[rk] = (ev_d, D, "declared", "read")
            elif chosen[1] != D:
                # The typed word is the final word (schema COURSE NAMES block): a map or length
                # derivation that disagrees is kept as its course_event row, chosen=0, and reported --
                # never written over what a person typed. The map keeps its WHERE authority
                # (course_route, course.event_id stays the declared event), not the NAME.
                overridden.append({"route_key": rk, "declared": D, "derived": chosen[1], "via": chosen[2]})
                final[rk] = (ev_d, D, "declared", "read")
            else:
                final[rk] = chosen         # names already agree (the '+declared' tiers)
        else:
            final[rk] = chosen

    # ---- write ----------------------------------------------------------------
    with cx:
        n_ce = 0
        for rows in (rows_game, rows_map, rows_length, rows_declared):
            if rows:
                cx.executemany(
                    "INSERT INTO course_event (route_key, event_id, tier, route_id, d_route_m, "
                    "d_course_m, loop_ok, road_ok, declared_ok, chosen, computed_utc) "
                    "VALUES (?,?,?,?,?,?,?,?,?,?,?)", rows)
                n_ce += len(rows)

        n_named = 0
        for rk, info in final.items():
            if info is None:
                continue
            eid, name, source, confidence = info
            cx.execute("UPDATE course SET name=?, name_source=?, name_confidence=?, event_id=? "
                       "WHERE route_key=?", (name, source, confidence, eid, rk))
            n_named += 1
            if eid is not None:
                cx.execute("UPDATE course_event SET chosen=1 WHERE route_key=? AND event_id=?",
                           (rk, eid))

        # 'loop:' courses: always the declared name, verbatim, read confidence -- never derived
        n_loop = 0
        for r in cx.execute("SELECT route_key, declared_name FROM course WHERE route_key LIKE 'loop:%'"):
            cx.execute("UPDATE course SET name=?, name_source='declared', name_confidence='read', "
                       "event_id=NULL WHERE route_key=?", (r["declared_name"], r["route_key"]))
            n_loop += 1

        # ref_route naming, tier game first: every route the catalogue names, driven or not.
        n_route_game = 0
        for rid, g in game_routes.items():
            if rid in routes:
                cx.execute("UPDATE ref_route SET name=?, event_id=?, name_source='game:trackinfo', "
                           "name_confidence='verified' WHERE route_id=?", (g["name"], g["event_id"], rid))
                n_route_game += 1
                # the catalogue names the route; its own length against the event's is the one
                # cross-check that needs no driven course (circuits carry a grid lead-in, sprints
                # up to ~0.9 km of it, so only a gross disagreement is worth a line)
                ev = all_events.get(g["event_id"]) if g["event_id"] else None
                Rlen = routes[rid]["length_m"]
                if ev and ev["length_m"] and Rlen:
                    ratio = Rlen / ev["length_m"]
                    if not (0.8 <= ratio <= 1.35):
                        game_vs_map.append({"route_id": rid, "game": g["name"], "route_len_m": round(Rlen),
                                            "event_len_m": round(ev["length_m"]), "ratio": round(ratio, 3)})
        # the road the course actually drove, when the game name came through its catalogued twin
        # (probable + runner_up): the uncatalogued mirror carries the same name, 'derived:game', so
        # the world map does not show the driven line nameless beside its named twin. Two courses
        # proposing different names for one mirror is a conflict, reported, not a guess.
        conflicts = []
        twin_props = defaultdict(set)
        for rk, (eid, name, _src, _conf) in chosen_game.items():
            cr = course_routes.get(rk)
            rid = cr["route_id"] if cr else None
            if rid and rid in routes and rid not in game_routes and rid != game_route_of.get(rk):
                twin_props[rid].add((name, eid))
        for rid, props in twin_props.items():
            if len({p[0] for p in props}) == 1:
                name, eid = sorted(props)[0]
                cx.execute("UPDATE ref_route SET name=?, event_id=?, name_source='derived:game', "
                           "name_confidence='verified' WHERE route_id=?", (name, eid, rid))
                n_route_game += 1
            else:
                conflicts.append({"route_id": rid, "names": sorted(p[0] for p in props), "via": "twin"})

        # then the derived proposals: only from courses whose FINAL name came from the map tier.
        # Two courses proposing different names for the same route_id is a conflict, not a guess;
        # a proposal for a route the game already names is a cross-check, recorded when it differs.
        proposals = defaultdict(list)
        for rk, info in final.items():
            if info is not None and info[2].startswith("derived:map"):
                proposals[map_route_id[rk]].append((info[1], info[2], info[3], rk, info[0]))

        n_route_named = 0
        for route_id, props in proposals.items():
            names = {p[0] for p in props}
            if route_id in game_routes:
                gname = game_routes[route_id]["name"]
                if names != {gname}:
                    game_vs_map.append({"route_id": route_id, "game": gname, "derived": sorted(names),
                                        "route_keys": sorted(p[3] for p in props)})
                continue
            if len(names) == 1:
                name, source, confidence, rk, eid = sorted(
                    props, key=lambda p: (CONF_RANK.get(p[2], 9), p[3]))[0]
                cx.execute("UPDATE ref_route SET name=?, event_id=?, name_source=?, "
                           "name_confidence=? WHERE route_id=?", (name, eid, source, confidence, route_id))
                n_route_named += 1
            else:
                conflicts.append({"route_id": route_id, "route_keys": sorted(p[3] for p in props),
                                   "names": sorted(names)})

        # ties: >=2 candidates considered, none chosen, course still unnamed (I10)
        ties = list(cx.execute(
            "SELECT ce.route_key, COUNT(*) AS n FROM course_event ce "
            "JOIN course c ON c.route_key = ce.route_key "
            "WHERE ce.chosen = 0 AND c.name IS NULL "
            "GROUP BY ce.route_key HAVING COUNT(*) >= 2"))
        ambiguous = [r["route_key"] for r in ties]

        n_course = len(courses)
        by_conf = Counter(info[3] for info in final.values() if info is not None)
        n_route_total = cx.execute("SELECT COUNT(*) FROM ref_route").fetchone()[0]

    counts_out = {
        "course_event": n_ce, "course_named": n_named, "course_total": n_course,
        "loop_named": n_loop, "ref_route_named": n_route_named, "ref_route_total": n_route_total,
        "verified": by_conf.get("verified", 0), "derived": by_conf.get("derived", 0),
        "declared": by_conf.get("read", 0),
        "ties": len(ambiguous), "conflicts": len(conflicts),
        "ambiguous_route_keys": ambiguous, "conflicting_routes": conflicts,
        "declared_overrides": sorted(overridden, key=lambda o: o["route_key"]),
        "event_claims": sorted(event_claims, key=lambda o: o["event_id"]),
        "game": len(chosen_game), "ref_route_game_named": n_route_game,
        "game_vs_map": game_vs_map,
    }
    if verbose:
        for o in overridden:
            print("  declared_overrides: %s keeps typed '%s' over %s '%s' (stored as a candidate, chosen=0)"
                  % (o["route_key"], o["declared"], o["via"], o["derived"]))
        for cf in conflicts:
            print("  conflict: ref_route %s named differently by %s (%s)"
                  % (cf["route_id"], cf["route_keys"], cf["names"]))
    return counts_out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--db", default=None)
    ap.add_argument("-v", "--verbose", action="store_true")
    a = ap.parse_args(argv)
    cx = fh6db.connect(a.db)
    fh6db.migrate(cx)
    rid = fh6db.run_begin(cx, "route_names", "course + course_route + ref_event (DB only)")
    try:
        c = run(cx, a.verbose)
    except Exception as e:                               # noqa: BLE001
        cx.rollback()
        fh6db.run_end(cx, rid, 0, 0, "%s: %s" % (type(e).__name__, e))
        raise
    fh6db.run_end(cx, rid, c["course_event"], 1, json.dumps(c))
    print("names: course %d/%d (game %d, verified %d, derived %d, declared %d)  ref_route %d/%d "
          "(game %d, derived %d)  ties %d  conflicts %d  game_vs_map %d"
          % (c["course_named"], c["course_total"], c["game"], c["verified"], c["derived"], c["declared"],
             c["ref_route_game_named"] + c["ref_route_named"], c["ref_route_total"],
             c["ref_route_game_named"], c["ref_route_named"], c["ties"], c["conflicts"], len(c["game_vs_map"])))
    return 0


if __name__ == "__main__":
    sys.exit(main())
