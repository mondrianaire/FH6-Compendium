# Course identity and common names — the one workflow

**Status: settled, 2026-09-05.** Written because the project lost four days to this twice. Read
this before touching anything that names a route or a course, and before asking for a capture.

## The three ids

| id | what | where | example |
|---|---|---|---|
| `route_id` | the game's route: `Route<id>.owt` centre-line (a graph of sections) | `media/openworld/brio/aitracks/` → `ref_route`, `ref_route_point` | `101` |
| `track_key` | the catalogue row that carries **both** the route id and the display name | `media/ObjectModelGame.zip` → `ref_track_info` | `24` → route `101`, "Hokubu Circuit" |
| `route_key` | our driven course, keyed by its start cell | telemetry → `course` | `2850_2700` |

The common name is `ref_track_info.display_name`, the `CareerTrackInfo` string resolved through
`ref_string`. It is bound to the route by the game, not derived by us.

## The chain

**Driven course → name**

```
course.geometry ──course_match──▶ course_route.route_id ──▶ ref_track_info.route_id ──▶ display_name
        (shape vs ref_route_point; race_triggers.tz spheres corroborate)          course.name  'derived:game'
```

**Event name → route**

```
ref_rivals_event ─▶ ref_race_collection ─▶ ref_career_race ─▶ ref_track_info ─▶ route_id      (v_rivals_route, 88/88)
```

## Sources on disk — none of them encrypted

| file | gives | reader |
|---|---|---|
| `media/stripped/stringtables/EN.zip` | GUID → text for every string table | `fh6_strings.py` → stage `gamedb` |
| `media/ObjectModelGame.zip` (~7,000 BXML docs; `source/manifest.xml` maps id → TypeId) | `TrackInfoDataSet`, `RaceCollectionDataSet`, `CareerRaceDataSet`, `RivalsEventDataMap`, `CarRestrictionMap` | `fh6_bxml.py` → stage `objectmodel` |
| `media/openworld/brio/aitracks/Route<id>.owt` + `.nav` | geometry, width, banking, road class | `fh6_owt.py` → stages `routes`, `surface` |
| `media/tracks/brio/triggerzones/tz_race_activations/race_triggers.tz` | 36 race-start spheres, `rt<route_id>` | `fh6_anchors.py` → stage `anchors` |
| `data/rivals-routes-<discipline>.json` | the **displayed** Route Length (optional now) | stage `events` |

## Stages, in order

`gamedb → objectmodel → events → routes → anchors → surface → course_match → route_names`
(`python scripts/db/rebuild.py --only <stage>` cascades to every dependent stage; `--check` asserts
I1–I13 afterwards.)

Precedence inside `route_names`: **declared > game > map > length**. The typed word is final and is
recorded as such; the game tier names every identified course and every catalogued route; the map
and length derivations remain only as cross-checks, reported in the run notes (`game_vs_map`) and
by `--check` I13, never as a veto.

## Verify in a minute

```bash
python scripts/db/rebuild.py --check
python -m unittest discover -s tests -t .
```

```sql
-- catalogued routes on disk, named, identical to the catalogue (expect 100 = 100 = 100)
SELECT COUNT(DISTINCT t.route_id), SUM(r.name IS NOT NULL), SUM(r.name = t.display_name)
  FROM ref_track_info t JOIN ref_route r USING(route_id);
-- Rivals names bound to exactly one route (expect 88)
SELECT COUNT(*) FROM (SELECT name FROM v_rivals_route GROUP BY name HAVING COUNT(DISTINCT route_id)=1);
-- identified courses all named (the two counts match)
SELECT COUNT(*), SUM(c.name IS NOT NULL) FROM course c JOIN course_route cr USING(route_key)
 WHERE cr.match_kind IN ('verified','probable');
-- who named what
SELECT name_source, COUNT(*) FROM ref_route WHERE name IS NOT NULL GROUP BY 1;
```

Expected as of 2026-09-05: 100 / 100 / 100 · 88 · 18 = 18 · `game:trackinfo` 100 + `derived:game` 1
(the driven mirror 30006 of Edamame's 6001). The 11 catalogued ids without a file are nine
playground arenas, "Freeroam Rush" (id 0) and "Costa Rocosa" (FH5 carry-over); the 68 unnamed
routes are free-roam ribbons the catalogue never lists.

## When a course has no name

Ask in this order. Almost every past failure was a wrong answer to the first question.

1. **Does `course_route` identify a route** (`verified` / `probable`)? If not, the problem is
   geometry — sections in the `.owt` (route 132 read as 3 km until 2026-09-06), a mirror twin, a
   short partial lap, a start sphere disagreeing (`anchor_agree = 0`) — not naming.
2. **Is that `route_id` in `ref_track_info`?** If not, it is a free-roam ribbon or the uncatalogued
   mirror of a catalogued twin: look at `course_route.runner_up`.
3. **Is the name typed?** `declared_name` wins and the game's name sits in `course_event` as the
   `game` tier row, `chosen = 0`. Read the row before arguing.

## Never again

- Do not look for route ids in `.str` files. String tables map GUID → text and nothing else.
- Do not decrypt anything to get names. `GameTunableSettings.zip` was decrypted on 2026-09-05 and
  held no catalogue; the binding was in a plain zip the whole time.
- Do not name by length. Before the catalogue landed the length tier had two wrong single
  candidates (`3600_6850` is Venus Sprint, not Festival Sprint; `-3250_-7850` is Coastline
  Sprint, not Satta Sprint).
- Do not type a name into the database. Type it in the dashboard; the rule records it.
- Do not dismiss an archive because its entries have opaque names — decode one entry first.
  "6,981 xml, 0 matching names" was the catalogue.

## History, so the cost is remembered

| date | what happened |
|---|---|
| 2026-09-01 | names derived from the Rivals › Routes screen length + map identity (23 Road routes) |
| 2026-09-03 | that method forgotten; `course_route` sat empty for two days behind a cascade bug |
| 2026-09-05 | method rebuilt with provenance; Dirt recorded; `race_triggers.tz` anchors found; `GameTunableSettings.zip` decrypted — nothing; `ObjectModelGame.zip` decoded — the binding |
| 2026-09-06 | `.owt` section graph fixed (route 132 = The Colossus) |
