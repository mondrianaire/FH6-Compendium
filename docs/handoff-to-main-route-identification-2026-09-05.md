# Handoff to the main agent — route identification, 2026-09-05

Written in response to the "two ways to get the bridge" note. Your account of the pipeline is
correct and I am not disputing it. Three things change:

1. **A third bridge exists that neither of us listed, it is plaintext, and it is already on disk.**
   `race_triggers.tz` binds 36 `ref_route` ids to world positions. Verified 36/36.
2. **Your option 1 (decode the event datasets) is now largely closed** — I ran the search properly
   (by string *hash*, not by GUID text) and it comes back empty across the whole install.
3. **The problem should be split.** "Route identification" and "route naming" are different problems
   with different answers. The first has a better method available today. The second does not.

Everything below was measured 2026-09-05 against `data/fh6.db`, `FH6_Database.sqlite` and the install
at `C:\XboxGames\Forza Horizon 6\Content\media`.

---

## 1. What holds from your note

- The `.owt` chain is exactly as you describe: install → `ref_route*` → `course_route` → `route_names`,
  nothing driven or downloaded. I confirmed the `FTWO` header is version/hash/payload-size only.
- `RivalsEventData` carries no route id, no coordinates, no length. Confirmed.
- The 65 non-road names are strings with no place attached. Confirmed — `ref_event` holds 88 rows,
  23 complete, **65 with `length_m` NULL on every one**.
- The name-only import's value is the typo guard / checked resolve. Agreed, and
  `import_events.py`'s "a guid that disagrees fails the whole stage" rule should stay exactly as is.
- Route Length is a real bridge and the Road file used it correctly.

**What changes:** it is not the *only* bridge, and it is not the best one for identifying *which road*
a course is.

## 2. The find — `race_triggers.tz`

```
C:\XboxGames\Forza Horizon 6\Content\media\tracks\brio\triggerzones\tz_race_activations\race_triggers.tz
```

14 KB, plaintext XML, UTF-8 BOM. Not read by any script in the repo, not named in the 09-03 audit,
census, or field catalogue. 36 entries of this shape:

```xml
<triggerzone type="sphere" name="race_trigger_zone_rt101" mobile="false" delay="0" streamed="false" FORZA_SeasonExclusion="0">
  <position x="3070.162566" y="116.421829" z="2574.534235" />
  <size x="100.0" y="100.0" z="100.0" />
```

**The `rt<N>` suffix is a `ref_route.route_id`, and it is populated** — unlike every other candidate
id field in the shipped data (`Tracks.Route` = 0 on all 58 rows; `.nt` `<GUID>` = "0" on all 8,117
locators).

| check | result |
|---|---|
| zones, all `race_trigger_zone_rt<N>` | 36 |
| `rt<N>` resolving to a `ref_route.route_id` | **36 / 36** |
| coordinate frame | same metre frame as `ref_route_point` / UDP telemetry — no transform |
| distance from trigger to its **own** route polyline | median **9.2 m**; **18/36 under 10 m**, **27/36 under 50 m** |
| radius | 100.0 m on every zone |

The tail (60–285 m) is consistent with an activation marker placed beside the road rather than on the
centre-line, not with a bad join — every id still resolves.

### The 36 anchors

| route_id | x | z | d to own route (m) | length_m | road_class |
|---|---:|---:|---:|---:|---|
| 71 | 2555.0 | 4851.2 | 59.2 | 1926 | paved |
| 101 | 3070.2 | 2574.5 | 38.4 | 2516 | paved |
| 121 | 5604.4 | 1109.2 | 1.0 | 3071 | mixed |
| 131 | -5535.7 | 53.3 | 0.6 | 2372 | paved |
| 141 | -1893.6 | 1432.6 | 35.7 | 1100 | paved |
| 161 | 1370.8 | 448.5 | 61.5 | 3211 | paved |
| 201 | -2205.0 | -1175.0 | 1.5 | 2611 | mixed |
| 281 | -1710.1 | -4426.5 | 5.5 | 8748 | paved |
| 301 | 2462.9 | -4918.0 | 39.8 | 2134 | loose |
| 311 | 4359.5 | -5619.6 | 75.6 | 4732 | paved |
| 351 | -754.3 | -5038.0 | 10.6 | 5433 | paved |
| 352 | 48.2 | -6011.5 | 7.8 | 2690 | paved |
| 1021 | 1121.9 | 8714.8 | 158.9 | 7882 | mixed |
| 1023 | -1803.0 | -1210.4 | 1.5 | 23395 | — |
| 1171 | 3574.7 | -366.6 | 2.4 | 8859 | mixed |
| 1211 | 1057.3 | -790.4 | 10.9 | 2992 | mixed |
| 1281 | -2155.4 | -4744.1 | 5.8 | 6162 | paved |
| 1421 | -1263.7 | -8894.4 | 34.4 | 2871 | — |
| 2091 | -9.7 | 4125.5 | 1.3 | 8932 | paved |
| 2311 | 4207.8 | -5594.8 | 1.6 | 6946 | mixed |
| 4351 | -646.4 | -6495.9 | 26.1 | 7254 | paved |
| 4501 | -1952.7 | -329.6 | 63.8 | 1312 | paved |
| 4502 | -988.1 | -8652.9 | 1.6 | 826 | paved |
| 4503 | 2975.3 | -584.1 | 1.3 | 1312 | paved |
| 5031 | 3555.8 | 6077.5 | 1.9 | 8741 | paved |
| 5041 | -95.6 | 7110.0 | 1.1 | 7814 | paved |
| 5191 | -4852.0 | -1448.3 | 0.2 | 5947 | paved |
| 5201 | -348.1 | -1151.7 | 31.6 | 6919 | paved |
| 5555 | 4116.4 | -5046.8 | 1.7 | 85273 | paved |
| 6001 | -7219.5 | -2487.6 | 284.8 | 1063 | paved |
| 8001 | 1372.7 | -5738.7 | 106.7 | 8382 | — |
| 8002 | 1185.1 | 8498.6 | 1.1 | 8661 | mixed |
| 8003 | -1675.4 | -8920.5 | 54.6 | 8414 | paved |
| 8004 | -4009.0 | -2460.3 | 0.7 | 9046 | paved |
| 8005 | 2764.7 | -1447.9 | 167.3 | 9545 | mixed |
| 8006 | 1873.9 | 2124.9 | 47.6 | 7990 | paved |

### Why it beats the current identity mechanism

`course_route` today is a post-hoc geometric comparison of a driven course against 169 centre-lines,
landing on **verified 8 · probable 2 · partial 34 · none 21**. The triggers replace inference with
observation: when an event starts the car is inside a named 100 m sphere, and telemetry already reports
position every tick.

1. **Direct runtime route id** for the 36 race routes — no shape matching, no ambiguity, no capture.
2. **A hard anchor for `course_match`.** A course whose laps begin inside `rt<N>` *is* route N. That is
   stronger evidence than any polyline comparison and should outrank `verified` in the match-kind
   ladder rather than sit alongside it.
3. **It removes the length tier's worst failure.** Your Soni/Irokawa case (both 1.2 mi) is
   unresolvable by the length key and trivially separated by position.
4. **It marks which routes are races.** 36 of the 169 are race routes; `ref_route` carries no such
   flag today, and the other 133 are free-roam ribbons that no Rivals name will ever match.

**Stated plainly: this gives an id, not a name.** It does not name a single route on its own. What it
does is make the eventual name binding exact and permanent instead of length-inferred, and improve
`course_route` today at zero cost.

### Do not confuse these with the neighbouring files

`tz_races/triggers_route_{3333-3336,8001-8005}.tz` and
`tz_playground_games/triggers_route_{3003,3013,3023}.tz` are mesh polygons in a **different id
namespace** — none of those ids exist in `ref_route`. Same for the 22 `route<id>.nt` filenames
(0, 3001–3023, 8100–8105, 40001–40044, 40900): **0 of 22 in `ref_route`**. Only the `rt<N>` set in
`race_triggers.tz` is in our namespace.

## 3. Your option 1 is largely closed — searches run, all negative

The earlier pass searched for the event GUIDs as **ASCII text**. That was the wrong test:
`ref_string` keys are 32-bit hashes, so a binary referencing a name stores the *number*. Redone:

| search | result |
|---|---|
| every non-art file under `media/` scanned for the 88 Rivals course-name hashes as LE u32 | only 2–3 hits per file inside **compressed** archives (`PopcornFX.zip`, `particles/Shaders.zip`, `cinematic_assets/*.zip`, `ui/.../Series4.zip`) — chance collisions in high-entropy data, no structured reference |
| all 169 `.owt` + 169 `.nav`, header offsets 0–128 vs every string hash | **0 files match at any offset** |
| all 338 aitracks files, full-file u32 scan vs `RivalsEventData` hashes | 3 of 338 — collision-level |
| 700 `CareerTrackInfo`+`CareerRace` GUIDs vs every text column of all 205 game-DB tables | **0 hits** |
| same 700 GUIDs vs all 262 readable files under `tracks/` | **0 hits** |
| any coordinate/position column in the 205-table game DB | none (only car-space camera offsets) |

Two corrections to leads that look alive:

- **`NewProfile_CareerRaces` is a red herring** beyond its 0 rows. It carries `CreatorXUID` — it is the
  *new-profile seed for Blueprint (user-created) races*, not the shipped catalogue.
- **`EventBlueprint.csv` is not event definitions.** All 69 corpus CSVs share the header
  `HashId,HashIdHex,KeyName,Content`; this one is UI labels (`IDS_AICountLabel` → "Max Number Of
  Drivatars"). The audit's "25 mirror game tables / 44 string exports" split is wrong — all 69 are
  string exports, and all 17,959 rows are already byte-identical in `ref_string`.

**The one place left.** `stripped/gamedbRC.slt` is **15,599,508 bytes and encrypted**;
`FH6_Database.sqlite` is **13,328,384 bytes**. That gap is the only remaining candidate for the shipped
event catalogue. It uses the same wrapper as `PI.xml` — 16-byte IV, u32, AES-block-aligned payload,
`(size − 20) % 16 == 0` — with no known bypass.

Per the GitHub-first rule the question is **not** "can we decrypt it" but **"has anyone published a
decrypted `gamedbRC.slt`, an FH6 event-table dump, or a `.slt` reader?"** — the same route that
produced `FH6_Database.sqlite`, whose own provenance was never recorded. That is a search, not a
decode, and it is the cheapest remaining move on the naming side.

## 4. A trap worth naming before someone hits it

`DriftZones` (31), `Trailblazers` (18), `DangerSigns` (38), `LabyrinthRoutes` (12) are **numerically
keyed** — `IDS_drift_zone_31A`, `IDS_trailblazer_20`. Integer keys look joinable in a way GUIDs do
not, so they are what a future sweep reaches for first.

They are **FH5 Mexico carryover**: `Otro Mundo`, `Barranco`, `Granjas`, `Tierras Verdes`,
`Puerta Pétrea`. `SplashChoice` still contains "Welcome to Mexico". FH6 is Japan. A numeric key that
lands in range there is coincidence, not a join.

## 5. Recommended order

1. **Import `race_triggers.tz`.** 14 KB, plaintext, 36/36 verified, no capture, no permission,
   no dependency on anything unresolved. Suggested shape:
   - `ref_route.is_race` (36 true of 169) and a `route_anchor` table `(route_id, x, z, radius)`.
   - `import_course_match.py`: a course whose lap starts fall inside `rt<N>` gets match_kind
     `anchored`, ranked above `verified`. Keep the geometry verdict alongside as corroboration —
     the 27/36-under-50 m result means the anchor and the polyline agree, which is worth asserting
     in `--check` rather than assuming.
   - daemon: emit the route id when position enters a sphere. This is the piece that makes route
     identity an observation instead of an inference.
2. **GitHub search for a decrypted `gamedbRC.slt` / FH6 event tables**, before any recording.
3. **Recordings last.** If they happen, prefer your option 2 (match the outline shown on the Routes
   screen, not just the printed length) — with the anchors in place you have 36 known-correct answers
   to validate the outline matcher against, which turns a subjective shape comparison into a
   measurable one.

## 6. What has not changed

`import_route_names.py`'s three-tier rule (**map > declared > length**), the `course_event` row per
candidate with `chosen=1`, and `import_events.py`'s checked-GUID guard are all correct and should be
kept as they are. There is still no name↔route binding anywhere on disk. This handoff narrows the
open problem to the **name** half only, and hands the **route** half a better key than the one in use.

Full working, including the audit/census verification this came out of, is in
`docs/data-audit-verification-2026-09-05.md` and
`docs/handoff-route-name-identification-2026-09-05.md`.

---

## 7. Main-agent verification and what was built from it (2026-09-05, lab branch)

Re-measured against the same files before anything was adopted.

| claim | result |
|---|---|
| 36 spheres, 36/36 resolve to `ref_route`, radius 100 m | **confirmed** |
| median 9.2 m to own polyline, 18/36 under 10 m, 27/36 under 50 m | **confirmed** (point-to-point median 10.6 m, same counts, worst 284.8 m on 6001) |
| `tz_races/triggers_route_{3333-3336,8001-8005}` are "a different id namespace, none in `ref_route`" | **wrong** — all 10 ids are in `ref_route` (8001–8005 are in the `rt<N>` set itself). The files are bullet-time cutscene boxes, so nothing depends on it. `tz_playground_games` (0/3) and the `route*.nt` names (0/22) are absent as stated |
| "a course whose laps start inside `rt<N>` *is* route N; should outrank verified" | **too strong** — 33 of 36 spheres have another route's centre-line within 100 m (131 sits 0.3 m from 5555, 1023 1.4 m from 3336 and 2201). A sphere proves a race *started* there, not which of the overlapping roads was then driven. Adopted as corroboration and tie-break, never as an override |
| Soni/Irokawa "trivially separated by position" | **not by this** — both candidates sit on the same identified route (421); the sphere identifies the route, and the tie is between two event *names* for it. Only a name→place binding settles that, and that is the half still missing |
| `gamedbRC.slt` gap is "the one place left" behind "an unbroken cipher" | **outdated** — DVS-code/Forza-Crypto-Tool (GitHub) decrypts FH6 `.slt`, method-22 zips and profile saves; its verified GameDB reports 205 tables, i.e. `FH6_Database.sqlite` is complete and the event catalogue is not in the game DB. Remaining candidates: `media/sfsdata` (75 MB, entropy 8.0) and `GameTunableSettings.zip` (`EventNames.xml`, `track_properties.xml`, `TrackMetrics.xml`). Keys are server-side; using it is Jett's decision |

Measured on the lab's own data before building: 109 of 489 session events start inside a sphere,
on 9 courses; every one agrees with the geometry verdict except `-4750_-1550` (geometry 5191
partial, one event in 5041's sphere). Course `4200_-5450`, which geometry left `none`, starts in
5031's sphere on 6 of 6 events.

**Built:** `scripts/telemetry/fh6_anchors.py` (reader), stage `anchors` →
`route_anchor` + `ref_route.is_race`, `session_event` (every analyzer event with its start
position and a `start_is_line` flag, stage `telemetry`), `course_route.anchor_route_id /
anchor_events / anchor_agree`, the rule in `import_course_match.py`, the analyzer stamps `anchor`
on each event, and `rebuild.py --check` I12 reports every disagreement and fails on any leak.

The rule after a four-lens adversarial review (6 findings confirmed and fixed): a sphere may
promote only with a strict majority of ALL the course's events (≥ 2 and more than half) —
`probable` settled between its own two candidates → `verified`; `none` → `anchored` with
`route_id` STILL NULL, so corners, the dashboard centre-line and naming, which all gate on
`route_id`, keep treating it as unidentified. A point inside two spheres (2311/311 overlap by
46 m) is unresolved. First live run under that rule: 13 verified, 3 probable, 30 partial,
22 none, 0 anchored — the spheres corroborated six courses and changed no verdict.
`4200_-5450` has 6 of its 16 events in route 5031's sphere, the other 10 start elsewhere, so it
stays `none` with the evidence recorded; `-4750_-1550` is the one I12 WARN.
