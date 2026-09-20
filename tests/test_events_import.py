import copy
import json
import os
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _helpers as H

import fh6db
import import_events as ev

STRINGS_PATH = os.path.join(H.ROOT, "data", "game-strings", "RivalsEventData.json")
ROUTES_PATH = os.path.join(H.ROOT, "data", "rivals-routes-road.json")


class EventsImportTest(unittest.TestCase):
    """import_events.gather() against a temp copy of the real Rivals catalogue -- ref_string is
    seeded from data/game-strings/RivalsEventData.json exactly as import_gamedb.py would key it
    (key_hash = fh6db.strhash(key_name)), so every guid join gather() performs is the real one."""

    def setUp(self):
        self.cx, self.db_path = H.new_db()
        self.tmpdir = tempfile.mkdtemp(prefix="fh6_test_events_")

        with open(STRINGS_PATH, encoding="utf-8") as fh:
            self.strings = json.load(fh)
        H.insert(self.cx, "ref_string_table", ["table_name", "name_hash", "n_entries", "has_csv"],
                 ("RivalsEventData", fh6db.strhash("RivalsEventData"), len(self.strings), 0))
        rows = [("RivalsEventData", fh6db.strhash(k), k, v) for k, v in self.strings.items()]
        fh6db.upsert_many(self.cx, "ref_string", ["table_name", "key_hash", "key_name", "content"], rows)
        self.cx.commit()

        with open(ROUTES_PATH, encoding="utf-8") as fh:
            self.routes_doc = json.load(fh)

    def tearDown(self):
        H.close_db(self.cx, self.db_path)
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def _write_routes(self, doc, name="rivals-routes-road.json"):
        path = os.path.join(self.tmpdir, name)
        H.jwrite(path, doc)
        return path

    def test_23_events_161_names_all_guids_resolve(self):
        path = self._write_routes(self.routes_doc)
        erows, esrows = ev.gather(self.cx, path, {})

        self.assertEqual(len(erows), 23)
        names = [r for r in esrows if r[4] == "name"]
        self.assertEqual(len(names), 161)

        name_by_event = {r[0]: r[2] for r in erows}
        for event_id, table_name, key_hash, key_name, role in names:
            row = self.cx.execute(
                "SELECT content FROM ref_string WHERE table_name=? AND key_hash=?",
                (table_name, key_hash)).fetchone()
            self.assertIsNotNone(row, "guid %s not in ref_string" % key_name)
            self.assertEqual(row["content"], name_by_event[event_id])

    def test_corrupted_guid_raises(self):
        doc = copy.deepcopy(self.routes_doc)
        g = doc["routes"][0]["ids_name_guids"][0]
        doc["routes"][0]["ids_name_guids"][0] = ("0" if g[0] != "0" else "1") + g[1:]
        path = self._write_routes(doc, name="rivals-routes-road-corrupt.json")

        with self.assertRaises(ValueError):
            ev.gather(self.cx, path, {})


if __name__ == "__main__":
    unittest.main()
