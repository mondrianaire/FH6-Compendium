# FH6 Data Source Census — 2026-09-03

A five-way sweep of every place FH6-relevant data lives: the project's own stores, the raw loose
corpus, the live game install, save containers + live runtime, and external/community sources.
Each location was then interviewed for exact format, access method, and — the point of this pass —
whether it's open, blocked-with-a-known-bypass, or blocked-with-no-known-method. Nothing found here
was previously catalogued as a single index; several items were sitting completely undocumented.

**Bottom line: three distinct "locked" mechanisms exist in this project, not one.** They need
different verbs and different follow-up, and conflating them is how "encrypted, skip" quietly
buries things that are actually one `zlib.decompress()` away from open.

| mechanism | what it looks like | example | bypass |
|---|---|---|---|
| **True ciphertext** | high-entropy bytes despite a plaintext-looking extension (`.xml`, `.ini`, `.json`) | `physics/PI.xml`, `physics/PhysicsSettings.ini`, `physics/surfaceTypes.xml` (4 MB), all of `physics/suspension/*.xml` (76 MB), `stripped/gamedbRC.slt` (15.6 MB), most save containers outside Tuning/Livery | **none found** for any of these specific files |
| **Non-standard zip compression (method 22)** | the zip container opens and lists fine; individual entries fail generic `unzip` | `GameTunableSettings.zip`, **`Rules.zip`** (contains `Eliminator.rulebot.xml`), `stateflow.zip`, `Camera.zip`, `ProfileSchema.zip` | none found yet, but structurally different from ciphertext — worth a dedicated crack attempt, `Rules.zip` first |
| **Proprietary binary, not encrypted at all** | opaque bytes, but a working decoder already exists | the game DB itself, the Grub (`burG`) asset bundle format, save Livery `C_livery` payloads | **yes — already applied** for the game DB and Grub assets; **newly confirmed and NOT yet applied** for Livery payloads (plain zlib, stdlib-decodable) |

---

## 1. The known bypass, named

The project owner's framing — "we identified a pattern of encryption before we discovered a 3rd
party tool to let us bypass that" — is **ForzaTech Studio** (`ForzaTech.Studio.zip`, 29.3 MB, in
the raw corpus at `Downloads\forza raw data files`), by developer **D3FEKT**. It's a packaged
WinUI3/WebView2 app bundling Xbox/Granny asset codecs (`granny2_x64.dll`, `xcompress64.dll`,
`xg.dll`) plus a 3D viewer. It converts Forza's proprietary binary formats — `.str` string tables,
`.carbin`, `.modelbin`, `.swatchbin` — into readable CSV/JSON, and produced the 69 string-table
CSVs already sitting in the raw corpus (validated: 287 tables, 58,722 entries, 0 parse errors,
matches the project's own `EN.zip` import exactly). **This tool is currently uncatalogued by name
anywhere in the project** — not in `DATA-INVENTORY.md`, not in the audit doc — only inferable from
script comments. It is not run automatically by any pipeline.

The decrypted game database itself (`FH6_Database.sqlite`, 205 tables) is a **separate** artifact —
found via a GitHub search, not decrypted in-house. No repo/URL for that specific file was ever
captured in docs, scripts, or memory; the citation is lost. Worth asking the project owner to name
it before it's forgotten entirely, if it's still needed.

A third, general-purpose decoder — the `importer/` folder in the raw corpus (39 files: 010-Editor
`.bt` templates + Python parsers) — handles the `burG`/"Grub" bundle header shared by every
`.materialbin`/`.swatchbin`/`.modelbin` asset in the corpus and the live install. It's community
reference material, not FH6-specific, and this project's own `fh6_swatchbin.py` independently
documents the same format for livery-thumbnail textures — unclear whether one was derived from the
other.

## 2. Blocked, no known bypass — the honest list

These are current dead ends. Listed so no future sweep re-discovers them from zero, and so none of
them get silently assumed solved.

**Game install (`C:\XboxGames\Forza Horizon 6\Content`):**
- `physics/PI.xml` (2.1 KB) — already known; the PI question is separately closed via the decrypted
  game DB, not this file.
- `physics/PhysicsSettings.ini` (68.7 KB) — newly confirmed encrypted; global physics constants.
- `physics/surfaceTypes.xml` (4.0 MB) — the largest single encrypted file found; likely the
  authoritative surface/material table (a *readable* smaller cousin, `NatalSurfaceTypes.xml`,
  exists — see §3).
- `physics/suspension/*.xml` + `physics/suspension/t10/*.xml` (159 files, 76 MB) — current-gen
  suspension geometry per class (~150 named types). High value if ever cracked. A *legacy* (pre-FH6,
  2015-dated) version of this exact data exists fully readable — see §3.
- `stripped/gamedbRC.slt` (15.6 MB) — name suggests a render-chunk copy of the game DB; distinct
  from the GitHub-sourced decrypted copy, not a decryption of this file.
- `nerddata/NerdData.json` (564 B) — already known.

**Save containers (`C:\XboxGames\GameSave\pgs\...\ContainersRoot`):** one consistent high-entropy
byte shape, distinct from the plaintext Tuning/Livery containers, across: `GarageLayout_<uuid>`
(8 containers), `Estate_<uuid>` (2), `PropPrefab_<uuid>` data blob (1, though its `thumb.png` sibling
*is* a normal viewable image), `CustomRoute_0000_<ts>` data (1 — course-shaped and telos-adjacent,
but only one sample exists so there's nothing to differential-analyze even if a bypass were found),
`C_GarageLayoutsDataContainer` index blob, and the entire `User_<id>` profile bucket (496 files,
~19 MB) — including all 495 `CampaignThumb_*` files, which despite the name are **not images**
(no PNG/WebP/JPEG magic bytes; byte-identical shape to the encrypted `Meta` file next to them).
None of these are tuning-relevant even if cracked, except `CustomRoute`.

**Not yet attempted (unconfirmed, low priority):** `physics/{Lights,LightPresets,ManufacturerColors,physicsdefinition}.bin` at the install root — generic-binary per `file`, small, flagged for a look but not urgent given their tiny size suggests scene/rig data, not tuning.

## 3. Locked-but-crackable — worth a dedicated attempt, ranked

1. **`Rules.zip`** (5.3 MB, 441 entries, method-22 compression) — contains `Eliminator.rulebot.xml`
   and `Eliminator.rulebot.bin`, plus `EliminatorVO.rulebot.xml`, `AnnouncerVO`,
   `DynamicQuickChatRules`, `Estate`, and others. **This is the actual Eliminator game-mode rule
   definition file** — directly on-topic for `data/eliminator-tips.json` and this branch's own
   name. The zip container opens and lists fine; only the entry compression (method 22) blocks
   extraction. This is structurally different from true ciphertext and is the single best
   candidate in this whole census for a focused crack attempt.
2. **`GameTunableSettings.zip`** (1.85 MB, same method-22 lock) — already known undecodable, but
   now correctly re-diagnosed as compression, not encryption. Contains `ANNARecommendations.xml`
   (the game's own recommendation-engine config — notable given this project's telos is explicitly
   about data-backed recommendations).
3. `stateflow.zip`, `Camera.zip`, `ProfileSchema.zip` (0.5–0.6 MB each) — same lock, lower priority
   (gameplay trigger / camera / profile-schema config, less obviously telos-relevant).

The pattern is now clean: **gameplay-config zips use method-22 compression; asset zips
(`Cinematics.zip`, `Particles.zip`, `Sky.zip`, etc.) use ordinary Deflate and open fine.** That's a
reliable predictor for where to expect this lock in the rest of the install.

## 4. A bypass that exists but has never been used

**`save-livery-containers`** — `Livery_<ordinal>_<ts>\C_livery` (373 containers), plus
`SoulBoundLivery_*`/`BaseLivery_*` variants (92 more), 465 total, ~21.4 MB. The daemon already uses
these folders' existence and mtime (`/liveries`, `/livery-thumb`, `data/build-liveries.json`), but
**the payload itself has never been opened by any script.** Verified this pass: `C_livery` is an
8-byte length header followed by a plain `zlib`-compressed payload; `zlib.decompress()` succeeds
cleanly and yields a structured chunk stream (FourCC tags `vlrc`/`yrvl`/`gyvl`, float records
consistent with RGBA + geometry) — per-build paint color and pattern-layer data, decodable today
with the Python standard library, no tool needed. Currently untapped.

## 5. High-priority findings that aren't about encryption at all

- **`captures/fh6_<ts>.csv.gz`** (project root) — **the single largest data store in the project**:
  120 files, ~16.5 GB, roughly 150× the size of `fh6.db`. This is the live daemon's own raw
  recording of every telemetry tick ever received (`CAPTURE_ROLL_MB` rolls it every 192 MB),
  upstream of the entire sessions pipeline (`analyze_session.py` reads it to produce
  `data/sessions/*.json`). It carries the full 99-column per-tick schema at full resolution —
  every wheel's `SlipRatio`/`SlipAngle`/`CombinedSlip`/`SuspTravelM`/`OnRumble`/`InPuddle`/
  `SurfaceRumble`/`WheelRotSpeed`, not the reduced subset that survives into the SSE `frame` event
  or the session JSONs. **Zero mentions in `DATA-INVENTORY.md` or the audit doc.** Not an access
  problem — a pure documentation and re-import gap. Files observed span only 2026-08-23 through
  2026-08-29 despite sessions continuing past that date; worth confirming whether recording
  silently stopped or was pruned.
- **`data/game-strings/*.json`** (22 files, 487 KB) — JSON exports of specific game-DB/string
  tables, apparently produced as a readable intermediate layer before import. **Absent from both
  existing docs**, despite directly overlapping audit finding 5's "twelve enum keys never
  imported" list — `List_CarMake.json`, `List_Aspiration.json`, `List_Cylinders.json`,
  `List_EngineConfig.json` are all sitting here already exported. **The audit doc says these enum
  tables are unimported from the game DB; this shows someone already did the export step — the
  remaining gap is JSON→SQL import, not source access.** Also includes `CareerTrackInfo.json` and
  `RivalsEventData.json`, plausible leads for finding 4's empty `ref_event`.
- **`data/sessions/*.tags.json`** (107 files) — a distinct schema sibling to the 128 raw session
  files, stint-segmentation markers, completely undocumented. 21 sessions are untagged.
- **`data/builds/`** — a hand-transcribed build-sheet format with a clear, well-designed schema
  (`_template.json`'s `_purpose` field explains it fully) but only **1 real record** exists. Designed,
  barely used.
- **`data/_backup_courses_*` and siblings** (14 directories, 466 files, ~90 MB) — pure historical
  snapshots from prior course-merge work, undocumented, worth a retention decision rather than
  cataloguing as live data.
- **`data/eliminator-tips.json`** — the file this branch is named for. A mature, well-sourced guide
  store (mechanics, car tiers, tips, patch history, a `retracted` section for debunked claims) with
  **no corresponding table in the 53-table `fh6.db` schema at all.** Combined with the `Rules.zip`
  find in §3, this is almost certainly the actual target of the "-db" branch name.
- **Live daemon doc drift**: `GET /session.json` exists in source but is missing from
  `DATA-INVENTORY.md`'s endpoint list; the SSE channel list there omits `snapshot` (full-state dump)
  and `frame` (the continuous per-tick stream) — arguably the two structurally most important
  channels, since every named event is sparse while `frame` is the constant one everything else
  rides alongside.
- **Physics: two parallel suspension-geometry sources.** `physics/suspension/legacy/` (89 XML +
  88 matching JPG diagrams, dated 2015, pre-FH6) is **fully readable** — roll-centre height, kingpin
  angle, scrub radius, caster, motion ratio, anti-squat %, toe-in, plus locator XYZ coordinates —
  but it's the *old* template set, not confirmed to match what FH6 assigns per car today (that
  assignment lives in the encrypted current-gen files, §2). Useful as a naming/geometry reference,
  not confirmed current data.
- **`physics/{BreakEffects,CollObjects,GroundCoverSurfaceMap,NatalSurfaceTypes,RaceEffectsPresence,
  SmashableObjectTypes,TireEffectsDefinitions}.xml`** — fully readable, unmined. `NatalSurfaceTypes.xml`
  (199 KB) is a full `Car×{HardWorld,SoftWorld,RumbleStrip,TireWall,GuardRail,...}`
  friction-coefficient + elasticity table — a *different* friction axis from `ref_friction_curve`
  (tyre-compound curves) — could sharpen the paved/loose distinction already recovered in
  `ref_route_surface`.
- **`cars/<CODE>.zip → physicsdefinition.bin`** — a per-car family (662 files, ~1.5–2.5 KB each),
  distinct from the single root-level 1,584-byte file the audit already flagged. Hex inspection
  shows float-like patterns and repeated byte runs — not high-entropy — an undocumented but
  plausibly crackable structured binary, likely per-car mass/CG/suspension-limit constants.
- **`tracks/brio/trackroutes/eliminator_locators.nt`** (live install, readable XML) — 100 numbered
  Eliminator drop points with full world transforms. Confirms the `.nt` locator pattern the audit
  already named in the raw corpus also exists live in the install, Eliminator-specific.
- **`tracks/brio/triggerzones/tz_races/*`** — per-race trigger-zone polygons at route ids
  3333–3336 and 8001–8005, a namespace that didn't overlap any of the 169 routes already in
  `ref_route` — worth checking against `course.event_id`.
- **`stripped/gs/substitutionlists/*.sublist`** (4 files) — small, readable, event-name-adjacent
  (`fortecrosscountryevent`, `fortedirtevent`, `forteforzathonevent`, `forterushevent`), unopened.

## 6. Confirmed dead / redundant (no further action)

- `full forza DB - Copy.db` — byte-identical content to `FH6_Database.sqlite`, different page
  layout. Redundant.
- The ONYX vehicle database (638 car ids) — redundant now that `ref_car` holds 660 rows from the
  game DB.
- Three stray non-project files in the raw corpus root (`Claude-logs-2026-09-02....zip`, `POKER.txt`,
  `asdfasdf.pdf`) — not Forza data, accidental Downloads-folder drops. Recommend removing so future
  sweeps don't re-triage them.
- Two unrun executables, deliberately never run per existing project rule: `FH6 Helper_
  [unknowncheats.me]_.exe` (cheat-site origin, function unconfirmed) and `LapSmith-Setup-0.2.2.exe`
  (93.3 MB, unverified third-party lap timer — name suggests camp-B relevance but never installed
  or examined). `DB.Browser.for.SQLite...msi` is just a generic SQLite viewer, not Forza-specific.
- Bulk art/material assets (`.materialbin`/`.swatchbin`/`.modelbin`, ~3,020 files, 170+ MB in the
  corpus alone, plus `cars/`'s 16 GB and `hdrskies/`'s 13.6 GB in the live install) — binary-opaque
  but not encrypted, decoder known (§1), confirmed art/paint/scene geometry, not tuning data.
- `wheeltunablesettingspc.zip` — fully readable INI, but confirmed peripheral/force-feedback
  hardware config, not car tuning. Worth naming so "tunable settings" isn't chased here again.
- `brakes/*.zip` — checked directly: 3D geometry only, no physics/spec data inside.

## 7. External sources and tools (vetted, community, official)

| source | what it provides | reliability |
|---|---|---|
| **ForzaTech Studio** (D3FEKT) | the decode/extract tool itself — see §1 | primary, in active indirect use |
| **The seven vetted tuning guides** (memory: `fh6-external-tuning-sources`) | consensus baselines baked into `dashboard/app.js` `SLIDER_BASE` and `data/formulas.json` | ★★★ forzatune.com, forza.guide · ★★½ gamingpromax.com · ★½ grindout.com (known bump/rebound-ratio error), skycoach.gg · ★ vpesports.com (known diff-direction error) · forzafire.com (tool site) — **this ranking exists only in memory, not in either doc** |
| **`data/sources.json`** | master tiered bibliography (19 primary / 28 expert / 50 community, ~90 URLs) backing car-meta/tier-list/progression/eliminator claims | has its own explicit `hierarchy_note` |
| **`data/tuner-sheets.json`** (875 KB — largest file in `data/`) | 2,344 raw tune codes from 6 community tuners → 1,659 unique after dedup | the single biggest external tune corpus; its `DATA-INVENTORY.md` row has a **blank description** despite this scale |
| **codmunity.gg** | live community drag-time database, cited per-datapoint inside `data/meta-cars.json` | community, attributed |
| **Official Forza Support** (support.forza.net Zendesk) | 6 release-notes articles, Eliminator FAQ, the Data Out Documentation article (id `51744149102611`, JSON-API mirror used because the HTML page 403s) | primary/official tier |
| **ClickClickMedia/Forza-6-telemetry** (GitHub) | understeer/oversteer/wheelspin/lockup detection formulas the project's own diagnosis logic is checked against | cited in `docs/research/fh6-data-out.md`, which is itself missing from `DATA-INVENTORY.md`'s own doc index |
| Community ordinal tables | `gist.githubusercontent.com/HDR/...` (primary), `raw.githubusercontent.com/mavanmanen/fh6-car-database` (mirror) — live-fetched by `fetch_car_ordinals.py` into `car-ordinals.json` | only cited in the script, not in any doc |

## 8. What this means for the database scaffolding

Three things fall directly out of this census, ranked by leverage:

1. **`data/game-strings/*.json` closes most of audit finding 5's enum-import gap for free** — the
   export step already happened; what's missing is a JSON→`fh6.db` import script, not new source
   access. This is now the cheapest unclaimed win in the project.
2. **The livery `C_livery` zlib bypass (§4) and the `Rules.zip` Eliminator file (§3) are new,
   concrete capability, not just documentation** — a per-build paint/pattern table is one
   `zlib.decompress()` call away, and the actual Eliminator rule definitions sit inside a
   compression lock, not encryption, making them the best next target for this branch's own
   purpose.
3. **The `captures/` 16.5 GB archive (§5) is the deepest telemetry resource in the project and
   isn't in the inventory at all.** Any "long-lasting, conceptually aware" database scaffolding
   needs to decide, explicitly, whether it's a re-import source (full per-wheel-channel resolution)
   or an intentionally-excluded raw layer — right now it's neither, just unlisted.

None of this contradicts the 2026-09-03 data audit's own findings; it sits one layer upstream —
the audit judged what's *in* `fh6.db` against the telos, this census judged what data *exists on
disk or on the network* against the same telos, independent of whether it's imported yet.
