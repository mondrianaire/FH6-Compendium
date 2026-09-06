import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _helpers as H

import import_route_names as rn


def geo(path):
    return json.dumps({"path": path})


CLOSED = geo([[0.0, 0.0], [10.0, 5.0]])            # first/last 11.2 m apart -- < LOOP_GAP_M (60)
OPEN = geo([[0.0, 0.0], [1000.0, 1000.0]])         # 1414 m apart -- a point-to-point course


class RouteNamesRuleTest(unittest.TestCase):
    """Every branch of the map > length > declared precedence, on a hand-built DB. No .owt file,
    no course model JSON -- every input the stage reads is already a column."""

    def setUp(self):
        self.cx, self.db_path = H.new_db()
        cx = self.cx

        # ---- ref_event: 5 rows -- two share a length (E1/E2), one is a Sprint (E3) -------------
        events = [
            ("rivals:alpha", "Event Alpha", 1000.0, 1),
            ("rivals:beta", "Event Beta", 1000.0, 1),
            ("rivals:gamma-sprint", "Gamma Sprint", 2000.0, 0),
            ("rivals:delta", "Event Delta", 3000.0, 1),
            ("rivals:epsilon", "Event Epsilon", 4000.0, 1),
        ]
        for eid, name, length_m, is_loop in events:
            H.insert(cx, "ref_event", ["event_id", "kind", "name", "length_m", "is_loop"],
                     (eid, "rivals", name, length_m, is_loop))

        # ---- ref_route: loops, a p2p route, one 'loose' -----------------------------------------
        routes = [
            ("RT1", 3000.0, 1, "paved"),      # loop -- used for the unique map agreement
            ("RT2", 1000.0, 1, "paved"),      # loop -- used for the tie
            ("RT3", 3000.0, 1, "paved"),      # loop -- used for the map/course disagreement
            ("RT4", 2000.0, 0, "loose"),      # p2p AND loose -- must be excluded from map naming
            ("RT5", 9999.0, 0, "paved"),      # a plain p2p route, unused by any course
        ]
        for rid, length_m, is_loop, road_class in routes:
            H.insert(cx, "ref_route", ["route_id", "length_m", "is_loop", "road_class"],
                     (rid, length_m, is_loop, road_class))

        # ---- courses -----------------------------------------------------------------------------
        courses = [
            # route_key, length_m, declared_name, geometry
            ("c1", 3000.0, None, CLOSED),         # unique map agreement -> verified
            ("c2", 1000.0, "Event Beta", CLOSED),  # tie broken by declared -> derived:map+declared
            ("c3", 4000.0, None, CLOSED),          # map/course disagreement -> no name, both rows
            ("c4", 3000.0, None, CLOSED),          # closed-loop length tier -> derived:length
            ("c5", 4000.0, None, CLOSED),          # bijection violation (paired with c6) -> no name
            ("c6", 4000.0, None, CLOSED),          # bijection violation (paired with c5) -> no name
            ("c7", 3000.0, None, OPEN),            # open path -> no name, never even a candidate
            ("c8", 500.0, "Some Made Up Name Nobody Uses", OPEN),  # declared, non-catalogue -> read
            ("c9", 2000.0, None, CLOSED),          # 'loose' route excluded despite length agreement
        ]
        for rk, length_m, declared, geometry in courses:
            H.insert(cx, "course", [
                "route_key", "length_m", "declared_name", "geometry"],
                (rk, length_m, declared, geometry))

        # ---- course_route: only the map-eligible courses get one ---------------------------------
        matches = [
            ("c1", "RT1", "verified"),
            ("c2", "RT2", "probable"),
            ("c3", "RT3", "verified"),
            ("c9", "RT4", "verified"),
        ]
        for rk, rid, kind in matches:
            H.insert(cx, "course_route", ["route_key", "route_id", "match_kind", "computed_utc"],
                     (rk, rid, kind, "2026-09-05T00:00:00Z"))

        cx.commit()
        self.events_by_name = {name: eid for eid, name, _, _ in events}

    def tearDown(self):
        H.close_db(self.cx, self.db_path)

    def _course(self, rk):
        row = self.cx.execute(
            "SELECT name, name_source, name_confidence, event_id FROM course WHERE route_key=?",
            (rk,)).fetchone()
        return tuple(row)

    def _course_events(self, rk):
        return H.dump(self.cx, """SELECT event_id, tier, road_ok, chosen FROM course_event
                                   WHERE route_key=? ORDER BY event_id""", rk)

    def test_unique_map_agreement_is_verified(self):
        rn.run(self.cx)
        name, source, confidence, event_id = self._course("c1")
        self.assertEqual(name, "Event Delta")
        self.assertEqual(source, "derived:map")
        self.assertEqual(confidence, "verified")
        self.assertEqual(event_id, "rivals:delta")

    def test_tie_broken_by_declared(self):
        rn.run(self.cx)
        name, source, confidence, event_id = self._course("c2")
        self.assertEqual(name, "Event Beta")
        self.assertEqual(source, "derived:map+declared")
        self.assertEqual(confidence, "derived")
        self.assertEqual(event_id, "rivals:beta")

    def test_map_course_disagreement_names_nothing_but_records_both(self):
        rn.run(self.cx)
        name, source, confidence, event_id = self._course("c3")
        self.assertIsNone(name)
        self.assertIsNone(source)
        self.assertIsNone(event_id)
        rows = self._course_events("c3")
        self.assertEqual(len(rows), 2)
        self.assertEqual({r[0] for r in rows}, {"rivals:delta", "rivals:epsilon"})
        self.assertTrue(all(r[3] == 0 for r in rows))     # chosen=0 on both

    def test_closed_loop_length_tier(self):
        rn.run(self.cx)
        name, source, confidence, event_id = self._course("c4")
        self.assertEqual(name, "Event Delta")
        self.assertEqual(source, "derived:length")
        self.assertEqual(confidence, "derived")
        self.assertEqual(event_id, "rivals:delta")

    def test_open_path_names_nothing_and_leaves_no_candidate(self):
        rn.run(self.cx)
        name, source, confidence, event_id = self._course("c7")
        self.assertIsNone(name)
        self.assertIsNone(source)
        self.assertIsNone(event_id)
        self.assertEqual(self._course_events("c7"), [])

    def test_bijection_violation_names_neither(self):
        rn.run(self.cx)
        for rk in ("c5", "c6"):
            name, source, confidence, event_id = self._course(rk)
            self.assertIsNone(name, "%s should stay unnamed" % rk)
            self.assertIsNone(source)
        # both still proposed 'rivals:epsilon' via the length tier, unchosen
        for rk in ("c5", "c6"):
            rows = self._course_events(rk)
            self.assertEqual([r[0] for r in rows], ["rivals:epsilon"])
            self.assertEqual(rows[0][3], 0)

    def test_declared_non_catalogue_is_read_with_no_event(self):
        rn.run(self.cx)
        name, source, confidence, event_id = self._course("c8")
        self.assertEqual(name, "Some Made Up Name Nobody Uses")
        self.assertEqual(source, "declared")
        self.assertEqual(confidence, "read")
        self.assertIsNone(event_id)

    def test_loose_route_excluded_from_map_naming(self):
        rn.run(self.cx)
        name, source, confidence, event_id = self._course("c9")
        self.assertIsNone(name)
        rows = self._course_events("c9")
        self.assertEqual(len(rows), 1)
        eid, tier, road_ok, chosen = rows[0]
        self.assertEqual(eid, "rivals:gamma-sprint")
        self.assertEqual(road_ok, 0)
        self.assertEqual(chosen, 0)

    def test_idempotent_rerun_yields_identical_dumps(self):
        rn.run(self.cx)
        courses_1 = H.dump(self.cx, "SELECT route_key, name, name_source, name_confidence, "
                                     "event_id FROM course ORDER BY route_key")
        events_1 = H.dump(self.cx, "SELECT route_key, event_id, tier, route_id, d_route_m, "
                                    "d_course_m, loop_ok, road_ok, declared_ok, chosen "
                                    "FROM course_event ORDER BY route_key, event_id, tier")
        routes_1 = H.dump(self.cx, "SELECT route_id, name, event_id, name_source, "
                                    "name_confidence FROM ref_route ORDER BY route_id")

        rn.run(self.cx)
        courses_2 = H.dump(self.cx, "SELECT route_key, name, name_source, name_confidence, "
                                     "event_id FROM course ORDER BY route_key")
        events_2 = H.dump(self.cx, "SELECT route_key, event_id, tier, route_id, d_route_m, "
                                    "d_course_m, loop_ok, road_ok, declared_ok, chosen "
                                    "FROM course_event ORDER BY route_key, event_id, tier")
        routes_2 = H.dump(self.cx, "SELECT route_id, name, event_id, name_source, "
                                    "name_confidence FROM ref_route ORDER BY route_id")

        self.assertEqual(courses_1, courses_2)
        self.assertEqual(events_1, events_2)
        self.assertEqual(routes_1, routes_2)
        self.assertTrue(courses_1)          # sanity: the dumps are not trivially empty


if __name__ == "__main__":
    unittest.main()
