# Handoff — route and course name identification, 2026-09-05

**The short version:** the method already in the repo is the right one and needs no redesign. What
this pass adds is *proof of the negatives* — the game ships course names and route ids in separate
key spaces with every bridging column zeroed, and I verified that exhaustively so nobody spends
another session looking for the join. The only missing input is a screen capture the project has
already specified.

Read alongside `docs/rivals-routes-capture.md` (the capture procedure) and the module docstrings of
`scripts/db/import_events.py` and `scripts/db/import_route_names.py`, which are the authority on the
rules themselves.

---

## 1. The rule

> **A route name is earned from map identity or catalogue length, never from an id in the game data.
> There is no id that carries it.**

Names live in `ref_string`. Routes live in `ref_route`. Nothing in any shipped file connects them.
Every derivation must therefore go through geometry (where the car actually drove) or through the
catalogue length read off the Rivals screen — which is exactly what `import_route_names.py`'s three
tiers already do.

## 2. Dead ends — verified, do not re-walk

Each of these looks like the missing link. None is. Measured 2026-09-05 against
`FH6_Database.sqlite`, the install at `Content\media`, and `data/fh6.db`.

| candidate | why it looks right | measured result |
|---|---|---|
| `Tracks.Route` (game DB, 58 rows) | a column literally named `Route` on the track table | **`0` on every row** |
| `.nt` locator `<GUID value="…"/>` | 8,117 locators across 37 files, each with a GUID field | **`"0"` on every locator** |
| `NewProfile_CareerRaces` | has `TrackId`, `CustomRoute`, `RouteContainerName` | **0 rows** |
| `ref_track` / `Tracks.DisplayName` | 58 rows of `_&hash` refs that *do* resolve | resolves **58/58** — to Drivatar first names and test labels (`Grace`, `Natasha`, `TestPW01`, `rendertest`), 57 of 58 at placeholder length 5954.0 |
| `EventBlueprint.csv` (625 rows) | the name promises event definitions | **UI labels only** (`IDS_AICountLabel` → "Max Number Of Drivatars") — like all 69 corpus CSVs it is a pure string export |
| `route<id>.nt` filenames | 22 files whose names are route ids | ids 0, 3001–3023, 8100–8105, 40001–40044, 40900 — **0 of 22 appear in `ref_route`** (169 ids, 41–30106). A disjoint blueprint namespace |

**The exhaustive check.** I extracted the **700 distinct GUIDs** used as keys in `CareerTrackInfo`
and `CareerRace`, then searched:

- every text column of all **205 tables** in `FH6_Database.sqlite` → **0 hits**
- all **262 readable files** under `Content\media\tracks\` → **0 hits**

The GUIDs appear only in the string tables that define them. The event *definition* layer — route id,
class limit, PI limit — is genuinely not on disk, which is what audit finding 4 concluded. That
conclusion is now proven rather than inferred, and F4 should be closed as "no source exists" for the
binding half, leaving only the derivation work below.

## 3. The trap that will cost someone a day

`DriftZones` (31), `Trailblazers` (18), `DangerSigns` (38) and `LabyrinthRoutes` (12) are
**numerically keyed** — `IDS_drift_zone_31A`, `IDS_trailblazer_20`, `IDS_danger_sign_08`. Integer keys
look joinable in a way GUIDs do not, so these are the tables a future sweep will reach for first.

They are **FH5 Mexico carryover**. The names are Spanish: `Otro Mundo`, `Barranco`, `Granjas`,
`Tierras Verdes`, `Puerta Pétrea`, `Cara Este`. `SplashChoice` still contains "Welcome to Mexico".
FH6 is Japan — Narai-Juku, Hakone, Edogawa, Irokawa, Sotoyama. `LabyrinthRoutes` (`Ice Rink`,
`Stunt Park`, `Winter Wonderland`) is event-arena carryover of the same kind.

**Do not bind any of these to an FH6 route.** A numeric key that happens to land in range is a
coincidence, not a join.

## 4. The correct method — already implemented

`scripts/db/import_route_names.py`, precedence **map > declared > length**:

- **map** — `course_route.match_kind` is `verified` or `probable`, identifying a game route R; R and a
  Rivals catalogue event agree on length, checked against both R's own length and the driven course's.
  This tier names the course *and* `ref_route.name`.
- **length** — no map identity, but the course's path closes (start ≈ end within `LOOP_GAP_M`), so its
  length alone can match a *Circuit* event — **provided the match is bijective**. Never names
  `ref_route`: a length match is evidence about the course, not proof of which physical road it is.
- **declared** — what a person typed in `data/routes.json` or the course model. **The typed word is
  the final word:** on disagreement the typed name is what `course.name` shows, and the derivation is
  retained as a `chosen=0` `course_event` row.

Every candidate considered becomes a `course_event` row; `chosen=1` marks the one that named the
course. An ambiguity is a row, never a silent guess. Keep that property — it is what makes the naming
auditable, and it is the reason a wrong name is recoverable rather than baked in.

Upstream, `scripts/db/import_events.py` treats every GUID as a **checked join re-proven on each run**:
a GUID absent from `ref_string`, or present with content disagreeing with the transcribed name, fails
the whole stage. Do not relax this to "import what resolves" — it is the guard that keeps an OCR slip
out of the name layer.

Rebuild cascade (`scripts/db/rebuild.py` `DOWNSTREAM`): `gamedb → events → route_names`, and
`telemetry`/`routes`/`surface`/`course_match` all feed `route_names`. After adding a discipline file,
`--only events` is enough; the cascade carries it to `route_names`.

## 5. Current state, measured

| | value |
|---|---|
| distinct Rivals course names in `RivalsEventData` | **88** (604 GUID-keyed rows; exactly 7 GUIDs per name for 86 of them) |
| in `ref_event` | 88 — **23** complete (`discipline='road'`, length + is_loop), **65** name-only |
| of the 65: with `length_m` | **0** |
| of the 65: with `is_loop` | 8 (suffix-inferred only) |
| `ref_route.name` populated | **4 of 169** |
| `course.name` populated | **8 of 74** (4 `derived:map`, 2 `derived:*+declared`, 2 `declared`) |
| `course_route` match kinds | verified 8 · probable 2 · partial 34 · none 21 |

## 6. The remaining work

**The single blocking input is `Route Length: X.X MI` per route**, which exists only on the
Rivals › Routes screen. Everything else — names, the 7 GUIDs each, descriptions — is already in
`ref_string`.

Per `docs/rivals-routes-capture.md`, four discipline recordings remain: **Dirt Racing, Cross Country,
Street Scene, Drag Racing** — the 65 name-only routes between them. About three minutes of capture
each, then:

```bash
python scripts/telemetry/transcribe_rivals_routes.py "<recording>.mp4" --discipline "Dirt Racing"
```

Validate the transcriber against the known-good file before trusting a new discipline:

```bash
python scripts/telemetry/transcribe_rivals_routes.py "<road recording>.mp4" --discipline "Road Racing" --expect data/rivals-routes-road.json
```

Then `--only events` and let the cascade run.

This is a **global menu capture** — one list, nothing per car, nothing repeated — which is the kind
the project's data-capture rule permits.

The 65 names sort by suffix into: Trail 10 · Scramble 10 · Cross Country 10 · Cross Country Circuit 8 ·
Run 3 · Chase 3 · Drag Strip 3 · Descent 3 · Climb 1 · Skyline 1 · other 13 (`Mt. Haruna`,
`Hakone Nanamagari`, `Arashiyama Takao`, `The Gauntlet`, `The Titan`, `Flight Club`, …). Use that only
to sanity-check a recording's coverage — the discipline tag must come from the screen it was recorded
from, not from the suffix.

Note `Hakone Nanamagari` is already in `course` as a **declared** name read from the game; when its
catalogue row lands, it becomes a cross-check on the derivation rather than a new name — a useful
first validation case.

## 7. One unused layer worth taking afterwards

`CareerTrackInfo` holds **224 names and 224 prose descriptions**, GUID-keyed and currently untouched:

> "A hill climb leads high up into the Sotoyama Region…"
> "This drag strip runs alongside the Irokawa Space Center…"
> "Race in and around the Horizon Stadium as you tackle…"

`RivalsEventData` carries its own descriptions the same way (7 disjoint `IDS_Description` GUIDs per
route), and `import_events.py` already reads them. `CareerTrackInfo`'s are a separate, larger set
covering career events rather than Rivals routes. They describe each course's character in the game's
own words — worth surfacing once a course is named, and free.

Do **not** try to use `CareerTrackInfo` as a naming *source*: its GUIDs are among the 700 proven to
bind to nothing (§2). It is a description layer to hang off a name already derived, not a way to
derive one.

---

# ADDENDUM — 2026-09-05, second pass

Pushback received: *"there has to be a better method of route identification."* There is, and it is
not a recording. But it improves **route identification**, not **route naming** — those are two
different problems and conflating them is why the search kept dead-ending.

## A. NEW — `race_triggers.tz` is a real, verified route-id anchor

`Content\media\tracks\brio\triggerzones\tz_race_activations\race_triggers.tz` — **plaintext XML,
14 KB, opened by nothing in the project and named in none of the audit documents.**

It holds 36 spheres of the form:

```xml
<triggerzone type="sphere" name="race_trigger_zone_rt101" ...>
  <position x="3070.162566" y="116.421829" z="2574.534235" />
  <size x="100.0" y="100.0" z="100.0" />
```

The `rt<N>` suffix **is a `ref_route.route_id`**, and unlike every other candidate id field in the
game data it is not zeroed:

| check | result |
|---|---|
| trigger zones | 36, all `race_trigger_zone_rt<N>` |
| `rt<N>` present in `ref_route` | **36 / 36** |
| positions in the telemetry metre frame | yes — same frame as `ref_route_point` |
| trigger within 50 m of its **own** route polyline | **28 / 36** (many sub-metre: 0.2, 0.6, 0.7, 1.0 m) |

The 8 outliers are 60–285 m out, consistent with an activation marker sitting beside the road rather
than on the centre-line. That is a tolerance question, not a failed join.

**Why this is better than what the naming rule uses today.** `course_route` identity is currently a
post-hoc geometric comparison of a driven course against 169 centre-lines, and it lands on
verified 8 · probable 2 · **partial 34 · none 21**. The trigger zones give a *direct* identification
instead: at the moment an event starts, the car is inside a 100 m sphere whose name carries the route
id. Telemetry already reports position every tick, so the daemon can read the route id off the world
rather than infer it from shape afterwards.

Concretely, this gives three things for free:

1. **Runtime route id** for the 36 race routes — no geometry matching, no ambiguity, no capture.
2. **A hard anchor for `course_match`** — a course whose laps start inside `rt<N>` *is* route N; that
   is evidence stronger than any polyline comparison, and it should outrank `verified` in the
   match-kind ladder.
3. **It disambiguates equal-length routes.** The main agent's Soni/Irokawa case (both 1.2 mi) is
   unresolvable by the length key but trivially separated by position — which removes the single
   biggest weakness of the length tier.

It also independently marks **which** of the 169 routes are race routes (36) versus free-roam
ribbons — a distinction `ref_route` does not currently carry.

**Caveat, stated plainly:** this yields a route *id*, not a *name*. It makes the eventual name binding
exact and permanent instead of length-inferred, and it improves matching today with no capture at all.
But on its own it does not name anything.

Adjacent, unexamined: `tz_races/triggers_route_{3333-3336,8001-8005}.tz` and
`tz_playground_games/triggers_route_{3003,3013,3023}.tz` are mesh polygons in a **different** id
namespace (none of those ids are in `ref_route`) — do not mix them with the `rt<N>` set.

## B. Option 1 (decode the event datasets) — now largely closed

Three independent searches, all negative:

1. **Name-hash scan of the install.** `ref_string` keys are 32-bit hashes, so a binary referencing a
   name would store the number, not the ASCII GUID (the earlier pass only searched text). I scanned
   every non-art file under `media/` for the 88 Rivals course-name hashes as little-endian u32.
   The only hits are 2–3 per file inside **compressed** archives (`PopcornFX.zip`, `particles/Shaders.zip`,
   `cinematic_assets/*.zip`, `ui/.../Series4.zip`) — chance collisions in high-entropy data, no
   structured reference anywhere.
2. **The route files carry no name.** All 169 `.owt` + 169 `.nav`: no header field at any offset
   0–128 matches a string hash on any file, and a full-file u32 scan hits a `RivalsEventData` hash in
   3 of 338 files — collision-level. The `FTWO` header is version/hash/size only.
3. **No coordinate table in the game DB.** Nothing in the 205 tables carries world positions that
   could be matched against the trigger spheres.

Add the previously-established zeros — `Tracks.Route` = 0 on all 58 rows, `.nt` GUIDs = "0" on all
8,117, and `NewProfile_CareerRaces` = 0 rows (and it is a *new-profile seed* for Blueprint races,
carrying `CreatorXUID`, not the shipped catalogue) — and the conclusion is that the event definition
layer is not present in the install in any decodable form.

**The one place left.** `stripped/gamedbRC.slt` is **15.6 MB and encrypted**; the GitHub-sourced
`FH6_Database.sqlite` is **13.3 MB**. That 2.3 MB gap is the only remaining candidate for the shipped
event catalogue, and it sits behind the same unbroken cipher as `PI.xml` (16-byte IV + u32 + AES-block
-aligned payload — see the census verification, §5). Per the GitHub-first rule, the question to ask is
not "can we decrypt it" but **"has anyone published a decrypted `gamedbRC.slt` or an FH6 event-table
dump?"** — the same route that produced `FH6_Database.sqlite` in the first place. That is the cheapest
next step for option 1, and it is a search, not a decode.

## C. Revised recommendation

1. **Import `race_triggers.tz` now.** 14 KB of plaintext, 36/36 verified ids, no capture, no
   permission needed. Add `ref_route.is_race` and a `route_anchor` (x, z, radius); teach
   `import_course_match.py` to prefer an anchor hit over a geometry verdict; teach the daemon to
   report the route id when position enters a sphere. This is the better method for route
   **identification** and it is available today.
2. **GitHub search for a decrypted `gamedbRC.slt` / FH6 event tables** before anything else on the
   naming side — it is the only path that would name all 88 Rivals routes *and* the career events
   without a capture.
3. **Only then the recordings**, and if they happen, prefer the main agent's option 2 (match the
   route outline shown on the Routes screen, not just the printed length) — with the trigger anchors
   in place, the outline match has 36 known-correct answers to validate against, which turns a
   subjective shape comparison into a measurable one.

What has *not* changed: there is still no name↔route binding on disk, and `import_route_names.py`'s
three-tier rule remains correct. The addendum narrows the gap to the name half only, and hands the
route half a better key than the one in use.
