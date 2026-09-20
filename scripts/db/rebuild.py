#!/usr/bin/env python3
"""rebuild.py -- rebuild data/fh6.db from every source, in order.

    python scripts/db/rebuild.py                 # everything
    python scripts/db/rebuild.py --only gamedb   # one stage AND everything downstream of it
    python scripts/db/rebuild.py --only telemetry --no-cascade   # literally one stage
    python scripts/db/rebuild.py --check         # verify only, import nothing

Stage order matters: the ref_ layer must exist before containers can resolve a part name, and
containers must exist before laps can be bound to the setup that drove them.

Every stage is idempotent, so running this twice is a no-op the second time. That is the property
that makes the database safe to rebuild rather than patch.

`--only` CASCADES (2026-09-05). A stage that rewrites a table another stage joins on must be
followed by that stage, or the join goes dark: telemetry used to empty course_route (cascade off
`course`), routes emptied ref_route_surface (cascade off ref_route), and the automatic session-close
scope reran only telemetry+corners, so the links stayed empty for days. DOWNSTREAM is that
dependency graph as code; `--check` (run after every rebuild, exit 1 on FAIL) asserts the results.
"""
import argparse
import json
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)

import fh6db                                            # noqa: E402

STAGES = [
    ("gamedb", "import_gamedb.py", "the game's own catalogue, strings, physics and cars"),
    ("objectmodel", "import_objectmodel.py", "the game's event catalogue: tracks, races, collections, Rivals events -> route ids"),
    ("events", "import_events.py", "the Rivals catalogue as displayed: names, lengths, guids -> ref_event"),
    ("curves", "import_curves.py", "torque curves per camshaft, friction curves per compound"),
    ("parts_extra", "import_parts_extra.py",
     "part attributes, the game's own preset builds, per-car exceptions"),
    ("containers", "import_containers.py", "save containers -> parts, sliders, gears, packages"),
    ("telemetry", "import_telemetry.py", "sessions, courses, laps and per-sample trace rows"),
    ("routes", "import_routes.py", "the game's route centre-lines"),
    ("anchors", "import_anchors.py", "the game's race-activation spheres: a route id at a world position"),
    ("surface", "import_surface.py", "what the road at every turn is made of, from the nav graph"),
    ("course_match", "import_course_match.py", "how our courses map onto the game's routes -- from the DB, no game files"),
    ("consolidate", "import_consolidate.py", "collapse duplicate-road courses onto one canonical route id; pool whole-course twins"),
    ("route_names", "import_route_names.py", "derive course and route names from map identity + catalogue length; evidence in course_event"),
    ("corners", "import_corners.py", "what every lap did at every road-derived turn"),
    ("observations", "import_observations.py", "human evidence, name grading, clone readiness"),
    ("deterministic", "import_deterministic.py", "raw captures -> per-session deterministic sidecars (gearing, brake lock, bottoming)"),
    ("diagnosis", "import_diagnosis.py", "failure catalogue x detectors, placed on turns"),
    ("field_catalog", "import_field_catalog.py", "field-level knowledge as data: catalogue, gating relationships, reliability tiers"),
]
STAGE_NAMES = [s[0] for s in STAGES]

#: stage -> stages that must rerun after it (they join on tables it rewrites). Transitive closure
#: is taken by expand_only. `containers` deliberately has none: it runs on every save and the laps
#: it could re-bind are re-bound by the next session close anyway.
DOWNSTREAM = {
    "gamedb": ["objectmodel", "events"],
    "objectmodel": ["events", "route_names"],
    "events": ["route_names"],
    "telemetry": ["course_match", "consolidate", "route_names", "corners", "deterministic", "diagnosis"],
    "routes": ["anchors", "surface", "course_match", "consolidate", "route_names", "corners", "diagnosis"],
    "anchors": ["course_match", "consolidate", "route_names", "corners", "diagnosis"],
    "surface": ["route_names"],
    "course_match": ["consolidate", "route_names", "corners", "diagnosis"],
    "consolidate": ["route_names", "corners", "diagnosis"],
    "corners": ["diagnosis"],
    "deterministic": ["diagnosis"],
}

#: import_run.kind values that predate a rename and mean a STAGES name.
KIND_ALIASES = {"road_class": "surface"}


def expand_only(only):
    """The stages to run for `--only only`: the set plus its transitive dependents, in STAGES order."""
    want = set(only or [])
    frontier = list(want)
    while frontier:
        s = frontier.pop()
        for d in DOWNSTREAM.get(s, []):
            if d not in want:
                want.add(d)
                frontier.append(d)
    return [s for s in STAGE_NAMES if s in want]


def run_stage(name, script, db, verbose):
    cmd = [sys.executable, os.path.join(HERE, script)]
    if db:
        cmd += ["--db", db]
    if verbose:
        cmd += ["-v"]
    t0 = time.time()
    print("\n== %s: %s" % (name, dict((s[0], s[2]) for s in STAGES)[name]))
    env = dict(os.environ, PYTHONIOENCODING="utf-8")
    p = subprocess.run(cmd, cwd=ROOT, env=env)
    if p.returncode:
        raise SystemExit("stage %s failed with exit %d" % (name, p.returncode))
    print("   (%.1fs)" % (time.time() - t0))


def report(db):
    cx = fh6db.connect(db, ro=True)
    counts = fh6db.table_counts(cx)
    groups = [("reference (the game's truth)", "ref_"), ("saves", "tune_"),
              ("hardware packages", "hw_"), ("telemetry", ("session", "course", "lap", "corner")),
              ("observations", "obs_"), ("materialized", "plan_")]
    print("\n%s" % ("-" * 58))
    for label, pref in groups:
        rows = [(t, n) for t, n in counts.items()
                if (t.startswith(pref) if isinstance(pref, str) else t.startswith(pref))]
        if not rows:
            continue
        print("%s" % label)
        for t, n in sorted(rows):
            print("   %-22s %9d" % (t, n))
    p = fh6db.db_path(db)
    print("%s\n%-25s %9.1f MB" % ("-" * 58, os.path.basename(p), os.path.getsize(p) / 1048576.0))
    return cx


# ---------------------------------------------------------------------------
# --check: the invariants a partial rerun can break. FAIL -> exit 1; WARN is listed only.
# ---------------------------------------------------------------------------

def _one(cx, sql, *args):
    r = cx.execute(sql, args).fetchone()
    return None if r is None else r[0]


def last_runs(cx):
    """{stage: started_utc of the latest ok run}, with legacy kinds folded onto STAGES names."""
    out = {}
    for kind, started in cx.execute(
            "SELECT kind, MAX(started_utc) FROM import_run WHERE ok=1 GROUP BY kind"):
        k = KIND_ALIASES.get(kind, kind)
        if started and (k not in out or started > out[k]):
            out[k] = started
    return out


def check_invariants(cx):
    """[(level, code, message)] over the live database. Levels: FAIL | WARN."""
    out = []
    tabs = set(fh6db.table_counts(cx))
    ran = last_runs(cx)

    def fail(code, msg):
        out.append(("FAIL", code, msg))

    def warn(code, msg):
        out.append(("WARN", code, msg))

    # I11 migration applied
    missing = fh6db.missing_v2(cx)
    if missing:
        fail("I11-schema", "live DB lacks: %s (run any rebuild to migrate)" % ", ".join(missing))
        return out                                       # the rest would only error

    # I1 course_route covers every course with geometry
    if "course_route" in tabs:
        n_geo = _one(cx, "SELECT COUNT(*) FROM course WHERE json_array_length(json_extract(geometry,'$.path')) >= 12")
        n_cr = _one(cx, "SELECT COUNT(*) FROM course_route")
        if n_geo and n_cr != n_geo:
            fail("I1-course_route", "course_route has %d rows for %d courses with geometry (telemetry ran without course_match?)" % (n_cr, n_geo))

    # I2 freshness: nothing downstream is older than what it joins on
    for up, downs in DOWNSTREAM.items():
        if up not in ran:
            continue
        for d in downs:
            if d in ran and ran[d] < ran[up]:
                fail("I2-stale", "%s last ran %s, before %s (%s): rerun it" % (d, ran[d], up, ran[up]))
            elif d not in ran and up in ("telemetry", "routes", "events", "anchors", "objectmodel"):
                fail("I2-stale", "%s has never run although %s has" % (d, up))

    # I3 the Rivals catalogue and its guid join
    if "ref_event" in tabs and "events" in ran:
        n_ev = _one(cx, "SELECT COUNT(*) FROM ref_event WHERE kind='rivals'")
        want = None
        rp = os.path.join(ROOT, "data", "rivals-routes-road.json")
        if os.path.exists(rp):
            try:
                with open(rp, encoding="utf-8") as fh:
                    want = len(json.load(fh).get("routes") or [])
            except Exception:                            # noqa: BLE001
                want = None
        if want is not None and n_ev < want:
            fail("I3-events", "ref_event holds %d rivals rows, data/rivals-routes-road.json lists %d" % (n_ev, want))
        bad = _one(cx, """SELECT COUNT(*) FROM ref_event_string es JOIN ref_event e USING(event_id)
                          JOIN ref_string s ON s.table_name=es.table_name AND s.key_hash=es.key_hash
                          WHERE es.role='name' AND s.content <> e.name""")
        if bad:
            fail("I3-events", "%d ref_event_string name rows whose game string differs from ref_event.name" % bad)

    # I4/I5 names present and provenanced
    if "route_names" in ran:
        n_named = _one(cx, "SELECT COUNT(*) FROM course WHERE name IS NOT NULL AND route_key NOT LIKE 'loop:%'")
        n_course = _one(cx, "SELECT COUNT(*) FROM course WHERE route_key NOT LIKE 'loop:%'")
        # An empty name set is not a defect by itself: the rule refuses to guess, and a database
        # with no verified map identity and no closed loop has nothing to name. Named-but-unprovenanced
        # (I5) is the failure; zero names is reported so it is seen.
        if n_course and not n_named:
            warn("I4-names", "route_names ran but no course is named (no map identity or closed loop matched the catalogue)")
        n_route_named = _one(cx, "SELECT COUNT(*) FROM ref_route WHERE name IS NOT NULL")
        if n_course and _one(cx, "SELECT COUNT(*) FROM ref_route") and not n_route_named:
            warn("I4-names", "route_names ran but no ref_route is named")
        n_orphan_chosen = _one(cx, """SELECT COUNT(*) FROM course_event ce JOIN course c USING(route_key)
                                      WHERE ce.chosen=1 AND (c.name IS NULL OR c.event_id IS NULL)""")
        if n_orphan_chosen:
            fail("I4-names", "%d course_event rows are chosen=1 for a course with no name/event_id" % n_orphan_chosen)
        n_noprov = _one(cx, "SELECT COUNT(*) FROM course WHERE name IS NOT NULL AND (name_source IS NULL OR name_confidence IS NULL)")
        if n_noprov:
            fail("I5-provenance", "%d named courses without name_source/name_confidence (telemetry ran after route_names?)" % n_noprov)
        # 'derived:game' may carry no event: a catalogued route no Rivals or career event reaches
        # (IE Drive sections, cut content) still names the course; a map/length derivation may not
        n_noev = _one(cx, "SELECT COUNT(*) FROM course WHERE name_source LIKE 'derived:%' "
                          "AND name_source <> 'derived:game' AND event_id IS NULL")
        if n_noev:
            fail("I5-provenance", "%d derived course names without event_id" % n_noev)
        # a route the game's catalogue names may have no event at all (IE Drive sections, cut content):
        # name_source 'game:trackinfo' with event_id NULL is provenanced; a DERIVED name without its event is not
        n_rr = _one(cx, """SELECT COUNT(*) FROM ref_route WHERE name IS NOT NULL
                           AND (name_source IS NULL OR (event_id IS NULL AND name_source NOT LIKE 'game:%'))""")
        if n_rr:
            fail("I5-provenance", "%d named ref_route rows without event_id/name_source" % n_rr)
        for rk, dn, ev in cx.execute("""SELECT route_key, declared_name, event_id FROM course
                                        WHERE declared_name IS NOT NULL AND route_key NOT LIKE 'loop:%'
                                          AND declared_name NOT IN (SELECT name FROM ref_event)"""):
            warn("I9-declared", "%s declared '%s' is not a game event name" % (rk, dn))
        for rk, n in cx.execute("""SELECT route_key, COUNT(*) FROM course_event WHERE chosen=0
                                   GROUP BY route_key HAVING COUNT(*) >= 2"""):
            nm = _one(cx, "SELECT name FROM course WHERE route_key=?", rk)
            if nm is None:
                warn("I10-ambiguous", "%s: %d candidates, none chosen" % (rk, n))

    # I6 corners follow verified matches
    if "corners" in ran and "course_route" in tabs:
        n_v = _one(cx, """SELECT COUNT(*) FROM course_route cr JOIN lap l USING(route_key)
                          WHERE cr.match_kind IN ('verified','probable')""")
        if n_v and not _one(cx, "SELECT COUNT(*) FROM corner_obs"):
            fail("I6-corners", "verified/probable routes have laps but corner_obs is empty")

    # I7 surface survived the routes stage
    if "surface" in ran and "ref_route_surface" in tabs:
        if not _one(cx, "SELECT COUNT(*) FROM ref_route_surface"):
            fail("I7-surface", "ref_route_surface is empty (routes ran after surface?)")
        elif not _one(cx, "SELECT COUNT(*) FROM ref_route WHERE road_class IS NOT NULL"):
            fail("I7-surface", "ref_route.road_class is NULL everywhere")

    # I13 the game's catalogue: loaded, every Rivals name bound to one route, ref_route named by it
    if "objectmodel" in ran and "ref_track_info" in tabs:
        n_ti = _one(cx, "SELECT COUNT(*) FROM ref_track_info")
        if n_ti < 100:
            fail("I13-catalogue", "ref_track_info holds %d rows (expected ~112)" % n_ti)
        n_multi = _one(cx, """SELECT COUNT(*) FROM (SELECT name FROM v_rivals_route GROUP BY name
                              HAVING COUNT(DISTINCT route_id) > 1)""")
        if n_multi:
            fail("I13-catalogue", "%d Rivals names resolve to more than one route" % n_multi)
        if "events" in ran:
            n_unbound = _one(cx, """SELECT COUNT(*) FROM ref_event e WHERE e.kind='rivals' AND e.route_id IS NULL
                                    AND e.name IN (SELECT name FROM v_rivals_route)""")
            if n_unbound:
                fail("I13-catalogue", "%d Rivals events have no route_id although the catalogue binds them (events ran before objectmodel?)" % n_unbound)
        if "route_names" in ran:
            n_unnamed = _one(cx, """SELECT COUNT(*) FROM ref_route r WHERE r.name IS NULL
                                    AND r.route_id IN (SELECT route_id FROM ref_track_info
                                                       WHERE display_name IS NOT NULL AND display_name <> '')""")
            if n_unnamed:
                fail("I13-catalogue", "%d catalogued routes carry no name after route_names" % n_unnamed)
            last = cx.execute("SELECT notes FROM import_run WHERE kind='route_names' AND ok=1 ORDER BY started_utc DESC LIMIT 1").fetchone()
            try:
                gvm = (json.loads(last[0]) if last and last[0] else {}).get("game_vs_map") or []
            except Exception:                            # noqa: BLE001
                gvm = []
            for x in gvm:
                if "ratio" in x:
                    warn("I13-catalogue", "catalogued route %s (%s) is %.2fx its event's length (%d m vs %d m): sections/lead-in in the .owt?"
                         % (x["route_id"], x["game"], x["ratio"], x["route_len_m"], x["event_len_m"]))
                else:
                    warn("I13-catalogue", "derived name disagrees with the game's: %s" % json.dumps(x))

    # I12 anchors: the spheres are loaded, and what they say about course_route is visible
    if "anchors" in ran and "route_anchor" in tabs:
        n_a = _one(cx, "SELECT COUNT(*) FROM route_anchor")
        if not n_a:
            fail("I12-anchors", "anchors ran but route_anchor is empty")
        if _one(cx, "SELECT COUNT(*) FROM ref_route WHERE is_race=1") != n_a:
            fail("I12-anchors", "ref_route.is_race count differs from route_anchor rows")
        if "course_match" in ran:
            n_bad = _one(cx, "SELECT COUNT(*) FROM course_route WHERE match_kind='anchored' AND anchor_route_id IS NULL")
            if n_bad:
                fail("I12-anchors", "%d course_route rows are 'anchored' without an anchor_route_id" % n_bad)
            n_leak = _one(cx, "SELECT COUNT(*) FROM course_route WHERE match_kind='anchored' AND route_id IS NOT NULL")
            if n_leak:
                fail("I12-anchors", "%d 'anchored' course_route rows carry a route_id (shape-unverified identity leaking to corners/naming)" % n_leak)
            for rk, rid, kind, aid, n in cx.execute("""SELECT route_key, route_id, match_kind, anchor_route_id, anchor_events
                                                       FROM course_route WHERE anchor_agree=0"""):
                warn("I12-anchors", "%s: geometry says route %s (%s) but %d event start(s) lie in route %s's sphere"
                     % (rk, rid, kind, n or 0, aid))

    # I8 every run kind is a stage
    for (kind,) in cx.execute("SELECT DISTINCT kind FROM import_run"):
        if KIND_ALIASES.get(kind, kind) not in STAGE_NAMES:
            warn("I8-kind", "import_run.kind %r is not a STAGES name" % kind)
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--db", default=None)
    ap.add_argument("--only", choices=STAGE_NAMES, action="append")
    ap.add_argument("--no-cascade", action="store_true", help="run exactly the --only stages, no dependents")
    ap.add_argument("--check", action="store_true", help="report and verify, import nothing")
    ap.add_argument("-v", "--verbose", action="store_true")
    a = ap.parse_args(argv)

    if not a.check:
        cx = fh6db.connect(a.db)
        fh6db.ensure_schema(cx)
        n_cols, n_tabs = fh6db.migrate(cx)
        if n_cols or n_tabs:
            print("migrated: +%d columns, +%d tables/views/indexes (schema_version %s)"
                  % (n_cols, n_tabs, fh6db.SCHEMA_VERSION))
        cx.close()
        todo = STAGE_NAMES if not a.only else (list(a.only) if a.no_cascade else expand_only(a.only))
        if a.only and not a.no_cascade:
            extra = [s for s in todo if s not in a.only]
            if extra:
                print("cascade: +%s" % " +".join(extra))
        for name, script, _ in STAGES:
            if name in todo:
                run_stage(name, script, a.db, a.verbose)

    cx = report(a.db)
    bad = cx.execute("PRAGMA foreign_key_check").fetchall()
    integ = cx.execute("PRAGMA integrity_check").fetchone()[0]
    empty = [t for t, n in fh6db.table_counts(cx).items()
             if t.startswith("ref_") and n == 0]
    print("\nintegrity: %s   foreign keys: %s   empty ref_ tables: %s"
          % (integ, "clean" if not bad else "%d violations" % len(bad), empty or "none"))
    inv = check_invariants(cx)
    fails = [x for x in inv if x[0] == "FAIL"]
    for level, code, msg in inv:
        print("  %-4s %-16s %s" % (level, code, msg))
    print("check: %s" % ("PASSED" if not fails and integ == "ok" and not bad else "FAILED (%d)" % (len(fails) + len(bad) + (integ != "ok"))))
    return 0 if (integ == "ok" and not bad and not fails) else 1


if __name__ == "__main__":
    sys.exit(main())
