---
name: fh6-session-state-2026-09-06
description: "End-of-session snapshot 2026-09-06 (lab branch at bf57213, master mirrored): what is settled (names from the game's catalogue, anchors, surface key, consolidation), the open queue in priority order, and the decisions Jett made that must not be re-litigated"
metadata: 
  node_type: memory
  type: project
  originSessionId: 6df3e83b-72ec-4c37-9c9f-0b4b3817f1f4
  modified: 2026-09-12T23:01:48.610Z
---

**⚠ MOSTLY SUPERSEDED (flagged 2026-09-12).** This is a dated snapshot; most of the "settled" facts now live
in dedicated memories and most of the "open queue" is done (course-mode v2 fully rebuilt, schema-7 a_max shipped).
KEEP it only for the still-live LEADS that aren't captured elsewhere: (a) the slider-value A/B diff's read probe
calls `/disk-tune?ts=<older save>` which the daemon treats as a user PICK and persists 2 h — opening a Build Sheet
on a variation build can repoint identity to the stale save (fix: a read-only flag on that probe); (b) known-but-
unfixed 2026-09-03 bugs — `_auto_assoc_livery` writes build-liveries.json but the `/liveries` endpoint never reads
it (livery mismatch); `tune_to_deliverable()` hardcodes status='measured', confidence=1.0 on every row (confidence
inflation). Verify these against current code before acting — they may already be fixed.

**State at 2026-09-06 04:00 ET.** Branch claude/forza-eliminator-tips-db-c512c3 == master (bf57213),
tree clean of tracked changes, full 16-stage rebuild 41 s, `--check` PASSED, 55 tests green. Lab
runtime: daemon 8765, dashboard 8000 (/v2/), rebuild service 8001, all from THIS worktree
(scripts/lab_up.ps1). Stores committed through 2026-09-06 (sessions, courses, routes.json, PI obs).

**Settled this session (do not reopen):**
- Course id -> geometry -> common name: [[fh6-course-identity-workflow]] (HARD RULE) via
  media/ObjectModelGame.zip; 18/76 courses named by the game, 101/169 routes, 88/88 Rivals bound.
- race_triggers.tz anchors corroborate geometry, never name; majority rule; 'anchored' keeps
  route_id NULL ([[fh6-route-anchors]]).
- road_class is a KEY by discipline (road/street/drag need paved; dirt/cross-country need
  mixed|loose) in the map tier, which is now only a cross-check.
- .owt files are section graphs (route 132 = The Colossus fixed by the spawned session, commit
  3650571). Routes 2041 (Tateyama Kurobe Sprint) and 2071 (Takashiro Trail) still read 1.5x their
  event length -- same shape, next parser look; the check only WARNs.
- Decryption: not needed for names. FH6_Database.sqlite == decrypted gamedbRC.slt (proven);
  GameTunableSettings.zip decrypted by Jett via DVS-code (no catalogue); sfsdata untouched.
- Consolidation: all worktrees merged or empty; origin push stays frozen (Jett's choice); three
  locked worktree folders clear on reboot; workflow agents default to Sonnet (Jett's rule).

**Open queue, priority order:**
1. Build Sheet overflow (5,289 px in an 819 px pane, no scrollbars) -- Jett's oldest ask.
2. A/B testing regimen. Jett's reframe (2026-09-03, final): the PRIMARY goal is telemetry /
   driving-behaviour comparison between build A and build B (slip, lat-g, corner balance, the
   per-build_id corner and lap data already recorded; docs/dashboard-states.md section 6 names the
   chartable variable per failure mode). The slider-value diff IS BUILT (commit dd78f9b:
   diffSliderRows/vdot in live.js, applyVariationDiff in panel.js) -- the 09-06 audit corrected my
   "nothing built" claim -- but carries a real bug: its read probes call /disk-tune?ts=<older save>,
   which the daemon treats as a user PICK and persists for 2 h ([[fh6-daemon-ts-request-is-a-pick]]);
   opening a Build Sheet on a variation build can repoint identity to the stale save. Fix: a
   read-only flag on that probe (or a separate endpoint) before trusting the feature.
3. Routes 2041/2071 section parse; anchor WARN on -4750_-1550 (1 start in 5041's sphere).
4. Use ref_car_restriction (class/PI/power/weight bounds per event) on the tuning side.
5. Optional: Cross Country / Street Scene / Drag Rivals recordings (displayed length only).
6. Earlier backlog: upgrade-gating research, data-failure fingerprint system, free-mode tabs
   (Course Codex), corpus-based empty-slot states, dashboard title area + rating band.
7. Known-but-unfixed from 2026-09-03: livery picture mismatch (`_auto_assoc_livery` computes the
   per-build match into build-liveries.json but the `/liveries` endpoint never reads it; check its
   sig hash equals MATCH.build's hw id first); `tune_to_deliverable()` hardcodes status='measured',
   confidence=1.0 on every row (confidence inflation); the "re-apply from Find Tuning Setups"
   banner in live.js is uncited and contradicts Jett's experience -- watch real save-container
   timestamps on a Tune Browser download before believing it; choppy live map dot (SSE is 20 Hz;
   suspect `addLiveDot` reading a rebuilt `<svg>`'s calibration -- log both before changing code).

**Doctrine reminders that bit this session:** judge against the accumulated model; a header
count is not a layout; decode one entry before dismissing an archive; commit with a pathspec
after `git diff --cached` is empty; never bare `git stash`; the typed word is final.
