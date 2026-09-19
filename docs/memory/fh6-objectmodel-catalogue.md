---
name: fh6-objectmodel-catalogue
description: "THE name<->route binding lives in media/ObjectModelGame.zip (plain Deflate, BXML documents): TrackInfoDataSet.RouteId + CareerTrackInfo name GUID; Rivals event -> collection -> career race -> track -> route resolves 88/88; stage objectmodel + route_names tier game name every route from the game; the four-day hunt through .str/.owt/.nav/encrypted zips was looking in the wrong archive"
metadata: 
  node_type: memory
  type: project
  originSessionId: 6df3e83b-72ec-4c37-9c9f-0b4b3817f1f4
  modified: 2026-09-06T03:24:55.348Z
---

**Where the names are (found 2026-09-05, ~23:00):** `C:\XboxGames\Forza Horizon 6\Content\media\
ObjectModelGame.zip` -- 30 MB, ordinary Deflate, ~7,000 `source/ScribbleData/<id>.om.xml` files
that are BXML (Forza binary XML: 'BXML', u8 version, i32 count, i32 table size, u16-length strings,
then a flag/index node tree; reader scripts/telemetry/fh6_bxml.py from Nenkai/ForzaTools MIT
source). `source/manifest.xml` (also BXML) maps ids -> TypeId. The five that matter:
TrackInfoDataSet (112: track key -> RouteId, ribbon, CareerTrackInfo.IDS_DisplayName_<guid>),
RaceCollectionDataSet (158), CareerRaceDataSet (255: Track.Key, RaceCollection.Key, RaceMode,
NumLaps), RivalsEventDataMap (604 = 88 names x 7 classes: RaceCollection.Key, CarRestriction.Key,
LeaderboardId), CarRestrictionMap (541: CarClassId, PI/power/weight bounds). Chain: Rivals event
-> collection -> career race -> track -> route: 88/88 unique. Nothing was encrypted; the earlier
sweep saw "6,981 xml, 0 matching names" because the files are numbered and binary.

**Why it was missed for four days:** every search keyed on filenames, ASCII GUIDs or string hashes;
BXML stores strings in a table and refers to them by index, and the files carry no readable name.
Lesson (with [[fh6-sample-is-not-population]]): when an archive is readable and its entries are
opaque, decode ONE entry before declaring it irrelevant.

**Built:** stage `objectmodel` (scripts/db/import_objectmodel.py, after gamedb, before events) ->
ref_track_info, ref_race_collection, ref_career_race, ref_rivals_event, ref_car_restriction,
view v_rivals_route; stage events fills ref_event.route_id for the 88 Rivals rows (+ 255 kind
'career' rows); stage route_names tier GAME: precedence declared > game > map > length; ref_route
.name for all 100 catalogued routes on disk ('game:trackinfo', verified), course.name 'derived:game'
for every verified/probable course (a probable's catalogued twin wins over its uncatalogued mirror:
Edamame 30006 -> 6001); map/length stay as the cross-check, disagreements in run notes game_vs_map
and --check I13. First live run: 18 courses named (16 game), 100 routes, 0 ties. The length tier
had TWO wrong single candidates (Venus not Festival Sprint; Coastline not Satta) -- length alone
was never a key, now proven.

**Route 132 RESOLVED (2026-09-06):** the 3.1 km / bbox-zero read was the parser, and the same
defect sat under five more files. An .owt is a GRAPH of sections, not one array: u32 at 0x20 =
section count (1 on 163 files; 4/5/6 on Route132/281/351/1181/1281/8008), 40-byte entries from
0x58 (start, three links, count, flags), the point array 16-byte aligned AFTER the table (so a
6-section table is 192 bytes = not a whole number of 56-byte records, hence garbage), then
pad-to-16 + a 16-byte trailer -- never a fixed 24-byte tail. Flags high byte 1 = primary line,
2/4 = alternate line over the same road. fh6_owt.parse follows the primary chain (Colossus:
0->1->2->3->0, 37,706 m closed) and exposes `sections`/`chain`. Course -3750_300 now matches
132 verified (dev 4.4 m, covered 95%, len 0.998) and is named The Colossus 'derived:game';
Highway Circuit -1700_-4450 went partial -> verified once 281 lost its alternate line. Layout is
asserted byte-for-byte (tests/test_owt_sections.py builds synthetic files of every shape).
Lesson (with [[fh6-decode-the-whole-record]]): a header count that 'mostly fits' is not a layout;
account for every byte before reading records from an assumed offset. Rivals screen recordings
are now optional (displayed length only). ref_car_restriction gives every event's class/PI limit.
See [[fh6-course-identity-workflow]] (the rule), [[fh6-route-anchors]],
[[fh6-decrypt-landscape]] (GameTunableSettings decrypted via DVS-code: no catalogue there).
