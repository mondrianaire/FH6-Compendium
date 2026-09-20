"""The impossible-speed ceiling is ONE number, declared in two places.

A rewind-collapsed lap can present a time no car could set -- 13.3 s for a 10.9 km
Colossus lap, 838 m/s. The guards that strike those (2026-09-20) sit at four
boundaries across two files, and each file names the ceiling itself:

    analyze_session.py   SHORT_LAP_VMAX   -- window selection, the lap record, the best trace
    import_telemetry.py  LAP_VMAX_MPS     -- materialization, the boundary the dashboard reads

Two constants for one physical fact is a drift risk, and the handoff that
introduced them said so in as many words: "keep them in sync -- or promote to one
shared home if you touch this again." Nothing enforced it, so this does.

If a future change promotes them to a single shared constant, DELETE this test
rather than teaching it the new layout: it exists only because there are two.
"""
import os
import re
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

ANALYZE = os.path.join(ROOT, "scripts", "telemetry", "analyze_session.py")
IMPORTER = os.path.join(ROOT, "scripts", "db", "import_telemetry.py")


def _const(path, name):
    """Read a module-level `NAME = <float>` without importing the module.

    analyze_session imports numpy and touches the save tree at import time, so
    reading the source is both faster and safer than importing it for one number.
    """
    with open(path, "r", encoding="utf-8") as fh:
        src = fh.read()
    m = re.search(r"^%s\s*=\s*([0-9.]+)" % re.escape(name), src, re.M)
    return float(m.group(1)) if m else None


class LapSpeedCeiling(unittest.TestCase):
    def test_both_constants_exist(self):
        for path, name in ((ANALYZE, "SHORT_LAP_VMAX"), (IMPORTER, "LAP_VMAX_MPS")):
            self.assertIsNotNone(
                _const(path, name),
                "%s no longer declares %s -- if the ceiling moved to a shared home, "
                "delete tests/test_lap_speed_ceiling.py rather than editing it"
                % (os.path.basename(path), name))

    def test_constants_agree(self):
        a = _const(ANALYZE, "SHORT_LAP_VMAX")
        b = _const(IMPORTER, "LAP_VMAX_MPS")
        self.assertEqual(
            a, b,
            "the impossible-speed ceiling disagrees between files: "
            "analyze_session.SHORT_LAP_VMAX=%s vs import_telemetry.LAP_VMAX_MPS=%s. "
            "A lap the analyzer accepts would then be struck at materialization, or "
            "worse, the reverse -- an impossible time reaching the dashboard." % (a, b))

    def test_ceiling_is_physically_sane(self):
        """Above any FH6 car, below anything a real lap averages.

        150 m/s is ~540 km/h. The fastest cars top out near 500 km/h and no lap
        AVERAGES that, so the ceiling separates artifacts from real laps without
        touching either end. A value under ~100 m/s would start striking real
        drag and sprint passes.
        """
        a = _const(ANALYZE, "SHORT_LAP_VMAX")
        self.assertGreater(a, 100.0, "ceiling low enough to strike real sprint passes")
        self.assertLess(a, 400.0, "ceiling so high it would admit the artifacts it exists to catch")


if __name__ == "__main__":
    unittest.main()
