"""The deterministic detectors are allowed to speak at n=1, so they must not fire on nothing.

Every test here is a synthetic lap with one thing wrong in it, because the point of a deterministic
detector is that the fault is visible in the signal itself. The negative cases matter more than the
positive ones: a detector that fires on ordinary hard braking would put a brake-pressure change in
front of Jett on the strength of one lap, which is exactly the authority the n=1 rule grants it.
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _helpers as H  # noqa: F401  (path setup)

import deterministic as D

HZ = 60.0
RAD = 0.25                      # wheel radius the synthetic rows are built around
RADII = {"FL": RAD, "FR": RAD, "RL": RAD, "RR": RAD}


def row(t, speed_ms=40.0, brake=0, accel=0, gear=5, rpm=5000.0, susp=0.5,
        wheel_frac=1.0, steer=0.0, ordinal="2866"):
    """One capture row. wheel_frac is the fraction of road speed every wheel is turning at."""
    omega = (speed_ms * wheel_frac) / RAD
    r = {"t": t, "t_mono": t, "IsRaceOn": "1", "Speed": speed_ms, "Brake": brake, "Accel": accel,
         "Gear": gear, "CurrentEngineRpm": rpm, "EngineMaxRpm": 9000.0, "EngineIdleRpm": 1000.0,
         "Steer": steer, "CarOrdinal": ordinal}
    for w in ("FL", "FR", "RL", "RR"):
        r["NormSusp" + w] = susp
        r["WheelRotSpeed" + w] = omega
        r["SlipRatio" + w] = 0.0
    return r


def span(n, **kw):
    return [row(i / HZ, **kw) for i in range(n)]


class CalibrationTest(unittest.TestCase):
    def test_radius_recovered_from_coasting(self):
        rows = span(120, brake=0, accel=0, speed_ms=30.0)
        self.assertAlmostEqual(D.wheel_radii(rows)["FL"], RAD, places=3)

    def test_no_radius_without_enough_coasting(self):
        self.assertEqual(D.wheel_radii(span(5, brake=0, accel=0, speed_ms=30.0)), {})

    def test_braking_and_throttle_samples_never_calibrate(self):
        """A braking wheel is not rolling free, so it must not set the radius."""
        rows = span(200, brake=255, accel=0, speed_ms=30.0, wheel_frac=0.4)
        self.assertEqual(D.wheel_radii(rows), {})

    def test_redline_comes_from_low_gears_not_the_declared_field(self):
        """A tall gear that never reaches the limiter must not drag the ceiling down."""
        rows = span(100, accel=255, gear=2, rpm=9200.0) + span(400, accel=255, gear=10, rpm=6000.0)
        obs, declared = D.observed_redline(rows)
        self.assertGreater(obs, 9000.0)
        self.assertEqual(declared, 9000.0)          # the declared field is reported, not used


class GearingTest(unittest.TestCase):
    def test_top_gear_never_engaged(self):
        rows = span(200, accel=255, gear=7, rpm=8000.0)
        f = D.detect_gearing(rows, 9000.0, built_gears=10)
        self.assertEqual([x["fault"] for x in f], ["gear-never-reached"])
        self.assertEqual(f[0]["measure"], {"top_gear_built": 10, "top_gear_used": 7})

    def test_top_gear_reached_but_under_revved(self):
        rows = span(200, accel=255, gear=10, rpm=7000.0)
        f = D.detect_gearing(rows, 9000.0, built_gears=10)
        self.assertEqual([x["fault"] for x in f], ["gear-under-revved"])

    def test_top_gear_pulling_properly_is_not_a_fault(self):
        rows = span(200, accel=255, gear=10, rpm=8600.0)
        self.assertEqual(D.detect_gearing(rows, 9000.0, built_gears=10), [])

    def test_sustained_limiter_in_top_gear(self):
        rows = span(120, accel=255, gear=10, rpm=8950.0)      # 2 s at >= 98% of 9000
        f = D.detect_gearing(rows, 9000.0, built_gears=10)
        self.assertEqual([x["fault"] for x in f], ["gear-limiter-bound"])
        self.assertGreaterEqual(f[0]["measure"]["limiter_s"], D.LIMITER_S)

    def test_a_brief_limiter_touch_is_not_a_fault(self):
        rows = span(6, accel=255, gear=10, rpm=8950.0)        # 0.1 s, under LIMITER_S
        self.assertEqual([x["fault"] for x in D.detect_gearing(rows, 9000.0, built_gears=10)], [])

    def test_no_redline_no_claim(self):
        self.assertEqual(D.detect_gearing(span(100, gear=10), None, built_gears=10), [])


class BrakeLockTest(unittest.TestCase):
    def test_shallow_and_brief_is_ordinary_hard_braking(self):
        """The measured majority case: 3-5 samples at 0.7-0.85. Must never be a fault."""
        rows = span(4, brake=255, wheel_frac=0.80) + span(60, brake=0)
        self.assertEqual(D.detect_brake_lock(rows, RADII), [])

    def test_deep_and_brief_is_a_fault(self):
        rows = span(4, brake=255, wheel_frac=0.30) + span(60, brake=0)
        f = D.detect_brake_lock(rows, RADII)
        self.assertEqual(len(f), 1)
        self.assertLess(f[0]["measure"]["worst_ratio"], D.LOCK_FAULT_RATIO)

    def test_shallow_but_held_is_a_fault(self):
        rows = span(30, brake=255, wheel_frac=0.80)            # 0.5 s, over LOCK_FAULT_S
        f = D.detect_brake_lock(rows, RADII)
        self.assertEqual(len(f), 1)
        self.assertGreaterEqual(f[0]["measure"]["held_s"], D.LOCK_FAULT_S)

    def test_one_sample_is_never_a_lock(self):
        rows = span(1, brake=255, wheel_frac=0.1) + span(60, brake=0)
        self.assertEqual(D.detect_brake_lock(rows, RADII), [])

    def test_partial_braking_is_not_examined(self):
        """The claim is about FULL pedal; trail-braking slip is a different question."""
        rows = span(60, brake=120, wheel_frac=0.3)
        self.assertEqual(D.detect_brake_lock(rows, RADII), [])

    def test_low_speed_is_not_examined(self):
        rows = span(60, brake=255, wheel_frac=0.3, speed_ms=5.0)
        self.assertEqual(D.detect_brake_lock(rows, RADII), [])

    def test_axle_is_identified(self):
        rows = span(30, brake=255, wheel_frac=1.0)
        for r in rows:                                          # only the front pair locks
            for w in ("FL", "FR"):
                r["WheelRotSpeed" + w] = (r["Speed"] * 0.3) / RAD
        f = D.detect_brake_lock(rows, RADII)
        self.assertEqual(f[0]["measure"]["end"], "front")
        self.assertIn("rearward", f[0]["fix"])

    def test_shallow_excursions_are_counted_not_hidden(self):
        """The ones ruled out as ordinary braking are still reported as context, as a TOTAL."""
        rows = (span(4, brake=255, wheel_frac=0.80) + span(30, brake=0)
                + span(4, brake=255, wheel_frac=0.80) + span(30, brake=0)
                + span(30, brake=255, wheel_frac=0.30))
        f = D.detect_brake_lock(rows, RADII)
        self.assertEqual(len(f), 1)
        self.assertEqual(f[0]["shallow_excursions"], 2)

    def test_no_radii_no_claim(self):
        self.assertEqual(D.detect_brake_lock(span(60, brake=255, wheel_frac=0.2), {}), [])


class BottomingTest(unittest.TestCase):
    def test_on_the_stop_at_speed(self):
        rows = span(10, susp=0.99, speed_ms=40.0)
        f = D.detect_bottoming(rows)
        self.assertEqual(len(f), 4)                             # one per wheel, coalesced in time
        self.assertTrue(all(x["fault"] == "bottoming" for x in f))

    def test_below_the_gate_is_not_bottoming(self):
        self.assertEqual(D.detect_bottoming(span(10, susp=0.97, speed_ms=40.0)), [])

    def test_low_speed_bottoming_is_a_kerb_not_ride_height(self):
        self.assertEqual(D.detect_bottoming(span(10, susp=0.99, speed_ms=10.0)), [])

    def test_repeat_hits_coalesce_into_one_incident_per_wheel(self):
        rows = span(60, susp=0.99, speed_ms=40.0)               # 1 s of continuous contact
        self.assertEqual(len(D.detect_bottoming(rows)), 8)      # two incidents per wheel at 0.6 s apart

    def test_the_fix_names_the_axle(self):
        rows = span(5, susp=0.5, speed_ms=40.0)
        for r in rows:
            r["NormSuspRL"] = 0.99
        f = D.detect_bottoming(rows)
        self.assertEqual(len(f), 1)
        self.assertIn("rear ride height", f[0]["fix"])


class GateConsistencyTest(unittest.TestCase):
    def test_bottom_gate_agrees_across_all_three_copies(self):
        """The gate is restated in three modules. If they drift, the severity scales stop meaning
        the same thing and 'bottoming' means something different depending on who asked."""
        import analyze_session
        import import_diagnosis
        self.assertEqual(D.BOTTOM_GATE, analyze_session.BOTTOM_GATE)
        self.assertEqual(D.BOTTOM_GATE, import_diagnosis.BOTTOM_TRAVEL)

    def test_full_pedal_matches_the_analyzers_wot_cut(self):
        self.assertEqual(D.FULL_PEDAL, 230)


if __name__ == "__main__":
    unittest.main()
