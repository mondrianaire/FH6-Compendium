> **Filed 2026-09-06 by the lab session (worktree `forza-eliminator-tips-db-c512c3`).** Authored in
> another session and handed over by Jett as-is. One correction on provenance: in this lab
> `ref_track_info`, `ref_career_race`, `ref_race_collection`, `ref_rivals_event` and
> `ref_car_restriction` came from the never-encrypted **`media/ObjectModelGame.zip`** (BXML, read by
> `scripts/telemetry/fh6_bxml.py`, imported by `scripts/db/import_objectmodel.py`) -- `sfsdata` was
> not decrypted and is not needed (see `docs/course-identity-and-names.md`). Everything else below
> stands as the author measured it; re-measure before acting, as the author says.

# Handoff to main — route identification and event context, 2026-09-06

Rebuilt from scratch. Supersedes `handoff-route-name-identification-2026-09-05.md` and
`handoff-to-main-route-identification-2026-09-05.md`. Measured against `data/fh6.db` at run 549 —
the database moved repeatedly during this work, so re-measure anything structural before acting.

---

## 0. Correction to my own earlier conclusion

**I reported that the route-name binding did not exist on disk. That was wrong.**

I searched the 700 `CareerTrackInfo` / `CareerRace` GUIDs against every text column of all 205
game-DB tables, all 262 readable files under `Content\media\tracks\`, and the whole install for their
32-bit `key_hash` forms — all negative — and concluded no binding existed anywhere. The searches were
sound; the inference was not. The other side of the join was inside **`sfsdata`**, and decrypting it
produced `ref_track_info`, whose `name_key` is exactly the GUID I had been chasing.

*"Not in any readable file"* is not *"does not exist"*. An exhaustive search over the decryptable
surface says nothing about the encrypted surface.

---

## 1. Where things stand

| measure | value |
|---|---|
| `ref_route` named | **101 of 169** — 100 `game:trackinfo`, 1 `derived:game`, all `verified` |
| unnamed | 68, **all `is_race = 0`** (free-roam ribbons — correct end state, not a gap) |
| `ref_route.is_race` | 36, **all named** |
| `course` named | 19 of 78 |
| `course_route` | verified 15 · probable 3 · partial 31 · none 20 |
| `ref_event` | 343 (rivals 88, career 255) over 110 routes |
| `ref_track_info` / `route_anchor` | 112 / 36 |
| `lap` | 547 (solo 401 / non-solo 146) |

**Naming is effectively closed.** What remains open is *event context* — §4 and §5.

Also landed from the previous handoff: `race_triggers.tz` → `route_anchor` (36 rows, stage `anchors`,
`unknown_route_ids: 0`) and `ref_route.is_race`.

---

## 2. The key map

| key | rows | reaches |
|---|---|---|
| **`route_id`** | 169 | `.owt`/`.nav` geometry · `ref_route_point/turn/surface` · `route_anchor` (36/36) · `TargetTime` (85/85) · `ref_track_info.route_id` |
| **`track_key`** | 112, range 2–4065 | `ref_track_info` (PK) → `ref_career_race.track_key`. The road's identity *inside the objectmodel*, and only these two tables |
| **`collection_key`** | 158, range 1–80048 | `ref_race_collection` (solo / coop / **pvp**, restriction) ← `ref_rivals_event` (88/88) and `ref_career_race` (158 distinct) |
| **`restriction_id`** | 541 | `ref_car_restriction` — class / PI / power / weight / year limits |

`track_key` and `collection_key` **look** interchangeable — Highway Circuit is 20 in both, 100 of 112
track_keys exist as collection_keys, 98 with matching names. They are not: collections run to 80048
(career sub-collections) and there are 158 against 112 tracks. Join, never assume.

---

## 3. One road, many events — worked end to end

Everything on route 281 hangs off `track_key = 20`:

```
ROAD         route_id 281 · track_key 20 · "Highway Circuit" · 6,920 m · ribbon Circuit
              │
COLLECTION    └─ collection_key 20 · type Exhibition · solo=1 coop=1 pvp=1
              │
RIVALS        ├─ 7 class-tier leaderboards  (ref_rivals_event, sort_index 1..7)
              │     rivals_key 10 · class_id 0 · D  · leaderboard 14649498127549874790
              │     rivals_key 20 · class_id 1 · C  · leaderboard 2597315095803717496
              │     rivals_key 30 · class_id 2 · B  · leaderboard 12996845758532169124
              │     rivals_key 40 · class_id 3 · A  · leaderboard 8824101795531902217
              │     rivals_key 50 · class_id 4 · S1 · leaderboard 10920997932427952713
              │     rivals_key 60 · class_id 5 · S2 · leaderboard 14717924432944405581
              │     rivals_key 70 · class_id 6 · R  · leaderboard 12481983350070563358
              │
CAREER        └─ 6 campaign races — all LapsRace / road / no traffic / rivals_enabled=1
                    career:20     "Highway Circuit"      2 laps · 11 AI
                    career:30028  "Hitting the Highway"  3 laps · 11 AI
                    career:30044  "What's the Hatch?"    2 laps · 11 AI
                    career:30081  "Daily Commute"        2 laps ·  6 AI
                    career:30097  "Racing Horses"        3 laps ·  6 AI
                    career:30124  "Dango Dashes"         3 laps · 11 AI
```

The six career races are **not variants of one event** — they are separate campaign races that happen
to share a road, each with its own name, lap count and AI field. So the road hosts **13 competitive
contexts** (6 career + 7 Rivals) plus open PVP, where `ref_event` records 7 rows.

Route→event is many-to-one across the board: 343 events over 110 routes (31 routes carry 4 events,
16 carry 5, one carries 7). And **every Rivals route is also a career route** — 88 carry both,
**0 are rivals-only**, 22 are career-only.

---

## 4. The seven "variants" are PI class tiers — resolved in full

This was the open question from the string tables. `RivalsEventData` carries **604** `IDS_Name_<guid>`
rows for 88 names; `ref_rivals_event` holds **604** rows. Exact 1:1 — every GUID is one leaderboard.

**The seven tiers are D, C, B, A, S1, S2, R** — `class_id` 0–6 against `ref_class`. Each tier has its
own `leaderboard_id` and `restriction_id`; the restriction resolves to *"Drive any &lt;class&gt; Class
car"* with `pi_min`/`pi_max` both 0, so the tiers are **class-bounded, not PI-bounded**.

**X class (`class_id` 7) has no Rivals tier.** The ladder stops at R.

*Correction to an earlier draft:* `class_id` 6 was annotated "Anything Goes". That is the
restriction's generic `tagline`; its `description` reads *"Drive any 'R' Class car"*. Tier 6 is
**R class, not unrestricted**.

### The two exceptions

86 of 88 names have 7 tiers. Two have exactly one row, with `class_id` NULL and `is_class_based = 0`:

| rivals_key | name | collection | forced_car |
|---|---|---|---|
| 5870 | **Mech My Day** | 10 | `82fee907-65b6-a943-8d55-91a2bdd89559` |
| 5960 | **Flight Club** | 11 | `0379ad2a-e9d4-9c4b-a17a-9686dc718557` |

These are **spec events** — one forced car, so no class ladder. They are the only two rows in the
table with `forced_car` set, giving a self-consistent rule: `is_class_based = 0` ⟺ `class_id IS NULL`
⟺ `forced_car IS NOT NULL`.

### Unexplored on the same table

`weather_preset` is populated on all 604 rows, 7 distinct values: one dominant (464), a second (105),
and **five presets appearing exactly 7 times each** — five routes whose entire class ladder runs under
a specific non-default weather. Weather changes grip, so this is a comparability factor sitting one
join away and currently unused.

---

## 5. `ribbon`, and why lap comparability is the real open problem

### 5.1 `ribbon` is authoritative topology

`ref_track_info.ribbon`: **Circuit 31 · P2P 72 · Playground 9**, 112/112 populated. Against
geometry-derived `ref_route.is_loop` over the 101 named routes: **100 agree, 1 disagrees** — route
**8008 "The Opening Act"**, whose start and end fall within the loop-gap threshold but which the game
runs point-to-point. Ribbon is the authority; geometry is the estimate.

It also validates the existing heuristic rather than replacing it: joining `ref_track_info` to
`ref_event` on name gives 194 rows and **0 disagreements** with the `' Circuit'` / `' Sprint'` suffix
inference in `import_events.py`. Switching is still worth it — the game's own field, and it carries
`Playground`, a third state the two-valued heuristic cannot express.

### 5.2 89 laps sit on routes where a lap is not a unit

| ribbon | laps bound |
|---|---:|
| Circuit | 188 |
| **P2P** | **89** |

Mean `lap.arc_m ÷ route length`:

- **Circuit, well-matched: 0.96 – 1.01** (Irokawa 1.00, Kawazu 1.00, Taiyaki 1.01, Hirosaki 0.99,
  Shimanoyama 0.97, Hokubu 0.96)
- **P2P, every one: 0.50 – 0.76**, never approaching 1.0 — Hakone Nanamagari 0.66 across 25 "laps",
  Arashiyama Takao 0.67, Norikura Skyline 0.71, Bandai Azuma 0.67, Mt. Haruna 0.76, Festival
  Sprint 0.50

**Mechanism.** Two lap-cutting paths exist: `analyze_session.py:192` `_is_lap_boundary()` uses the
game's `CurrentLap` reset (authoritative), and `analyze_session.py:115`
`split_multilap(pts, close_m=35.0, min_lap_m=250.0)` cuts on **geometric loop closure**. The second
assumes a loop; on a P2P route it fires whenever the driver doubles back near the start, which is
exactly the consistently-fractional signature above. Strongly supported by the ratios — I have not
traced individual laps to which path produced them, and that is the verification step before changing
anything.

### 5.3 `ribbon` also explains the `partial` cluster

| | verified | probable | partial |
|---|---:|---:|---:|
| Circuit | 11 | 2 | 8 |
| **P2P** | 4 | 0 | **22** |

22 of 26 P2P pairs are `partial`. That is the honest verdict for a point-to-point route driven in free
roam, not matcher weakness. Reading the partials as "matching needs work" over-reads them. P2P wants
its own rule — endpoint proximity and direction — and `route_anchor` already supplies the start sphere
for the 36 race routes.

### 5.4 `lap` has no event binding

`lap` columns: `lap_id, route_key, session_id, cid, container, hw_hash, t0, lap_s, arc_m, coverage,
is_partial, build_id, class, pi, drivetrain, tune_hash, solo, impacts, void`. **No `event_id`.**

Laps bind to a course → route, and the route carries up to seven events, so the distinction modelled
in §3 never reaches the lap. **278 of 547 laps (51%) sit on dual-use routes**, split solo 174 /
non-solo 104 — both contexts genuinely mixed.

`solo` is the only discriminator, derived at `analyze_session.py:1776` from `RacePosition`:

| actual context | recorded |
|---|---|
| Rivals | `solo=1` — indistinguishable from Time Trial (the code's own label is *"Rivals / time trial"*) |
| Time Trial | `solo=1` |
| Career race | `solo=0` — indistinguishable from multiplayer |
| Multiplayer | `solo=0` |
| race led wire-to-wire in P1 | **`solo=1`** — a false positive the source comment already names |

Data Out offers `IsRaceOn`, `LapNumber`, `RacePosition`, `CurrentRaceTime`, `BestLap`, `LastLap` —
no mode field, no car count. A two-way split where the game has four-plus contexts.

**But the context data is already imported**, just not surfaced onto `lap`:
`ref_race_collection.pvp` (124 of 158 collections are solo+coop+pvp), `ref_career_race.rivals_enabled`
(241 of 255), and `ref_career_race.n_ai` / `has_traffic` / `is_timed` / `num_laps`.

**Why it matters:** a clean Rivals hot lap and a 3-lap career race against 11 Drivatars are not
comparable samples of the same tune. Pooling them widens exactly the variance the A/B is measuring, on
half the corpus. `ribbon` says whether a lap is a *valid unit*; event context says whether two valid
laps are *comparable*.

---

## 6. `TargetTime` — an unimported external yardstick

`ObjectModelGame.zip` holds **582 `TargetTime` documents**, unimported:

```xml
<object type="TargetTime">
  <property id="NameId"    value="Route4351_Unbeatable" />
  <property id="FactorMin" value="1.0144" /><property id="FactorMax" value="1.0144" />
  <property id="ProgressMin" value="0" /><property id="ProgressMax" value="0" />
</object>
```

- Keyed **`Route<id>_<Difficulty>`** — **85 distinct routes, 85 of 85 in `ref_route`**
- Six tiers on 80 routes (`Average`, `AboveAverage`, `HighlySkilled`, `Pro`, `Expert`, `Unbeatable`);
  nine on 5 (adding `Inexperienced`, `NewRacer`, `BrandNewRacer`)
- Factors **0.8359 – 1.3000**, per-tier Min/Max plus a `Progress` band
- ~60 non-route fallbacks keyed by discipline (`Road_`, `Dirt_`, `Cross_`, `Street_`, `Touge_`,
  `Drag_`, `Blueprint_`, `Default_` × tier) for routes without a specific entry

This is the game's own opinion of what a given skill level should achieve **on a specific road** — an
external reference for a lap, instead of comparing a build only against the driver's own history.
Open question: what the factor multiplies; a base time per route should exist in the same object
model.

Adjacent, also unimported: **`RaceTrack`** (27 docs) — Drivatar behaviour presets keyed
`<discipline>_<tier>` (`Dirt_Pro`) with `ShortcutChance`, `AlternativeRouteChance`,
`TemperamentMin/Max`, `RaceLineScale`, `RaceLineVariance`, `WetnessScale`, `WetnessTimeScale`,
`GridPosition`. That quantifies how much of a career lap is the opposition rather than the tune.

### The wider surface

`ObjectModelGame.zip` is **29.7 MB, plain Deflate, 6,969 documents across 315 TypeIds**. The project
imports **five**. All readable today with the existing `fh6_bxml.py` — no decryption, no capture.

| TypeId | docs | why |
|---|---:|---|
| `TargetTime` | 582 | per-route difficulty targets |
| `DifficultyLevel` / `DifficultyRamp` / `DifficultyUpgrade` | 613 / 53 / 7 | what a difficulty tier changes |
| `AftermarketCars` / `AftermarketRestrictions` | 179 / 67 | car eligibility rules |
| `CareerTrackChallenges` | 63 | per-track objectives |
| `RaceTrack` | 27 | Drivatar behaviour |
| `MapRegionData` | 10 | the 10 regions — would close the §8 cross-check |
| `RaceStart` | 9 | grid/start configuration |
| `EventUpgrade` | 5 | event-imposed upgrade rules |

The remainder is cinematics (723), character customisation (666), car rewards (601), quick chat and
progression — not telos data.

---

## 7. Dead ends — verified, do not re-walk

| candidate | result |
|---|---|
| `Tracks.Route` (game DB, 58 rows) | `0` on every row |
| `.nt` locator `<GUID value="…"/>` | `"0"` on all **8,117** locators, 37 files |
| `NewProfile_CareerRaces` | 0 rows, and carries `CreatorXUID` — the *Blueprint* seed, not the catalogue |
| `ref_track` / `Tracks.DisplayName` | resolves 58/58 — to Drivatar first names and test labels (`Grace`, `Natasha`, `TestPW01`); 57 of 58 at placeholder length 5954.0 |
| `EventBlueprint.csv` | UI labels only. All 69 corpus CSVs are string exports, and all 17,959 rows are byte-identical to `ref_string` |
| `route<id>.nt` filenames | ids 0, 3001–3023, 8100–8105, 40001–40044, 40900 — **0 of 22 in `ref_route`** |
| `gamedbRC_decrypted.sqlite` | **content-identical to `FH6_Database.sqlite`**, 205 tables, zero differing. Decrypting the game DB adds nothing — and it proves `FH6_Database.sqlite` *is* the decrypted `gamedbRC.slt`, answering the census's lost-provenance note |
| `DriftZones` / `Trailblazers` / `DangerSigns` / `LabyrinthRoutes` | numerically keyed so they look joinable, but the names are Spanish (`Otro Mundo`, `Barranco`, `Tierras Verdes`) — **FH5 Mexico carryover**; `SplashChoice` still says "Welcome to Mexico" |

### The 11 `ref_track_info.route_id`s that do not join `ref_route`

All explained, none is a gap: **9 Playground** (`3001`–`3023`, `GPL Docks/Spaceport/SkiResort ×
Team Survival/King/Flag Rush` — the `route<id>.nt` / `tz_playground_games` namespace), **`0`**
"Freeroam Rush", and **`4251`** "Costa Rocosa" — Spanish, FH5 carryover.

---

## 8. Held in reserve — independent spatial cross-check

Not needed while naming is catalogue-driven, but cheap if an assignment is ever disputed:

- **73 of 89** distinct `RivalsEventData` descriptions name a map region ("through the Ito Region",
  "high up into the Sotoyama Region"); `MapRegion` holds 10 names.
- `tracks\brio\trackroutes\map_region_*.nt` — 10 files with real world-coordinate extents in the
  telemetry metre frame: `canyon, city, east_coast, festival, highlands, legend_island, north_plains,
  snowy_mountains, south_coast, south_plains`.
- Point-in-polygon over route centroids agrees with the catalogue across all 101 named routes
  (*Legend Island Circuit* → `legend_island`, *Edogawa Cross Country Circuit* → `city`).

Independent of both length and the catalogue. The internal region names would need mapping to the ten
display names first — `MapRegionData` in the objectmodel (§6) may do that directly.

Also unused: `ref_track_info.description` (104 distinct) and `CareerTrackInfo`'s 224 descriptions —
the game's own prose for what each course is like.

---

## 9. Recommendations

**Do now — no new data, no capture, no decryption:**

1. **Partition every comparison on context, not just route.** Best-lap lists, baselines, conclusions,
   any A/B must not mix `solo=1` and `solo=0`. Enforceable today with the existing column; fixes a
   confound on 51% of the lap corpus.
2. **Gate `split_multilap` on `ribbon`** — never loop-cut a P2P route; a run there is anchor-entry →
   finish. Verify the mechanism (§5.2) first.
3. **Import `TargetTime`** — 582 small documents, joins `ref_route` 85/85 on a key already held, and
   it is the only source found that says what a *good* lap on a road is.

**Do soon:**

4. **Add `lap.event_id`**, populated against `ref_career_race` / `ref_rivals_event` rather than
   `ref_event`, so `n_ai`, `num_laps`, `has_traffic` and `class_id` travel with it. The `solo=1` laps
   on dual-use routes bind unambiguously today, because rivals-only is 0 and each route has exactly
   one Rivals collection.
5. **Promote `n_ai` and `has_traffic` into the comparability key.** `solo` is inferred from
   `RacePosition`; `n_ai` is the game's own number and separates a 6-AI from an 11-AI race that
   `solo=0` flattens.
6. **Use `ref_rivals_event.class_id`** rather than `lap.class` when scoping a Rivals comparison — the
   leaderboard a lap belongs to is a stronger key than the car's class at the time.
7. **Adopt `ribbon`** over the suffix heuristic and over geometry on route 8008.
8. **Import `RaceTrack`** (27 docs) to quantify opposition effects on career laps.

**Do not:**

- Treat the three remaining discipline recordings as naming work. The catalogue names every race
  route directly. They would add `length_m` to events lacking it — judge on that merit alone.
- Chase the 68 unnamed routes; free-roam ribbons, unnamed is correct.
- Attempt Time-Trial vs Rivals, or career vs multiplayer, from telemetry. The packet does not carry
  it; it must be declared.
- Describe multiplayer as absent — it is `ref_race_collection.pvp`, on 124 of 158 collections.

**Caveat on §4 and §5:** `ribbon`, `class_id` and the context fields cover the **101 catalogued routes
only**. The other 68 have geometry-derived `is_loop` and no ribbon. All are `is_race = 0` so this is
tolerable, but any rule keyed on `ribbon` needs an explicit fallback — absent ribbon must not silently
mean Circuit.
