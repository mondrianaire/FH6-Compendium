import os
import sys
import tempfile
import unittest
import uuid
import zipfile
import xml.etree.ElementTree as ET

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _helpers as H

import fh6_bxml
import import_objectmodel as om
import import_route_names as rn


def prop(parent, pid, value=None):
    e = ET.SubElement(parent, "property", id=pid)
    if value is not None:
        e.set("value", value)
    return e


def ref(parent, pid, key):
    e = prop(parent, pid)
    prop(e, "Key", key)
    return e


def dataset(type_id, rows, data_id="Data"):
    """rows: [(key, {prop: value | ('ref', key)})] -> the <om> document the game ships."""
    root = ET.Element("om", version="0.1", rootId="1.2")
    obj = ET.SubElement(root, "object", id="1.2", type=type_id)
    data = prop(obj, data_id)
    for key, props in rows:
        me = ET.SubElement(data, "map_element")
        ET.SubElement(me, "key", value=str(key))
        v = ET.SubElement(me, "value")
        for k, val in props.items():
            if isinstance(val, tuple):
                ref(v, k, val[1])
            else:
                prop(v, k, str(val))
    return root


def manifest(entries):
    root = ET.Element("OMManifest", type="OMManifest")
    prop(root, "DomainId", "zip")
    items = prop(root, "ItemData")
    for fid, type_id in entries:
        me = ET.SubElement(items, "map_element")
        ET.SubElement(me, "key", type="ulong", value=fid)
        v = ET.SubElement(me, "value", type="ManifestObjectData")
        prop(v, "FileName", "ScribbleData\\%s.om.xml" % fid)
        prop(v, "TypeId", type_id)
        prop(v, "SourcePath", "")
    return root


class BxmlRoundTripTest(unittest.TestCase):
    def test_build_then_parse(self):
        root = dataset("X", [(1, {"A": "1", "B": ("ref", "k")})])
        again = fh6_bxml.parse(fh6_bxml.build(root))
        self.assertEqual(fh6_bxml.to_text(root), fh6_bxml.to_text(again))

    def test_wide_string_table_uses_u16_indices(self):
        root = ET.Element("r")
        for i in range(300):
            ET.SubElement(root, "c%d" % i, v=str(i))
        again = fh6_bxml.parse(fh6_bxml.build(root))
        self.assertEqual(len(again), 300)
        self.assertEqual(again[299].get("v"), "299")


class ObjectModelImportTest(unittest.TestCase):
    """A two-route catalogue: one Rivals name with two class variants bound through a
    collection and a career race to a track and its route; one career-only track."""

    def setUp(self):
        self.cx, self.db_path = H.new_db()
        cx = self.cx
        S = [("CareerTrackInfo", 1, "IDS_DisplayName_aaaa", "Alpha Circuit"),
             ("CareerTrackInfo", 2, "IDS_Description_aaad", "A lap of alpha."),
             ("CareerTrackInfo", 3, "IDS_DisplayName_bbbb", "Beta Sprint"),
             ("CareerRaceCollection", 4, "IDS_Name_cccc", "Alpha Exhibition"),
             ("CareerRace", 5, "IDS_Name_dddd", "Alpha Circuit"),
             ("CareerRace", 6, "IDS_Name_eeee", "Beta Sprint"),
             ("CareerRaceCollection", 7, "IDS_Name_ffff", "Beta Exhibition"),
             ("RivalsEventData", 8, "IDS_Name_r1", "Alpha Circuit"),
             ("RivalsEventData", 9, "IDS_Name_r2", "Alpha Circuit")]
        for i, t in enumerate(sorted({x[0] for x in S})):
            H.insert(cx, "ref_string_table", ["table_name", "name_hash", "n_entries", "has_csv"], (t, 1000 + i, 0, 0))
        for t, h, k, c in S:
            H.insert(cx, "ref_string", ["table_name", "key_hash", "key_name", "content"], (t, h, k, c))
        for rid in ("101", "2031"):
            H.insert(cx, "ref_route", ["route_id", "length_m", "is_loop"], (rid, 1000.0, 1))
        cx.commit()
        self.zip = os.path.join(tempfile.gettempdir(), "fh6_om_%s.zip" % uuid.uuid4().hex)
        docs = {
            "11": dataset("TrackInfoDataSet", [
                (24, {"RouteId": "101", "CustomRouteId": "2101", "RibbonConfig": "Circuit",
                      "DisplayName": "CareerTrackInfo.IDS_DisplayName_aaaa",
                      "Description": "CareerTrackInfo.IDS_Description_aaad", "UseCrossCountryAI": "False"}),
                (31, {"RouteId": "2031", "RibbonConfig": "P2P",
                      "DisplayName": "CareerTrackInfo.IDS_DisplayName_bbbb"})]),
            "12": dataset("RaceCollectionDataSet", [
                (24, {"Name": "CareerRaceCollection.IDS_Name_cccc", "CollectionType": "Exhibition",
                      "CarRestrictionsReference": ("ref", "g-any")}),
                (31, {"Name": "CareerRaceCollection.IDS_Name_ffff", "CollectionType": "Exhibition"})]),
            "13": dataset("CareerRaceDataSet", [
                (240, {"Name": "CareerRace.IDS_Name_dddd", "EventType": "Campaign", "Track": ("ref", "24"),
                       "RaceCollection": ("ref", "24"), "RaceMode": ("ref", "LapsRace"), "NumLaps": "3"}),
                (310, {"Name": "CareerRace.IDS_Name_eeee", "EventType": "Campaign", "Track": ("ref", "31"),
                       "RaceCollection": ("ref", "31"), "RaceMode": ("ref", "P2P"), "NumLaps": "1"})]),
            "14": dataset("RivalsEventDataMap", [
                (290, {"LeaderboardId": "1", "Name": "RivalsEventData.IDS_Name_r1",
                       "RaceCollection": ("ref", "24"), "CarRestriction": ("ref", "g-d"),
                       "IsClassBasedEvent": "True", "SortIndex": "1"}),
                (300, {"LeaderboardId": "2", "Name": "RivalsEventData.IDS_Name_r2",
                       "RaceCollection": ("ref", "24"), "CarRestriction": ("ref", "g-c"),
                       "IsClassBasedEvent": "True", "SortIndex": "2"})]),
            "15": dataset("CarRestrictionMap", [
                ("g-d", {"Id": "g-d", "CarClassId": "0", "PIMax": "400"}),
                ("g-c", {"Id": "g-c", "CarClassId": "1", "PIMax": "500"}),
                ("g-any", {"Id": "g-any", "CarClassId": "0"})]),
        }
        with zipfile.ZipFile(self.zip, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("source/manifest.xml", fh6_bxml.build(manifest([
                ("11", "TrackInfoDataSet"), ("12", "RaceCollectionDataSet"), ("13", "CareerRaceDataSet"),
                ("14", "RivalsEventDataMap"), ("15", "CarRestrictionMap"), ("16", "QuickChatData")])))
            for fid, doc in docs.items():
                zf.writestr("source/ScribbleData/%s.om.xml" % fid, fh6_bxml.build(doc))
            zf.writestr("source/ScribbleData/16.om.xml", fh6_bxml.build(dataset("QuickChatData", [])))

    def tearDown(self):
        H.close_db(self.cx, self.db_path)
        try:
            os.remove(self.zip)
        except OSError:
            pass

    def test_tables_and_chain(self):
        counts, notes = om.run(self.cx, self.zip)
        self.assertEqual(counts, {"ref_track_info": 2, "ref_race_collection": 2, "ref_career_race": 2,
                                  "ref_rivals_event": 2, "ref_car_restriction": 3})
        self.assertEqual(notes["rivals_names"], 1)
        self.assertEqual(notes["rivals_names_one_route"], 1)
        self.assertEqual(H.dump(self.cx, "SELECT track_key, route_id, display_name, description FROM ref_track_info ORDER BY 1"),
                         [(24, "101", "Alpha Circuit", "A lap of alpha."), (31, "2031", "Beta Sprint", None)])
        self.assertEqual(H.dump(self.cx, "SELECT name, class_id, route_id, num_laps, discipline FROM v_rivals_route ORDER BY class_id"),
                         [("Alpha Circuit", 0, "101", 3, "road"), ("Alpha Circuit", 1, "101", 3, "road")])
        self.assertEqual(H.dump(self.cx, "SELECT discipline FROM ref_career_race WHERE race_key=310"), [("road",)])

    def test_unresolved_name_guid_fails_the_stage(self):
        self.cx.execute("DELETE FROM ref_string WHERE key_name='IDS_DisplayName_bbbb'")
        self.cx.commit()
        with self.assertRaises(ValueError):
            om.run(self.cx, self.zip)
        self.assertEqual(H.dump(self.cx, "SELECT COUNT(*) FROM ref_track_info"), [(0,)])

    def test_rerun_is_idempotent(self):
        om.run(self.cx, self.zip)
        before = H.dump(self.cx, "SELECT * FROM ref_career_race ORDER BY race_key")
        om.run(self.cx, self.zip)
        self.assertEqual(H.dump(self.cx, "SELECT * FROM ref_career_race ORDER BY race_key"), before)


class GameTierTest(unittest.TestCase):
    """route_names' game tier: an identified route the catalogue names is named by the game,
    lengths notwithstanding; the typed word still wins; a probable's catalogued twin is taken."""

    CLOSED = '{"path": [[0,0],[100,0],[100,100],[0,100],[1,1]]}'

    def setUp(self):
        self.cx, self.db_path = H.new_db()
        cx = self.cx
        H.insert(cx, "ref_event", ["event_id", "kind", "name", "length_m", "is_loop", "discipline", "route_id"],
                 ("rivals:alpha-circuit", "rivals", "Alpha Circuit", 5000.0, 1, "road", "101"))
        H.insert(cx, "ref_event", ["event_id", "kind", "name", "length_m", "is_loop", "discipline", "route_id"],
                 ("rivals:gamma-circuit", "rivals", "Gamma Circuit", 1000.0, 1, "road", "6001"))
        for rid, L in (("101", 1000.0), ("6001", 1000.0), ("30006", 1010.0), ("777", 1000.0)):
            H.insert(cx, "ref_route", ["route_id", "length_m", "is_loop", "road_class"], (rid, L, 1, "paved"))
        for tk, rid, name in ((24, "101", "Alpha Circuit"), (43, "6001", "Gamma Circuit")):
            H.insert(cx, "ref_track_info", ["track_key", "route_id", "display_name", "name_key", "ribbon"],
                     (tk, rid, name, "IDS_DisplayName_x", "Circuit"))
        H.insert(cx, "ref_race_collection", ["collection_key", "name"], (24, "Alpha Exhibition"))
        H.insert(cx, "ref_career_race", ["race_key", "name", "track_key", "collection_key"], (240, "Alpha Circuit", 24, 24))
        H.insert(cx, "ref_rivals_event", ["rivals_key", "name", "collection_key", "name_key"], (290, "Alpha Circuit", 24, "IDS_Name_r1"))
        courses = [("c1", 1000.0, None, self.CLOSED),          # verified on 101 -> game name, length disagrees with the event
                   ("c2", 1000.0, "My Typed Name", self.CLOSED),  # typed name still wins over the game's
                   ("c3", 1010.0, None, self.CLOSED),          # probable on the uncatalogued twin 30006 -> Gamma via 6001
                   ("c4", 1000.0, None, self.CLOSED)]          # verified on 777, uncatalogued -> map tier only
        for rk, L, D, geo in courses:
            H.insert(cx, "course", ["route_key", "length_m", "declared_name", "geometry"], (rk, L, D, geo))
        for rk, rid, kind, ru in (("c1", "101", "verified", None), ("c2", "101", "verified", None),
                                  ("c3", "30006", "probable", "6001"), ("c4", "777", "verified", None)):
            H.insert(cx, "course_route", ["route_key", "route_id", "match_kind", "runner_up", "computed_utc"],
                     (rk, rid, kind, ru, "2026-09-05T00:00:00Z"))
        cx.commit()

    def tearDown(self):
        H.close_db(self.cx, self.db_path)

    def _course(self, rk):
        return tuple(self.cx.execute("SELECT name, name_source, name_confidence, event_id FROM course WHERE route_key=?", (rk,)).fetchone())

    def test_game_names_identified_route_regardless_of_length(self):
        rn.run(self.cx)
        self.assertEqual(self._course("c1"), ("Alpha Circuit", "derived:game", "verified", "rivals:alpha-circuit"))
        self.assertEqual(H.dump(self.cx, "SELECT tier, chosen FROM course_event WHERE route_key='c1' AND event_id='rivals:alpha-circuit'"), [("game", 1)])

    def test_typed_word_still_wins(self):
        rn.run(self.cx)
        self.assertEqual(self._course("c2")[:3], ("My Typed Name", "declared", "read"))
        self.assertEqual(H.dump(self.cx, "SELECT chosen FROM course_event WHERE route_key='c2' AND tier='game'"), [(0,)])

    def test_probable_takes_the_catalogued_twin(self):
        rn.run(self.cx)
        self.assertEqual(self._course("c3"), ("Gamma Circuit", "derived:game", "verified", "rivals:gamma-circuit"))

    def test_every_catalogued_route_is_named_driven_or_not(self):
        rn.run(self.cx)
        self.assertEqual(H.dump(self.cx, "SELECT route_id, name, name_source, name_confidence FROM ref_route WHERE name IS NOT NULL ORDER BY route_id"),
                         [("101", "Alpha Circuit", "game:trackinfo", "verified"),
                          ("30006", "Gamma Circuit", "derived:game", "verified"),     # the driven mirror of 6001
                          ("6001", "Gamma Circuit", "game:trackinfo", "verified")])

    def test_game_named_route_with_no_event_still_names_the_course(self):
        # route 777 is catalogued but no event reaches it: the course takes the game's name, event_id NULL
        H.insert(self.cx, "ref_track_info", ["track_key", "route_id", "display_name", "name_key", "ribbon"],
                 (99, "777", "IE Drive Section 2", "IDS_DisplayName_y", "P2P"))
        self.cx.commit()
        rn.run(self.cx)
        self.assertEqual(self._course("c4"), ("IE Drive Section 2", "derived:game", "verified", None))

    def test_length_disagreement_is_reported_not_vetoed(self):
        self.cx.execute("UPDATE ref_route SET length_m=5000.0 WHERE route_id='6001'")   # event says 1000 m
        self.cx.commit()
        rn.run(self.cx)
        notes = self.cx.execute("SELECT name FROM ref_route WHERE route_id='6001'").fetchone()[0]
        self.assertEqual(notes, "Gamma Circuit")

    def test_uncatalogued_route_falls_back_to_the_map_tier(self):
        rn.run(self.cx)
        name, source, conf, eid = self._course("c4")
        self.assertNotEqual(source, "derived:game")


if __name__ == "__main__":
    unittest.main()
