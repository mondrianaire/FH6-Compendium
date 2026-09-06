#!/usr/bin/env python3
"""import_route_names.py -- derive course and ref_route names from map identity + catalogue length.

DB-only: no game files, no course models. Every input is already a column (course, course_route,
ref_route, ref_event); this stage is pure recomputation over them, so it resets its own outputs
first and rebuilds them from scratch every run -- idempotent, deterministic.

THREE TIERS, in precedence order map > declared > length:

  map      cr.match_kind IN ('verified','probable') identifies a game route R. R and a Rivals
           catalogue event agree in length (both against R's own length AND the driven course's
           length) -> the map itself names the course, and the route too (ref_route.name).
  length   no map identity (cr missing/partial/none) and the course's path closes (start ~= end,
           < LOOP_GAP_M apart) -> its length alone can match a *Circuit* event, PROVIDED the match
           is bijective: no other length-tier course claims the same event. Never names ref_route
           -- a length match is evidence about the course, not proof of which physical route it is.
  declared what data/routes.json (or the course model) said a person typed. Read confidence, not
           derived: it is not cross-checked against the map, only recorded and, when it disagrees
           with an already-chosen name, either overridden (map wins) or overriding (beats length).

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
        "SELECT event_id, name, length_m, is_loop FROM ref_event "
        "WHERE kind='rivals' AND length_m IS NOT NULL")]
    events_by_id = {e["event_id"]: e for e in events}

    # the declared tier searches ANY kind, ANY length -- a wider net than the map/length tiers
    all_events = {r["event_id"]: dict(r) for r in cx.execute(
        "SELECT event_id, name, length_m, is_loop FROM ref_event")}
    name_index = defaultdict(list)
    for eid, e in all_events.items():
        if e["name"] is not None:
            name_index[e["name"]].append(eid)

    routes = {r["route_id"]: dict(r) for r in cx.execute(
        "SELECT route_id, length_m, is_loop, road_class FROM ref_route")}
    course_routes = {r["route_key"]: dict(r) for r in cx.execute(
        "SELECT route_key, route_id, match_kind FROM course_route")}
    courses = [dict(r) for r in cx.execute(
        "SELECT route_key, length_m, declared_name, geometry FROM course "
        "WHERE route_key NOT LIKE 'loop:%'")]

    # ---- pass 1: map tier (full) + length tier candidates --------------------
    rows_map, rows_length = [], []
    chosen_map = {}                        # route_key -> (event_id, name, source, confidence)
    map_route_id = {}                      # route_key -> route_id, for ref_route naming later
    candidate_len = {}                     # route_key -> single B2 event_id (bijection pending)
    used_pairs = defaultdict(set)          # route_key -> {event_id} already inserted
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
                in_A = (Rlen is not None and abs(Rlen - e["length_m"]) <= BAND_M
                        and (e["is_loop"] is None or e["is_loop"] == Rloop)
                        and (Rroad is None or Rroad != "loose"))
                in_B = (L_c is not None and abs(L_c - e["length_m"]) <= BAND_M)
                if in_A:
                    A_ids.add(e["event_id"])
                if in_B:
                    B_ids.add(e["event_id"])
                if in_A or in_B:
                    candidates[e["event_id"]] = e
            for eid, e in candidates.items():
                d_route_m = (Rlen - e["length_m"]) if Rlen is not None else None
                d_course_m = (L_c - e["length_m"]) if L_c is not None else None
                loop_ok = (None if (e["is_loop"] is None or Rloop is None)
                           else (1 if e["is_loop"] == Rloop else 0))
                road_ok = None if Rroad is None else (0 if Rroad == "loose" else 1)
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
                d_course_m = (L_c - e["length_m"]) if L_c is not None else None
                declared_ok = None if D is None else (1 if D == e["name"] else 0)
                rows_length.append((rk, e["event_id"], "length", None, None, d_course_m,
                                     1, None, declared_ok, 0, now))
                used_pairs[rk].add(e["event_id"])
            if len(B2) == 1:
                candidate_len[rk] = B2[0]["event_id"]

    # ---- pass 1.5: length tier bijection (global across all courses) --------
    counts = Counter(candidate_len.values())
    chosen_length = {}
    for rk, eid in candidate_len.items():
        if counts[eid] == 1:
            e = events_by_id[eid]
            src = "derived:length+declared" if (D_of[rk] is not None and e["name"] == D_of[rk]) \
                else "derived:length"
            chosen_length[rk] = (eid, e["name"], src, "derived")

    # ---- pass 2: declared tier + final precedence ----------------------------
    rows_declared = []
    final = {}                             # route_key -> (event_id, name, source, confidence) | None
    overridden = []

    for c in courses:
        rk = c["route_key"]
        D = D_of[rk]
        chosen = chosen_map.get(rk) or chosen_length.get(rk)

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
                if chosen[2].startswith("derived:map"):
                    overridden.append(rk)
                    final[rk] = chosen
                else:                       # length tier: declared wins, length row stays chosen=0
                    final[rk] = (ev_d, D, "declared", "read")
            else:
                final[rk] = chosen         # names already agree (the '+declared' tiers)
        else:
            final[rk] = chosen

    # ---- write ----------------------------------------------------------------
    with cx:
        n_ce = 0
        for rows in (rows_map, rows_length, rows_declared):
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

        # ref_route naming: only from courses whose FINAL name came from the map tier.
        # Two courses proposing different names for the same route_id is a conflict, not a guess.
        proposals = defaultdict(list)
        for rk, info in final.items():
            if info is not None and info[2].startswith("derived:map"):
                proposals[map_route_id[rk]].append((info[1], info[2], info[3], rk, info[0]))

        conflicts = []
        n_route_named = 0
        for route_id, props in proposals.items():
            names = {p[0] for p in props}
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
        "declared_overridden": sorted(overridden),
    }
    if verbose:
        for rk in overridden:
            print("  declared_overridden: %s kept its derived:map name over declared_name" % rk)
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
    print("names: course %d/%d (verified %d, derived %d, declared %d)  ref_route %d/%d  "
          "ties %d  conflicts %d"
          % (c["course_named"], c["course_total"], c["verified"], c["derived"], c["declared"],
             c["ref_route_named"], c["ref_route_total"], c["ties"], c["conflicts"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
