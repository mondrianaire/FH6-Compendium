import os
import shutil
import sys
import tempfile
import unittest
import uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _helpers as H

import fh6db
import import_telemetry


class CourseRouteSurvivesTelemetryTest(unittest.TestCase):
    """course_route (and course_event) hang off course(route_key) ON DELETE CASCADE. A telemetry
    rerun must MERGE course, never DELETE+reinsert it, or every match a prior course_match /
    route_names run computed vanishes underneath it (the bug fixed 2026-09-05)."""

    def setUp(self):
        self.cx, self.db_path = H.new_db()
        self.data_dir = os.path.join(tempfile.gettempdir(), "fh6_test_data_%s" % uuid.uuid4().hex)
        os.makedirs(os.path.join(self.data_dir, "courses"))
        os.makedirs(os.path.join(self.data_dir, "sessions"))
        self.rk = "test_route_1"

        H.insert(self.cx, "ref_event", ["event_id", "kind", "name", "length_m", "is_loop"],
                 ("rivals:kept", "rivals", "Kept Circuit", 1000.0, 1))
        H.insert(self.cx, "course", [
            "route_key", "name", "declared_name", "declared_source", "length_m",
            "name_source", "name_confidence", "event_id"],
            (self.rk, "Kept Circuit", "Kept Circuit", "routes.json", 1000.0,
             "derived:map", "verified", "rivals:kept"))
        H.insert(self.cx, "course_route", [
            "route_key", "route_id", "match_kind", "computed_utc"],
            (self.rk, None, "verified", fh6db.utcnow()))
        H.insert(self.cx, "course_event", [
            "route_key", "event_id", "tier", "chosen", "computed_utc"],
            (self.rk, "rivals:kept", "map", 1, fh6db.utcnow()))
        self.cx.commit()

    def tearDown(self):
        H.close_db(self.cx, self.db_path)
        shutil.rmtree(self.data_dir, ignore_errors=True)

    def _write_model(self):
        H.jwrite(os.path.join(self.data_dir, "courses", self.rk + ".json"),
                  {"route_key": self.rk})

    def test_survives_when_model_present(self):
        self._write_model()
        import_telemetry.run(self.cx, data_dir=self.data_dir)
        self.assertEqual(
            H.dump(self.cx, "SELECT route_key FROM course_route WHERE route_key=?", self.rk),
            [(self.rk,)])
        self.assertEqual(
            H.dump(self.cx, "SELECT COUNT(*) FROM course WHERE route_key=?", self.rk),
            [(1,)])
        # the row survived by MERGE, not by luck -- its pre-existing identity is still there
        self.assertEqual(
            H.dump(self.cx, "SELECT match_kind FROM course_route WHERE route_key=?", self.rk),
            [("verified",)])
        self.assertEqual(
            H.dump(self.cx, "SELECT COUNT(*) FROM course_event WHERE route_key=?", self.rk),
            [(1,)])

    def test_cascades_when_model_removed(self):
        self._write_model()
        import_telemetry.run(self.cx, data_dir=self.data_dir)
        self.assertEqual(
            H.dump(self.cx, "SELECT COUNT(*) FROM course_route WHERE route_key=?", self.rk),
            [(1,)])

        os.remove(os.path.join(self.data_dir, "courses", self.rk + ".json"))
        import_telemetry.run(self.cx, data_dir=self.data_dir)

        self.assertEqual(
            H.dump(self.cx, "SELECT COUNT(*) FROM course WHERE route_key=?", self.rk),
            [(0,)])
        self.assertEqual(
            H.dump(self.cx, "SELECT COUNT(*) FROM course_route WHERE route_key=?", self.rk),
            [(0,)])
        self.assertEqual(
            H.dump(self.cx, "SELECT COUNT(*) FROM course_event WHERE route_key=?", self.rk),
            [(0,)])


if __name__ == "__main__":
    unittest.main()
