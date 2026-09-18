"""The confidence gates are arithmetic that decides what the dashboard is allowed to claim.

Silent breakage here does not throw -- it just starts recommending spring changes off four laps,
which is the exact failure the module exists to prevent. So the gates get tests: the boundaries,
the two evidence classes, the driver confound, and above all the distinction between "we do not
know yet" and "we know it is not a problem".
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _helpers as H  # noqa: F401  (path setup)

import confidence as C


class WilsonTest(unittest.TestCase):
    def test_known_interval(self):
        """43/61, hand-checked against the Wilson formula: (0.58108, 0.80445)."""
        lo, hi = C.wilson(43, 61)
        self.assertAlmostEqual(lo, 0.58108, places=4)
        self.assertAlmostEqual(hi, 0.80445, places=4)

    def test_zero_hits_still_bounds_above(self):
        """k=0 must not collapse to (0,0): 'never seen in 8 passes' is not 'cannot happen'."""
        lo, hi = C.wilson(0, 8)
        self.assertEqual(lo, 0.0)
        self.assertGreater(hi, 0.25)
        self.assertLess(C.wilson(0, 60)[1], hi)     # more passes, tighter ceiling

    def test_more_hits_than_trials_does_not_throw(self):
        """Real data delivers k > n through diag_event's container attribution. Clamp, never raise."""
        lo, hi = C.wilson(80, 39)
        self.assertLessEqual(hi, 1.0)
        self.assertGreater(lo, 0.8)
        a = C.assess(80, 39, evidence_class="deterministic", severity=1.0)
        self.assertEqual(a["verdict"], C.REPORT)
        self.assertLessEqual(a["rate"], 1.0)

    def test_no_trials_is_total_ignorance(self):
        self.assertEqual(C.wilson(0, 0), (0.0, 1.0))


class NeededNTest(unittest.TestCase):
    def test_a_rate_below_the_floor_is_unreachable(self):
        """2 in 61 cannot clear a 20% floor however long you drive, and must say so with None."""
        self.assertIsNone(C.needed_n(2, 61))

    def test_a_rate_above_the_floor_returns_a_finite_target(self):
        n = C.needed_n(17, 61)
        self.assertIsNotNone(n)
        self.assertGreater(n, 61)


class VerdictTest(unittest.TestCase):
    def test_strong_recurrent_fault_reports(self):
        a = C.assess(43, 61)
        self.assertEqual(a["verdict"], C.REPORT)
        self.assertGreaterEqual(a["lo"], C.P_FLOOR)

    def test_three_laps_never_reports(self):
        """The headline rule: no tendency is claimable off a handful of passes, however clean."""
        for k in range(4):
            a = C.assess(k, 3)
            self.assertNotEqual(a["verdict"], C.REPORT, "%d/3 must not report" % k)

    def test_ignorance_and_settled_negative_are_different_verdicts(self):
        few = C.assess(1, 3)                      # too few passes to know anything
        many = C.assess(2, 61)                    # plenty of passes, genuinely rare
        self.assertEqual(few["verdict"], C.INSUFFICIENT)
        self.assertEqual(many["verdict"], C.NOT_RECURRENT)
        self.assertIsNone(many["needs_laps"])     # more driving cannot change it
        self.assertIsNotNone(few["needs_laps"])   # more driving can

    def test_never_seen_is_settled_only_with_enough_passes(self):
        self.assertEqual(C.assess(0, 60)["verdict"], C.NOT_RECURRENT)
        self.assertEqual(C.assess(0, 2)["verdict"], C.INSUFFICIENT)

    def test_deterministic_severe_reports_on_one_occurrence(self):
        """Jett's standing directive: bottoming raises the flag immediately, not after a sample."""
        a = C.assess(1, 61, evidence_class="deterministic", severity=1.0)
        self.assertEqual(a["verdict"], C.REPORT)

    def test_deterministic_mild_is_watched_not_reported(self):
        a = C.assess(1, 61, evidence_class="deterministic", severity=0.4)
        self.assertEqual(a["verdict"], C.WATCHING)

    def test_same_evidence_statistical_would_not_report(self):
        """The class is what earns the n=1 flag -- the counts alone must not."""
        self.assertNotEqual(C.assess(1, 61)["verdict"], C.REPORT)

    def test_wide_interval_is_watched_even_above_the_floor(self):
        a = C.assess(8, 9)                        # lo clears the floor, but 47-99% sizes no fix
        self.assertEqual(a["verdict"], C.WATCHING)
        self.assertGreater(a["width"], C.WIDTH_MAX)


class DriverConfoundTest(unittest.TestCase):
    def test_speed_linked_fault_is_demoted(self):
        fast = [92.0, 94.0, 95.0, 93.0, 96.0, 94.0] * 5
        slow = [80.0, 82.0, 81.0, 83.0, 79.0, 81.0] * 5
        a = C.assess(30, 60, hit_entry_mph=fast, miss_entry_mph=slow)
        self.assertTrue(a["driver_linked"])
        self.assertEqual(a["verdict"], C.WATCHING)

    def test_same_counts_without_the_speed_split_report(self):
        same = [86.0, 87.0, 85.0, 88.0, 86.0, 87.0] * 5
        a = C.assess(30, 60, hit_entry_mph=same, miss_entry_mph=list(same))
        self.assertFalse(a["driver_linked"])
        self.assertEqual(a["verdict"], C.REPORT)

    def test_deterministic_faults_skip_the_driver_test(self):
        """A suspension on its stop is on its stop whatever speed it arrived at."""
        fast = [92.0, 94.0, 95.0, 93.0, 96.0, 94.0] * 5
        slow = [80.0, 82.0, 81.0, 83.0, 79.0, 81.0] * 5
        a = C.assess(30, 60, evidence_class="deterministic", severity=0.9,
                     hit_entry_mph=fast, miss_entry_mph=slow)
        self.assertFalse(a["driver_linked"])


class PhrasingTest(unittest.TestCase):
    def test_watching_never_reads_as_advice(self):
        a = C.assess(1, 61, evidence_class="deterministic", severity=0.4)
        s = C.phrase(a, "Bottoming", "T5")
        self.assertIn("Watching", s)
        self.assertIn("Not a tuning recommendation", s)

    def test_report_states_the_lower_bound_not_the_point_estimate(self):
        a = C.assess(43, 61)
        s = C.phrase(a, "Understeer mid-corner", "T102")
        self.assertIn("at least", s)
        self.assertNotIn("70%", s)               # the point estimate must not be the headline

    def test_ruled_out_is_stated_as_settled(self):
        s = C.phrase(C.assess(2, 61), "Oversteer on exit", "T9")
        self.assertIn("Ruled out", s)
        self.assertIn("settled", s)


if __name__ == "__main__":
    unittest.main()
