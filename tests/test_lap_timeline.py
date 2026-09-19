import csv
import os
import sys
import tempfile
import unittest
import uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _helpers as H  # noqa: F401  (path setup)

import analyze_session as A


def row(t, race, dist, lap_s, lapn, car=1000, on=1, last=0.0, wall=None, mono=None):
    return {"t": t, "t_mono": mono if mono is not None else t, "t_wall": wall if wall is not None else 1000.0 + t,
            "IsRaceOn": on, "CurrentRaceTime": race, "DistanceTraveled": dist, "CurrentLap": lap_s,
            "LapNumber": lapn, "LastLap": last, "CarOrdinal": car, "DrivetrainType": 2, "NumCylinders": 8,
            "CarPI": 800, "PosX": dist, "PosZ": 0.0, "speed_mph": 60.0}


def drive(t0, race0, dist0, lap0, lapn, n, dt=0.1, v=30.0):
    """n frames of steady driving: 10 Hz, 30 m/s."""
    out = []
    for k in range(n):
        out.append(row(t0 + k * dt, race0 + k * dt, dist0 + k * dt * v, lap0 + k * dt, lapn))
    return out


class FinalTimelineTest(unittest.TestCase):
    def test_no_rewind_keeps_everything(self):
        rows = drive(0, 0, 0, 0.1, 0, 100)
        kept, markers = A.final_timeline(rows)
        self.assertEqual(len(kept), 100)
        self.assertEqual(markers, [])

    def test_mid_lap_rewind_revokes_the_undone_stretch(self):
        a = drive(0, 0, 0, 0.1, 0, 100)                     # race 0..9.9 s, x 0..297
        hold = [row(10.0, 9.9, 297, -5000.0, 0)]            # the hold frame, then 6 s of nothing
        b = drive(16.0, 5.0, 150, 5.1, 0, 60)               # landed at x=150 (race 5.0)
        kept, markers = A.final_timeline(a + hold + b)
        self.assertEqual(len(markers), 1)
        m = markers[0]
        self.assertEqual(m["kind"], "rewind")
        self.assertAlmostEqual(m["race_s_from"], 9.9)
        self.assertAlmostEqual(m["race_s_to"], 5.0, places=1)
        self.assertFalse(m["over_line"])
        race = [r["CurrentRaceTime"] for r in kept]
        self.assertEqual(race, sorted(race))               # monotonic race clock: the undone stretch is gone
        self.assertLess(max(race[:len(race) - 60]), 5.05)  # nothing beyond the landing point survives before the redo
        self.assertEqual(A.pause_markers(kept), [])        # the splice is the rewind's, not a pause
        self.assertAlmostEqual(m["race_rebase_s"], 0.0, places=2)

    def test_rewind_over_the_line_re_times_the_lap(self):
        lap1 = drive(0, 0, 0, 0.1, 0, 300)                  # 30 s lap 1
        cross = [row(30.0, 30.0, 900, 0.05, 1, last=30.0)]  # the game publishes LastLap and increments LapNumber
        early2 = drive(30.1, 30.1, 903, 0.15, 1, 50)        # 5 s into lap 2, then rewind back across the line
        for r in early2:
            r["LastLap"] = 30.0                              # the game keeps LastLap published through the next lap
        hold = [row(35.1, 35.0, 1050, -5000.0, 1, last=30.0)]   # the hold frame, then the silence of the scrub
        redo1 = drive(43.0, 27.0, 810, 27.1, 0, 30)         # landed 3 s before the line: lap 0 / 27.1 s, LastLap revoked
        cross2 = [row(46.0, 30.0, 900, 0.05, 1, last=29.9)]  # a NEW lap time
        lap2 = drive(46.1, 30.1, 903, 0.15, 1, 100)
        kept, markers = A.final_timeline(lap1 + cross + early2 + hold + redo1 + cross2 + lap2)
        self.assertEqual(len(markers), 1)
        self.assertTrue(markers[0]["over_line"])
        self.assertAlmostEqual(markers[0]["undone_s"], 5.05 + 30.0 - 27.1, places=2)   # 5.05 s of lap 2 + the 2.9 s of lap 1 re-driven
        self.assertLess(markers[0]["pos_gap_m"], 5)
        # exactly ONE lap boundary survives, and it carries the re-timed LastLap
        bounds = [b for a, b in zip(kept, kept[1:]) if A._is_lap_boundary(a, b)]
        self.assertEqual(len(bounds), 1)
        self.assertAlmostEqual(bounds[0]["LastLap"], 29.9)
        race = [r["CurrentRaceTime"] for r in kept]
        self.assertEqual(race, sorted(race))

    def test_restart_with_both_clocks_at_zero_is_not_a_rewind(self):
        attempt1 = drive(0, 0, 0, 0.1, 0, 200)
        attempt2 = drive(25.0, 0, 0, 0.1, 0, 200)           # a silence, both clocks back to the start: a restart
        kept, markers = A.final_timeline(attempt1 + attempt2)
        self.assertEqual(len(kept), 400)
        self.assertEqual(markers, [])

    def test_rewind_after_a_silence_with_the_sentinel_frame(self):
        # the shape the captures actually have: a hold frame with CurrentLap -5014.9, then 8 s of nothing,
        # then the landing row with both clocks wound back
        a = drive(0, 0, 0, 0.1, 0, 100)
        hold = [row(10.0, 10.0, 300, -5014.9, 0)]
        b = drive(18.0, 6.0, 180, 6.1, 0, 50)
        kept, markers = A.final_timeline(a + hold + b)
        self.assertEqual(len(markers), 1)
        self.assertAlmostEqual(markers[0]["silence_s"], 8.0, places=0)
        self.assertLess(markers[0]["pos_gap_m"], 5)
        self.assertFalse(any((r.get("CurrentLap") or 0) < 0 for r in kept))
        race = [r["CurrentRaceTime"] for r in kept]
        self.assertEqual(race, sorted(race))

    def test_revocation_follows_the_lap_clock_not_the_race_clock(self):
        # the capture's own shape: the landing row's race clock names a kept row 493 m back up the road,
        # its LAP clock names the row the car is actually standing on -- the game's lap metadata is canon
        a = drive(0, 0, 0, 0.1, 0, 200)                     # race 0..19.9, lap 0.1..20.0, x 0..597
        hold = [row(20.0, 19.9, 597, -5000.0, 0)]
        land = drive(28.0, 12.0, 450, 15.0, 0, 30)          # race says 12 s (x=360), lap says 15.0 s (x=447), the car is at x=450
        kept, markers = A.final_timeline(a + hold + land)
        xs = [r["PosX"] for r in kept]
        self.assertEqual(xs, sorted(xs))
        self.assertLessEqual(max(x for x in xs[:len(xs) - 30]), 450.5)
        self.assertGreater(max(r["CurrentRaceTime"] for r in kept[:len(kept) - 30]), 12.0)   # the race clock was not the axis
        laps = [r["CurrentLap"] for r in kept]
        self.assertEqual(laps, sorted(laps))               # the lap clock is monotonic on the final line
        self.assertEqual(len(markers), 1)
        self.assertTrue(markers[0]["on_line"])
        self.assertAlmostEqual(markers[0]["undone_s"], 5.0, places=2)

    def test_race_clock_rebase_across_a_pause_is_not_a_rewind(self):
        # seen on 232556 at 4169.9 s: an 8.3 s menu pause after which the race clock read 3.43 s LOWER while
        # the lap clock, odometer and position all carried straight on -- the lap is intact
        a = drive(0, 90.0, 5000, 10.0, 1, 100)              # lap 1, 10.0..19.9 s
        b = drive(18.2, 96.5, 5297, 19.97, 1, 50)           # race 99.9 -> 96.5; lap 19.9 -> 19.97; 3 m on
        kept, markers = A.final_timeline(a + b)
        self.assertEqual(len(kept), 150)
        self.assertEqual(markers, [])
        pm = A.pause_markers(kept)
        self.assertEqual([m["kind"] for m in pm], ["pause"])
        self.assertAlmostEqual(pm[0]["race_rebase_s"], -3.4, places=1)

    def test_lap_clock_clearing_is_never_a_rewind(self):
        # a lap boundary (LapNumber +1) and an event tear-down (LapNumber unchanged, LastLap unchanged)
        # both clear the lap clock; neither revokes anything
        a = drive(0, 0, 0, 0.1, 0, 100)
        bound = drive(10.0, 10.0, 300, 0.02, 1, 20)
        kept, markers = A.final_timeline(a + bound)
        self.assertEqual((len(kept), markers), (120, []))
        tear = [row(10.0, 10.0, 300, 0.01, 0)]
        kept, markers = A.final_timeline(a + tear)
        self.assertEqual((len(kept), markers), (101, []))

    def test_new_event_same_car_is_a_start_not_a_rewind(self):
        # 232556 at 2420 s: lap 1 / 26.1 s -> lap 0 / 0.00 s, odometer 8057 -> 0, race clock still climbing
        ev1 = drive(0, 100.0, 5000, 20.0, 1, 100)
        ev2 = drive(600.0, 134.7, 0, 0.0, 0, 100)
        kept, markers = A.final_timeline(ev1 + ev2)
        self.assertEqual((len(kept), markers), (200, []))

    def test_new_event_first_row_past_the_light_is_still_a_start(self):
        # review 2026-09-06: event B (same car, same start line) whose first captured row already reads
        # lap 1.2 s / 5.5 m must not be read as a rewind into event A's launch
        ev1 = drive(0, 0, 0, 0.1, 0, 300) + [row(30.0, 30.0, 900, 0.05, 1, last=30.0)] + drive(30.1, 30.1, 903, 0.15, 1, 300)
        ev2 = drive(700.0, 3.2, 5.5, 1.2, 0, 100)
        for k, r in enumerate(ev2):
            r["PosX"] = 33.0 + k * 3.0                       # A stood at x=33 when its own lap clock read 1.2 s
        kept, markers = A.final_timeline(ev1 + ev2)
        self.assertEqual((len(kept), markers), (701, []))

    def test_quitting_to_free_roam_is_not_a_rewind(self):
        # the game hands the car back to the spot the event was launched from -- ON the driven line
        roam = drive(0, 88000.0, 3000, 0.0, 0, 20)
        for r in roam:
            r["CurrentLap"] = 0.0
        ev = drive(30.0, 0, 0, 0.1, 0, 300) + [row(60.0, 30.0, 900, 0.05, 1, last=30.0)] + drive(60.1, 30.1, 903, 0.15, 1, 100)
        back = drive(400.0, 88500.0, 3060, 0.0, 0, 20)
        for r in back:
            r["CurrentLap"] = 0.0
            r["PosX"] = 57.0                                 # exactly where roam ended
        kept, markers = A.final_timeline(roam + ev + back)
        self.assertEqual((len(kept), markers), (441, []))

    def test_rewind_before_the_stints_first_kept_row(self):
        # car B's capture opens mid-lap; the driver rewinds to before the first captured row: everything
        # B drove so far is gone, the marker says the cut was the stint, not a row on the line
        a = drive(0, 0, 0, 0.1, 0, 50, )
        b = drive(5.0, 20.0, 600, 20.0, 1, 40)
        for r in b:
            r["CarOrdinal"] = 2000
        hold = [row(9.0, 23.9, 717, -5000.0, 1, car=2000)]
        land = drive(15.0, 12.0, 360, 12.0, 1, 30)
        for r in land:
            r["CarOrdinal"] = 2000
        kept, markers = A.final_timeline(a + b + hold + land)
        self.assertEqual(len(markers), 1)
        self.assertEqual(markers[0]["cut"], "stint")
        self.assertIsNone(markers[0]["on_line"])
        self.assertEqual(markers[0]["rows"], 40)
        self.assertEqual([r["CarOrdinal"] for r in kept], [1000] * 50 + [2000] * 30)

    def test_free_roam_rewind_is_nothing(self):
        # lap clock idle, the session clock goes back: nothing is timed there, nothing is revoked
        a = drive(0, 88000.0, 0, 0.0, 0, 100)
        hold = [row(10.0, 88009.9, 297, -5000.0, 0)]
        land = drive(18.0, 88006.0, 180, 0.0, 0, 30)
        for r in a + land:
            r["CurrentLap"] = 0.0
        kept, markers = A.final_timeline(a + hold + land)
        self.assertEqual((len(kept), markers), (130, []))

    def test_an_odometer_reset_with_the_clock_running_is_not_a_rewind(self):
        a = drive(0, 0, 0, 0.1, 0, 100)
        b = [row(10.0 + k * 0.1, 10.0 + k * 0.1, k * 3.0, 10.1 + k * 0.1, 0) for k in range(50)]   # odometer back to 0, clock continuous
        for k, r in enumerate(b):
            r["PosX"] = 300 + k * 3.0
        kept, markers = A.final_timeline(a + b)
        self.assertEqual(len(kept), 150)
        self.assertEqual(markers, [])

    def test_landing_off_the_driven_line_is_flagged_not_revoked(self):
        a = drive(0, 0, 0, 0.1, 0, 100)                     # x 0..297
        hold = [row(10.0, 9.9, 297, -5000.0, 0)]
        land = drive(15.0, 6.0, 180, 6.1, 0, 20)
        for r in land:
            r["PosZ"] = 500.0                                # nowhere near the kept line
        kept, markers = A.final_timeline(a + hold + land)
        self.assertEqual(len(markers), 1)
        self.assertFalse(markers[0]["on_line"])
        self.assertEqual(markers[0]["rows"], 0)
        self.assertEqual(len(kept), 120)

    def test_checkpoint_respawn_is_a_jump_marker(self):
        a = drive(0, 0, 0, 0.1, 0, 100)                     # x 0..297
        b = drive(10.0, 10.0, 300, 10.1, 0, 50)
        for r in b:
            r["PosZ"] = 400.0                                # the game put the car back on the course, lap clock running
        kept, markers = A.final_timeline(a + b)
        self.assertEqual(markers, [])
        pm = A.pause_markers(kept)
        self.assertEqual([m["kind"] for m in pm], ["jump"])
        self.assertGreaterEqual(pm[0]["jump_m"], 400)

    def test_three_rewinds_of_one_corner_are_three_markers(self):
        rows = drive(0, 0, 0, 0.1, 0, 100)
        for k in range(3):
            t = rows[-1]["t"]
            rows += [row(t + 0.1, 6.0, 180, 6.1, 0)]        # each time back to race 6.0
            rows += drive(t + 0.2, 6.1, 183, 6.2, 0, 40)
        kept, markers = A.final_timeline(rows)
        self.assertEqual([m["kind"] for m in markers], ["rewind"] * 3)
        race = [r["CurrentRaceTime"] for r in kept]
        self.assertEqual(race, sorted(race))


class PauseMarkersTest(unittest.TestCase):
    def test_menu_pause_mid_lap(self):
        a = drive(0, 0, 0, 0.1, 0, 50)
        b = drive(65.0, 5.0, 150, 5.1, 0, 50)                # 60 s silence, game clock frozen at 5.0
        ms = A.pause_markers(a + b)
        self.assertEqual(len(ms), 1)
        self.assertEqual(ms[0]["kind"], "pause")
        self.assertAlmostEqual(ms[0]["dur_s"], 60.1, places=0)

    def test_dropout_with_the_clock_running_is_a_gap(self):
        a = drive(0, 0, 0, 0.1, 0, 50)
        b = drive(8.0, 8.0, 240, 8.1, 0, 50)                 # 3 s silence, but the race clock advanced 3 s
        ms = A.pause_markers(a + b)
        self.assertEqual(ms[0]["kind"], "gap")
        fast = drive(0, 0, 0, 0.1, 0, 50, v=50.0)            # 4 s dropout at 50 m/s: 200 m on, still a gap
        fast += drive(9.0, 9.0, 450, 9.1, 0, 50, v=50.0)
        ms = A.pause_markers(fast)
        self.assertEqual([m["kind"] for m in ms], ["gap"])

    def test_event_boundary_is_not_a_pause(self):
        a = drive(0, 0, 0, 0.1, 0, 50)
        b = drive(30.0, 0, 0, 0.1, 0, 50)                    # silence, then everything reset: a new attempt
        self.assertEqual(A.pause_markers(a + b), [])


class StitchTest(unittest.TestCase):
    """A lap cut by the capture roll is rebuilt from the previous file's tail."""

    def setUp(self):
        self.dir = os.path.join(tempfile.gettempdir(), "fh6_stitch_%s" % uuid.uuid4().hex)
        os.makedirs(self.dir)

    def tearDown(self):
        for f in os.listdir(self.dir):
            os.remove(os.path.join(self.dir, f))
        os.rmdir(self.dir)

    def _write(self, name, rows):
        cols = ["t_wall", "t_mono", "speed_mph", "IsRaceOn", "CurrentRaceTime", "DistanceTraveled", "CurrentLap",
                "LapNumber", "LastLap", "CarOrdinal", "DrivetrainType", "NumCylinders", "CarPI", "PosX", "PosZ"]
        with open(os.path.join(self.dir, name), "w", newline="") as fh:
            w = csv.writer(fh)
            w.writerow(cols)
            for r in rows:
                w.writerow([r[c] for c in cols])

    def test_lap_continues_from_previous_file(self):
        prev = drive(0, 0, 0, 0.1, 0, 100)                                        # lap 1 (10 s), then lap 2 opens
        prev += [row(10.0, 10.0, 300, 0.05, 1, last=10.0)] + drive(10.1, 10.1, 303, 0.15, 1, 40)
        cur = drive(14.1, 14.1, 423, 4.15, 1, 100)                                 # the same lap 2, second file
        for r in prev:
            r["t_wall"] = 5000.0 + r["t"]; r["t_mono"] = 100.0 + r["t"]
        for r in cur:
            r["t_wall"] = 5000.0 + r["t"]; r["t_mono"] = 100.0 + r["t"]
        self._write("fh6_20260901_000000.csv", prev)
        self._write("fh6_20260901_000100.csv", cur)
        path = os.path.join(self.dir, "fh6_20260901_000100.csv")
        rows = A.load(path)
        out, note = A.stitch_previous_capture(path, rows)
        self.assertIsNotNone(note)
        self.assertEqual(note["rows"], 41)                                          # from the lap-2 boundary row onward
        self.assertEqual(len(out), 141)
        self.assertLess(out[0]["t_mono"], rows[0]["t_mono"])
        self.assertAlmostEqual(out[0]["CurrentLap"], 0.05)

    def test_stitch_reads_the_previous_files_final_line(self):
        # review 2026-09-06: a rewind near the end of the previous file must neither stop the walk at
        # the hold sentinel nor carry the sentinel row into the recovered opening
        prev = drive(0, 0, 0, 0.1, 0, 400)                                        # lap 1: 40 s, x 0..1197
        prev += [row(40.0, 39.9, 1197, -5014.9, 0)]                               # hold, then the scrub
        prev += drive(48.0, 20.0, 600, 20.1, 0, 100)                              # landed at 20.1 s, x 600; drove to 30.0 s
        cur = drive(58.0, 30.0, 900, 30.1, 0, 100)                                # the same lap, second file
        for r in prev + cur:
            r["t_wall"] = 5000.0 + r["t"]; r["t_mono"] = 100.0 + r["t"]
        self._write("fh6_20260901_000000.csv", prev)
        self._write("fh6_20260901_000100.csv", cur)
        path = os.path.join(self.dir, "fh6_20260901_000100.csv")
        rows = A.load(path)
        out, note = A.stitch_previous_capture(path, rows)
        self.assertIsNotNone(note)
        self.assertAlmostEqual(out[0]["CurrentLap"], 0.1)                         # from the lap's own start
        self.assertFalse(any((r.get("CurrentLap") or 0) < 0 for r in out))
        laps = [r["CurrentLap"] for r in out]
        self.assertEqual(laps, sorted(laps))                                      # the revoked 20.1..39.9 stretch is gone
        self.assertEqual(note["rows"], 201 + 100)                                 # 0.1..20.0 (200) + the cut row + the re-drive (100)

    def test_no_stitch_when_the_file_opens_at_a_lap_start(self):
        prev = drive(0, 0, 0, 0.1, 0, 50)
        cur = drive(20.0, 0, 0, 0.1, 0, 50)
        for r in prev + cur:
            r["t_wall"] = 5000.0 + r["t"]; r["t_mono"] = 100.0 + r["t"]
        self._write("fh6_20260901_000000.csv", prev)
        self._write("fh6_20260901_000100.csv", cur)
        path = os.path.join(self.dir, "fh6_20260901_000100.csv")
        out, note = A.stitch_previous_capture(path, A.load(path))
        self.assertIsNone(note)
        self.assertEqual(len(out), 50)


if __name__ == "__main__":
    unittest.main()
