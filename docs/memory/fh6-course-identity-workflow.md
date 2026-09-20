---
name: fh6-course-identity-workflow
description: "HARD RULE, final (Jett 2026-09-05): the ONE workflow that turns a driven course into a game route id and a common name -- geometry -> ref_route.route_id (Route<id>.owt) -> ref_track_info (ObjectModelGame.zip TrackInfoDataSet) -> display_name; stages objectmodel/routes/anchors/course_match/route_names; never re-derive names from length, never search string tables or decrypt for them; verification queries included"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 6df3e83b-72ec-4c37-9c9f-0b4b3817f1f4
  modified: 2026-09-06T03:55:43.727Z
---

**Jett, 2026-09-05:** "we need to fully commit this workflow of Course ID and common name linking
to memory as we have struggled in the past with this." Four days were lost (09-01 method built,
09-03 forgotten, 09-05 rebuilt twice, then found the real source). This note is the workflow;
docs/course-identity-and-names.md in the repo is its long form with the queries.

**Three ids, one name.**
- `route_id` -- the game's route: `Route<id>.owt` under media/openworld/brio/aitracks, row in
  `ref_route` (geometry: ref_route_point). An .owt is a GRAPH of sections, not one array.
- `track_key` -- the catalogue row: `ref_track_info` (TrackInfoDataSet inside media/
  ObjectModelGame.zip, plain zip of BXML documents), carries `route_id` AND `display_name`
  (the CareerTrackInfo string). THIS is the binding. 111 route ids, 100 with a file.
- `route_key` -- OUR driven course ('-2700_-1050', the start cell), row in `course`.

**The chain, driven course -> name:** telemetry (course.geometry) -> course_match (shape vs
ref_route_point; race_triggers.tz start spheres corroborate) -> course_route.route_id ->
ref_track_info.route_id -> display_name -> course.name, name_source 'derived:game',
confidence verified. **Event name -> route:** ref_rivals_event -> ref_race_collection ->
ref_career_race -> ref_track_info -> route_id (view v_rivals_route, 88/88 unique).

**Stages, in order (rebuild.py; `--only X` cascades):** gamedb (EN.zip strings) -> objectmodel
(the catalogue) -> events (ref_event.route_id bound) -> routes (.owt) -> anchors -> surface ->
course_match -> route_names. Precedence in route_names: declared (typed) > game > map > length;
map/length are CROSS-CHECKS now, disagreements land in run notes game_vs_map and `--check` I13.

**Verify in one minute** (`python scripts/db/rebuild.py --check` then, read-only):
catalogued routes on disk named == 100 and equal to display_name; Rivals names -> one route ==
88/88; identified courses (verified/probable) all named; `SELECT name_source, COUNT(*) FROM
ref_route WHERE name IS NOT NULL GROUP BY 1` = game:trackinfo 100 (+ derived:game for driven
mirrors such as 30006). Tests: `python -m unittest discover -s tests -t .` (test_objectmodel.py,
test_route_names_rule.py, test_owt_sections.py).

**Never again:**
- do NOT look for route ids in .str files -- string tables map GUID -> text only;
- do NOT decrypt anything to get names -- the binding was never encrypted (GameTunableSettings
  was decrypted and held nothing);
- do NOT name by length -- the length tier produced two wrong single candidates (Venus/Festival
  Sprint, Coastline/Satta) before the catalogue landed;
- do NOT type a name into the DB -- type it in the dashboard; the rule records it as 'declared'
  and keeps the game's name as evidence;
- do NOT trust a header count or dismiss an archive because its entries have opaque names --
  decode one entry first ([[fh6-sample-is-not-population]], [[fh6-decode-the-whole-record]]).

**How to apply:** when a course has no name, ask in this order: does course_route identify a
route (verified/probable)? if not, that is the whole problem (geometry, anchors, sections), not
naming. If it does and ref_track_info lacks that route_id, it is a free-roam ribbon or a mirror
twin -- check runner_up. Details: [[fh6-objectmodel-catalogue]], [[fh6-route-anchors]],
[[fh6-decrypt-landscape]]. (The length/map derivation note was retired 2026-09-06; its pitfalls are below.)

**Pipeline pitfalls learned on the way (keep):** a foreign-key PARENT (course, ref_event) is
MERGED (fh6db.merge_many, ON CONFLICT DO UPDATE), never `DELETE`+reinsert or `INSERT OR REPLACE`
-- both fire ON DELETE CASCADE immediately and emptied course_route for two days; every stage
runs `cx.execute("BEGIN")` before `PRAGMA defer_foreign_keys=ON` (Python's sqlite3 autocommits a
bare PRAGMA); schema changes go in BOTH db/schema.sql (fresh DB) and fh6db.V2_COLUMNS/V2_TABLES/
V2_VIEWS (migrate on a live DB); `--only` cascades through DOWNSTREAM and `--check` asserts
stage freshness (I2). One event is one place: a name claimed by courses on non-overlapping routes
is a tie, never two verified names.
