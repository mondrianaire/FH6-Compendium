import os
import sys
import tempfile
import unittest
import uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _helpers as H

import fh6_anchors
import import_anchors
import import_course_match as cm

TZ = """﻿<?xml version="1.0" encoding="utf-8"?>
<triggerzones>
  <triggerzone type="sphere" name="race_trigger_zone_rt101" mobile="false">
    <position x="3070.16" y="116.42" z="2574.53" />
    <size x="100.0" y="100.0" z="100.0" />
  </triggerzone>
  <triggerzone type="sphere" name="race_trigger_zone_rt0281" mobile="false">
    <position x="-1710.1" y="120.0" z="-4426.5" />
    <size x="100.0" y="100.0" z="100.0" />
  </triggerzone>
  <triggerzone type="sphere" name="race_trigger_zone_rt99999" mobile="false">
    <position x="0.0" y="0.0" z="0.0" />
    <size x="100.0" y="100.0" z="100.0" />
  </triggerzone>
  <triggerzone type="box" name="bullet_time_trigger" mobile="false">
    <position x="1.0" y="1.0" z="1.0" />
    <size x="17.0" y="13.0" z="10.0" />
  </triggerzone>
</triggerzones>
"""


class ParseTest(unittest.TestCase):
    """The .tz reader: only sphere zones named race_trigger_zone_rt<N>, ids normalised, radius kept."""

    def test_parse_keeps_only_rt_spheres(self):
        a = fh6_anchors.parse(TZ.lstrip("﻿"))
        self.assertEqual([x["route_id"] for x in a], ["101", "281", "99999"])
        self.assertEqual(a[0]["radius_m"], 100.0)
        self.assertAlmostEqual(a[1]["x"], -1710.1)

    def test_inside_two_spheres_is_unresolved(self):
        a = fh6_anchors.parse(TZ.lstrip("﻿"))
        a.append({"route_id": "77", "name": "race_trigger_zone_rt77", "x": 3220.0, "y": 0.0, "z": 2574.53, "radius_m": 100.0})
        self.assertIsNone(fh6_anchors.inside(a, 3145.0, 2574.53))        # 75 m from both centres
        self.assertEqual(fh6_anchors.inside(a, 3000.0, 2574.53)["route_id"], "101")

    def test_inside_and_nearest(self):
        a = fh6_anchors.parse(TZ.lstrip("﻿"))
        self.assertEqual(fh6_anchors.inside(a, 3100.0, 2600.0)["route_id"], "101")   # 39 m away
        self.assertIsNone(fh6_anchors.inside(a, 3300.0, 2600.0))                     # 231 m away
        best, d = fh6_anchors.nearest(a, 3300.0, 2600.0)
        self.assertEqual(best["route_id"], "101")
        self.assertGreater(d, 200)
        self.assertEqual(fh6_anchors.nearest([], 0, 0), (None, None))

    def test_load_missing_file_is_empty(self):
        self.assertEqual(fh6_anchors.load(os.path.join(tempfile.gettempdir(), "no_such_%s.tz" % uuid.uuid4().hex)), [])


class ImportAnchorsTest(unittest.TestCase):
    """Stage anchors: one route_anchor row per sphere whose id is a ref_route, is_race set on exactly those."""

    def setUp(self):
        self.cx, self.db_path = H.new_db()
        for rid in ("101", "281", "5555"):
            H.insert(self.cx, "ref_route", ["route_id", "length_m", "is_loop"], (rid, 1000.0, 1))
        self.cx.commit()
        self.tz = os.path.join(tempfile.gettempdir(), "fh6_test_%s.tz" % uuid.uuid4().hex)
        with open(self.tz, "w", encoding="utf-8") as fh:
            fh.write(TZ)

    def tearDown(self):
        H.close_db(self.cx, self.db_path)
        try:
            os.remove(self.tz)
        except OSError:
            pass

    def test_rows_and_is_race(self):
        counts, notes = import_anchors.run(self.cx, self.tz)
        self.assertEqual(counts["route_anchor"], 2)
        self.assertEqual(counts["unknown_route_ids"], 1)
        self.assertEqual(notes["unknown"], ["99999"])
        self.assertEqual(H.dump(self.cx, "SELECT route_id, radius_m FROM route_anchor ORDER BY route_id"),
                         [("101", 100.0), ("281", 100.0)])
        self.assertEqual(H.dump(self.cx, "SELECT route_id, is_race FROM ref_route ORDER BY route_id"),
                         [("101", 1), ("281", 1), ("5555", 0)])

    def test_rerun_is_idempotent(self):
        import_anchors.run(self.cx, self.tz)
        before = H.dump(self.cx, "SELECT * FROM route_anchor ORDER BY route_id")
        import_anchors.run(self.cx, self.tz)
        self.assertEqual(H.dump(self.cx, "SELECT * FROM route_anchor ORDER BY route_id"), before)

    def test_empty_file_fails_the_stage(self):
        with open(self.tz, "w", encoding="utf-8") as fh:
            fh.write("<triggerzones/>")
        with self.assertRaises(RuntimeError):
            import_anchors.run(self.cx, self.tz)


class ApplyAnchorsRuleTest(unittest.TestCase):
    """The corroborate / tie-break rule, on its own: a sphere never overturns a geometry verdict
    that has evidence, only settles a 'probable' between its two candidates or identifies a 'none'
    -- and only with a strict majority (>= 2, more than half) of the course's events."""

    def test_no_evidence_is_a_no_op(self):
        self.assertEqual(cm.apply_anchors("c", "101", "verified", None, None, 5), ("101", "verified", None, None, None))
        self.assertEqual(cm.apply_anchors("c", "101", "verified", None, {}, 5), ("101", "verified", None, None, None))

    def test_verified_records_agreement_but_never_moves(self):
        self.assertEqual(cm.apply_anchors("c", "101", "verified", "5555", {"101": 3}, 3), ("101", "verified", "101", 3, 1))
        self.assertEqual(cm.apply_anchors("c", "101", "verified", "5555", {"281": 2}, 2), ("101", "verified", "281", 2, 0))

    def test_probable_is_settled_by_its_own_candidates_only(self):
        self.assertEqual(cm.apply_anchors("c", "101", "probable", "5555", {"5555": 4}, 5), ("5555", "verified", "5555", 4, 1))
        self.assertEqual(cm.apply_anchors("c", "101", "probable", "5555", {"101": 4}, 5), ("101", "verified", "101", 4, 1))
        self.assertEqual(cm.apply_anchors("c", "101", "probable", "5555", {"281": 4}, 5), ("101", "probable", "281", 4, 0))

    def test_probable_needs_a_majority(self):
        # 4 of 10 events in the runner-up's sphere: recorded, not promoted
        self.assertEqual(cm.apply_anchors("c", "101", "probable", "5555", {"5555": 4}, 10), ("101", "probable", "5555", 4, 0))
        # a single event is never a majority
        self.assertEqual(cm.apply_anchors("c", "101", "probable", "5555", {"5555": 1}, 1), ("101", "probable", "5555", 1, 0))

    def test_partial_stands(self):
        self.assertEqual(cm.apply_anchors("c", "101", "partial", None, {"101": 1}, 8), ("101", "partial", "101", 1, 1))
        self.assertEqual(cm.apply_anchors("c", "101", "partial", None, {"281": 1}, 8), ("101", "partial", "281", 1, 0))

    def test_none_becomes_anchored_with_route_id_still_null(self):
        self.assertEqual(cm.apply_anchors("c", None, "none", None, {"5031": 6}, 9), (None, "anchored", "5031", 6, None))

    def test_none_without_majority_stays_none(self):
        # the live 4200_-5450 case: 6 of 16 events in the sphere, 10 started elsewhere
        self.assertEqual(cm.apply_anchors("c", None, "none", None, {"5031": 6}, 16), (None, "none", "5031", 6, None))
        self.assertEqual(cm.apply_anchors("c", None, "none", None, {"5031": 1}, 1), (None, "none", "5031", 1, None))

    def test_even_split_is_no_anchor(self):
        self.assertEqual(cm.apply_anchors("c", None, "none", None, {"101": 2, "281": 2}, 4), (None, "none", None, 4, None))
        self.assertEqual(cm.apply_anchors("c", "101", "verified", None, {"101": 2, "281": 2}, 4), ("101", "verified", None, 4, None))


class AnchorEvidenceTest(unittest.TestCase):
    """anchor_evidence joins session_event starts to the spheres, per course."""

    def setUp(self):
        self.cx, self.db_path = H.new_db()
        H.insert(self.cx, "ref_route", ["route_id", "length_m", "is_loop"], ("101", 1000.0, 1))
        H.insert(self.cx, "route_anchor", ["route_id", "x", "y", "z", "radius_m"], ("101", 3070.0, 0.0, 2574.0, 100.0))
        H.insert(self.cx, "session", ["session_id"], ("s1",))
        rows = [("s1", 0, "cA", 3100.0, 2600.0), ("s1", 1, "cA", 3080.0, 2580.0),
                ("s1", 2, "cA", 3400.0, 2600.0), ("s1", 3, "cB", 3075.0, 2570.0), ("s1", 4, None, 3075.0, 2570.0)]
        for r in rows:
            H.insert(self.cx, "session_event", ["session_id", "i", "route_key", "start_x", "start_z"], r)
        self.cx.commit()

    def tearDown(self):
        H.close_db(self.cx, self.db_path)

    def test_counts_per_course_and_totals(self):
        hits, totals = cm.anchor_evidence(self.cx)
        self.assertEqual(hits, {"cA": {"101": 2}, "cB": {"101": 1}})
        self.assertEqual(totals, {"cA": 3, "cB": 1})

    def test_no_anchors_no_evidence(self):
        self.cx.execute("DELETE FROM route_anchor")
        self.cx.commit()
        self.assertEqual(cm.anchor_evidence(self.cx), ({}, {}))


if __name__ == "__main__":
    unittest.main()
