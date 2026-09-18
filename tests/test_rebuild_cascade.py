import glob
import os
import re
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _helpers as H

import rebuild


RUN_BEGIN_RE = re.compile(r'run_begin\(\s*cx\s*,\s*"([^"]+)"')


class ExpandOnlyTest(unittest.TestCase):
    """`--only` cascades to every stage that joins on what it rewrites (DOWNSTREAM), transitively,
    in STAGES order -- the property that keeps a partial rerun from leaving a stale join (the bug
    the 2026-09-05 course_route incident was)."""

    def test_telemetry_cascades_exactly(self):
        self.assertEqual(
            rebuild.expand_only(["telemetry"]),
            ["telemetry", "course_match", "consolidate", "route_names", "corners", "diagnosis"])

    def test_routes_cascades_include_surface_chain(self):
        got = rebuild.expand_only(["routes"])
        for stage in ("surface", "course_match", "route_names", "corners", "diagnosis"):
            self.assertIn(stage, got, "%s missing from expand_only(['routes']) = %r" % (stage, got))
        # STAGES order preserved
        self.assertEqual(got, sorted(got, key=rebuild.STAGE_NAMES.index))

    def test_no_cascade_case_is_the_bare_list(self):
        self.assertEqual(rebuild.expand_only(["gamedb"]), ["gamedb", "objectmodel", "events", "route_names"])
        self.assertEqual(rebuild.expand_only(["objectmodel"]), ["objectmodel", "events", "route_names"])


class StageNameLiteralsTest(unittest.TestCase):
    """Every import_*.py that opens an import_run row must open it under its own STAGES name --
    a typo here is invisible until check_invariants' I8 warns on a live database."""

    def test_every_run_begin_call_uses_a_stages_name(self):
        db_dir = os.path.join(H.ROOT, "scripts", "db")
        paths = sorted(glob.glob(os.path.join(db_dir, "import_*.py")))
        self.assertTrue(paths, "no import_*.py found under %s" % db_dir)
        checked = 0
        for path in paths:
            with open(path, encoding="utf-8") as fh:
                src = fh.read()
            for m in RUN_BEGIN_RE.finditer(src):
                kind = m.group(1)
                self.assertIn(kind, rebuild.STAGE_NAMES,
                               "%s: run_begin(cx, %r, ...) is not a STAGES name" % (path, kind))
                checked += 1
        # sanity: every stage script actually has exactly one such call, none skipped by the regex
        self.assertGreaterEqual(checked, len(rebuild.STAGE_NAMES))


class CheckInvariantsFreshSchemaTest(unittest.TestCase):
    """A schema-only database (nothing has run) must never trip I1 or I4 -- those invariants only
    make a claim once the stage that fills them in has actually run."""

    def test_no_i1_or_i4_fail_before_anything_runs(self):
        cx, path = H.new_db()
        try:
            inv = rebuild.check_invariants(cx)
            fails = [x for x in inv if x[0] == "FAIL"]
            for level, code, msg in fails:
                self.assertNotIn("I1", code, msg)
                self.assertNotIn("I4", code, msg)
        finally:
            H.close_db(cx, path)


if __name__ == "__main__":
    unittest.main()
