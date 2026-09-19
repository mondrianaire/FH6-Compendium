# Memory Index

## Standing rules (Jett's, and hard rules)
- [FH6 course identity workflow](fh6-course-identity-workflow.md) — HARD RULE: course→route id→ref_track_info→name; never by length, .str or decryption
- [FH6 not Eliminator](fh6-not-eliminator.md) — HARD RULE: Jett never plays Eliminator for this; never raise it
- [FH6 gear ratios never need driving](fh6-gear-ratios-never-need-driving.md) — HARD RULE: gears are a verified band from disk; never suggest a WOT pull
- [FH6 gear-ladder identity solved](fh6-gear-ladder-identity-solved.md) — tied saves are settled by _pick_meta() on ~3 gears; never re-add a "full pull"
- [FH6 slider reliability hierarchy](fh6-slider-value-reliability-hierarchy.md) — HARD RULE: DB row > 2-point solve > band > formula > anchor; derived=True
- [Identity has two directions](fh6-identity-two-directions.md) — HARD RULE: forwards (telemetry→build) may use the gear ladder/PI; the reverse (distinguish/compare/A-B) MUST use hw_hash (upgrades) + tune_hash (sliders)
- [Workflow agents default to Sonnet](jett-workflow-agents-default-sonnet.md) — every workflow/subagent uses sonnet unless Jett names a reason
- [Feedback must be specific](jett-feedback-specificity.md) — name exact parts, menus, values; every slider value needs its unlock part as a shop step
- [Data-capture constraint](fh6-data-capture-constraint.md) — one global menu capture is fine; per-car capture of every menu is not
- [No OCR; detect rivals-beat by menu state](jett-no-ocr-rivals-detection.md) — 2026-09-16: no OCR going forward; detect "beat the rival" via the game's auto-launched menu (event lap done → involuntary menu → same course+cid reload); session continuity already preserved (one CSV=one sid, new rival=new stint)
- [Visual-first doctrine](jett-visual-first-doctrine.md) — dashboard = rule cards, drawers, formulas, charts; about one caption per block
- [Port perfected surfaces](jett-port-perfected-surfaces.md) — a rewrite ports a perfected surface (v1 build sheet), never redraws it
- [GitHub-first research](jett-github-first-research.md) — search GitHub before reverse-engineering; it found the game DB and the BXML reader
- [Catalog structure, not hoard](fh6-catalog-structure-not-hoard.md) — type every important field by structure; Eraser ERD EV5zhW3hPU6v4Z7PiZoW
- [Never forget a store](fh6-never-forget-a-store.md) — docs/DATA-INVENTORY.md indexes every store; read it before calling anything unknown
- [Data availability diagram](fh6-data-availability-diagram.md) — Eraser team map for onboarding new agents (car ID, live telemetry, lap/trace, course, decoded game data, stores); hand it out with DATA-INVENTORY
- [FH6 UI spec is the contract](fh6-ui-spec-is-the-contract.md) — docs/fh6-ui-spec.md + clone_parts.py rule any in-game mimic
- [Judge against the course](fh6-judge-against-the-course.md) — the recurrent bug: judge against the accumulated model, not the sample
- [FH6 turn identification](fh6-turn-identification-rule.md) — the map is the authority; matchers use its spacing; never validate against old counts
- [Turn source is ref_route_turn](fh6-turn-source-ref-route-turn.md) — the identified/displayed turns are fh6_turns/ref_route_turn; course_turn is the old ~2-3x doubled driven set
- [Sample ≠ population](fh6-sample-is-not-population.md) — two sampled files called the install "encrypted"; 8,807/8,830 zips were readable
- [Decode the whole record](fh6-decode-the-whole-record.md) — a known stride is a budget; account for every byte before reading records
- [Menu frames are dead time](fh6-menu-frames-are-dead-time.md) — in-menu UDP carries nothing usable; trust the menu-exit disk rescan
- [Shared-worktree commit race](fh6-shared-worktree-commit-race.md) — commit with a pathspec after `git diff --cached` is empty; never bare stash
- [Rebuild cascade](fh6-rebuild-cascade.md) — run scripts/db/rebuild.py, never stage scripts standalone; standalone skips course_match/route_names → courses lose names
- [Video frame time axis](fh6-video-frame-time-axis.md) — HARD RULE: sample by source frame index, never ffmpeg's fps filter; verify with -ss
- [Drift corpus discipline](fh6-drift-corpus-discipline.md) — HARD RULE: drift videos accumulate in data/drift-runs; never claim a mechanic from one video
- [Skill chain never retested](jett-drift-chain-never-retest.md) — HARD RULE: the x1–x7 skill chain is not drift score in ANY mode; never pose it as a question again
- [Tracking session is read-only](fh6-tracking-session-role.md) — the project-tracking worktree observes and reports; it never edits

## Where things stand
- [Tune-ID equip workflow](fh6-tune-identification-equip-workflow.md) — 2026-09-11: CLONING is solid (keep as-is); TUNE-ID is shaky. Guaranteed: equip build → in-game My Tuning Setup, GREY-MINUS PI tile = current tune, and equipping this way fully decodes it
- [FH6 session state 2026-09-06](fh6-session-state-2026-09-06.md) — MOSTLY SUPERSEDED snapshot; keep only for live leads (disk-tune?ts= pick bug on Build Sheets; livery-endpoint + confidence-inflation latent bugs)
- [Checkout consolidation](fh6-checkout-consolidation.md) — lab branch is the project, master a ff mirror; lab_root guard; lab_up.ps1; public Pages
- [FH6 lab runtime layout](fh6-lab-runtime-layout.md) — daemon 8765, dashboard 8000 (v1 at /, v2 at /v2/), rebuild 8001; stores in the WORKTREE
- [Course mode redesign reenact](fh6-course-mode-redesign-reenact.md) — v2 audited vs the Redesign spec + reenacted (27ec441); the deliberate deviations NOT to re-flag
- [Spec Rivals events](fh6-spec-rivals-events.md) — some Rivals give a fixed TEMPORARY car+tune; "no save on disk" is expected, tuning advice is moot, analysis is driving-only
- [FH6 dashboard monitor is portrait](fh6-dashboard-monitor-portrait.md) — 4K portrait at 200% = 1080×1920 CSS px; verify at that size
- [Drift rate law](fh6-drift-rate-law.md) — the zone pays ~260k pts per MILE, not per second; speed only covers ground sooner
- [Drift video x telemetry union](fh6-drift-video-telemetry-union.md) — videos sync to captures; body slip β (VelX/VelZ) + path explain scoring, LOVO R² 0.88; DistanceTraveled dead in free roam
- [Drift Attack x2 bonus](fh6-drift-attack-x2-bonus.md) — SETTLED (4 runs, 2 cars): bonus 2.0x, real doubling leads the cyan tag ~0.15 s in and out; tag = in area, not earning; UDP stops on rewind → auto-sync
- [Drift Attack rewind-to-start glitch](fh6-drift-attack-rewind-start-glitch.md) — ANSWERED (Jett-tested, 18/18 measured): line up at the start line; rewinds back to that first snapshot KEEP the score (compounds); later snapshots restore; board reportedly caps 750k; telemetry pins rewind targets to 0.00 m
- [Skill chain is separate](fh6-drift-skill-chain-separate.md) — online Drift race: x1-x7 chain does NOT multiply the Drift PTS ticker; ticker = distance x angle; x7.0 observed ceiling
- [Drift angle dead ends](fh6-drift-angle-channel-dead-ends.md) — HARD FINDING: angle is not in the minimap; use the UDP daemon
- [Drift rewind rollback](fh6-drift-rewind-rollback.md) — SETTLED: rewind is no penalty, it winds the run back; drop = duration x rate
- [Drift zone route channel](fh6-drift-zone-route-channel.md) — flat ticker = off the route (minimap cyan loop gone) vs on route but straight
- [FH6 turn design language](fh6-turn-design-language.md) — 5-segment model, grip=TYPICAL distribution (never worst), SEG_COL⊥DGRIP axes, two-pane turn drill-down, piBadge(); DECIDED 2026-09-11: DGRIP canonical (col/ink), Entry label, typical grip live too
- [Pedals recorded forward](fh6-pedals-recorded-forward.md) — throttle/brake on lap points only from 2026-09-11 (schema 6); no history backfill by Jett's choice
- [Turn-analysis data model](fh6-turn-analysis-data-model.md) — trace pt indices + SCHEMA-7 BUILT (peak lat_g → per-class speed-banded a_max → grip-ceiling rating); calibration facts (a_max runs hot/speed-flat); validated 2026-09-12, cross-lap bug fixed; resample downward-bias deferred
- [Turn map readability](fh6-turn-map-readability.md) — frame the whole turn (turnFrame), phase model on the road edges never under laps, every map has a legend, course legend collapsible
- [Course mode v2 rework](fh6-course-mode-v2-rework.md) — steps 1-6 + 3 money-square collapses + a_max grip-ceiling feature (overlay/rating, validated) + audit small-fix batch all BUILT; NEXT = the Finding Engine; re-audit proc = docs/pane-audit-framework.md; OPEN = build-panel faces, P2P arc, D3, deferred audit items
- [Kawazu giant-circle outlier](fh6-kawazu-giant-circle-outlier.md) — route 341 turn-ID outlier (giant loop); revisit before finishing turn ID
- [Import-gated backlog](fh6-import-gated-backlog.md) — batch for the evening 2026-09-12: game-DB re-import (stub cars 3429/4354) + telemetry reprocess; do re-import FIRST; interim cyl-bootstrap + setup_hash fix are NOT blocked
- [Knowledge artifacts](fh6-knowledge-artifacts.md) — 5 published claude.ai Artifacts from the knowledge layer (grip ceiling, drift scoring, tuning diagnostic, setup baselines, five-phase corner) + which candidates were skipped and why

## The game's data, decoded
- [FH6 object-model catalogue](fh6-objectmodel-catalogue.md) — ObjectModelGame.zip (plain zip of BXML): route ids + names; 88/88 Rivals bound
- [FH6 route anchors](fh6-route-anchors.md) — race_triggers.tz: 36 start spheres keyed by route id; corroborate geometry, never name
- [No game turn table](fh6-no-game-turn-table.md) — HARD FINDING: game stores NO turn list; dug DB + .owt; turns must be derived from geometry, never re-chase a turn table
- [Game-file refresh registry](fh6-game-file-refresh-registry.md) — TRACKER: every game input, install source, encrypted?, refresh utility, status; after an FH6 update refresh STALE rows → rebuild.py → build_web.py. EN.zip is NOT encrypted (plain zip → raw string values\*.str)
- [FH6 decrypt landscape](fh6-decrypt-landscape.md) — TransformIT white-box AES; FH6 keys only in DVS-code's service; GameDB re-decrypt PROCEDURE = `Downloads\ForzaCryptoTool.exe decrypt …\media\stripped\gamedbRC.slt -o db.sqlite` (proven 2026-09-13: 671 cars, has 4354)
- [FH6 raw data folder](fh6-raw-data-folder.md) — Downloads\forza raw data files: FH6_Database.sqlite, _& string refs; never run the exes
- [Car-switch save writes](fh6-car-switch-save-writes.md) — MEASURED: other model 0/179 writes; same-model build change 30/36; Nomad copy switch wrote the car LEFT; 'instances write no file' was unmeasured
- [FH6 savefile tune decode](fh6-savefile-tune-decode.md) — every tune = 598-byte Data + header + Thumb.png under Tuning_*; all decoded
- [FH6 slider-range derivation](fh6-slider-range-derivation.md) — every min/max/def is a game-DB physics row; open spring-floor check
- [FH6 off-map routes 102/103](fh6-offmap-routes-102-103.md) — two cut/dev circuits past the north coast; toggle shows them, never aggregated
- [Daemon ts request is a pick](fh6-daemon-ts-request-is-a-pick.md) — /disk-tune?ts= stores a 2-h pick; end every probe on the newest save
- [Locked-no-container: auction theory](fh6-locked-no-container-auction-theory.md) — unverified: locked car, no container → Auction House
- [Course keying off the catalogue](fh6-course-keying-catalogue.md) — key a course by catalogued start LINE + path (start alone isn't unique, sphere≠S/F); collapses fragments to route:<id>
- [Course corroboration hierarchy](fh6-course-corroboration-hierarchy.md) — measured: mode(RacePosition>1) is the only new load-in signal; sphere is offset; elevation/road_class/finish redundant with geometry
- [Course-file colon bug](fh6-course-file-colon-bug.md) — "unnamed course" was a Windows filename bug (route:<id>.json illegal), not ID failure; writer+reader must share the sanitiser
- [Course-identity stability 2026-09-07](fh6-course-identity-stability-2026-09-07.md) — reverse mis-ID as Sekibe (plaza collision + unnamed 2500_-5050), broken-map render (fixed), Goliath flap (fixed); reverse-recognition pending
- [Canonical-route consolidation](fh6-canonical-route-consolidation.md) — duplicate-road courses collapsed by a DB stage (canon_routes+import_consolidate); two matchers still disagree by design; never pool partials
- [Class R vs X](fh6-class-r-vs-x.md) — game: R=PI 901–998 (class 6), X=999 (class 7) are separate; lab maps class 6→"X" (mislabel); Jett: X = special R, research open (D4); v2 classForPi() FH6 bands FIXED at 10d594c (was one class off), top band still X pending R/X — D–S2 fix patch built, unapplied

## Jett and the tuning craft
- [Edamame Rivals times 2026-09-11](fh6-edamame-rivals-times-2026-09-11.md) — Jett's rank/car/time per class vs #1; not imported; screenshot paths + crop composition
- [Jett's tuning workflow](jett-tuning-workflow.md) — self-tunes from scratch; downloaded tunes are locked, so codes are not starting points
- [FH6 tuning lane split](fh6-tuning-lane-split.md) — Course (overfit via course_weight) vs General (breadth-weighted); same engine
- [FH6 external tuning sources](fh6-external-tuning-sources.md) — seven vetted guides, trust ranking, baselines; grindout/vpesports errors
- [FH6 capture-session protocol](fh6-capture-session-protocol.md) — one-screen loop; prove indices by saving a setup per tile; ~15 shots
- [FH6 skill-farm map](fh6-skill-farm-map.md) — "gl hf" share code 417 202 428; tile moved 5→6 right on 2026-07-10
- [FH6 AFK macro stack](fh6-afk-macro-stack.md) — DS4Windows Special Action setup, macro encoding, measured SP rates

## Machine
- [vmwp/WSL machine quirks](vmwp-wsl-vm-machine-quirks.md) — vmwp.exe is Claude's cowork VM; bare `bash` is the WSL launcher
- [AgentDoc MCP install workaround](agentdoc-mcp-install-workaround.md) — assistant-common is private on GitHub Packages; vendored tarball
- [Lap canon rule](fh6-lap-canon-rule.md) — HARD RULE 2026-09-06: game lap metadata (CurrentLap/LapNumber/LastLap) is canon; rewind = lap-clock reversal, cut at the landing lap clock; race clock/odometer are never axes; free-roam rewinds don't matter
