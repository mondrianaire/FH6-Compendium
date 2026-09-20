---
name: fh6-course-keying-catalogue
description: "A course is keyed off the game's catalogued start/finish LINE (ref_route_point i=0) + the path the drive lies on — start alone is NOT unique (34/102 routes share a plaza) and the activation SPHERE is not the S/F line"
metadata: 
  node_type: memory
  type: project
  originSessionId: 6df3e83b-72ec-4c37-9c9f-0b4b3817f1f4
  modified: 2026-09-06T14:09:34.098Z
---

Implemented 2026-09-06 (commit c798e48): `analyze_session.py` seeds route attribution from the game
catalogue (`fh6.db` `ref_route` + `ref_route_point`). A drive's S/F crossing (`sx,sz`, the event's first
gated `CurrentLap>0` row) proposes every catalogued route whose start line is within 250 m, and **path
overlap** (`ov >= 0.6`, same direction) decides between them. `_catalogue_key()` runs BEFORE learned
attribution, so every fragment of one physical course (running start, mid-lap join, partial) collapses to a
stable `route:<route_id>` key and is named the first time it crosses its line — no learned history, no
completed lap. `_catalogue_starts()` / `_catalogue_path()` (lazy, cached) at module top; `model_path_for`
falls back to the catalogue path for `route:<id>` keys with no course file yet.

Two non-obvious empirical facts that forced this design (measured on the corpus):
1. **A start point is NOT unique.** Of 102 named routes, 34 share a start plaza — 10 are effectively
   co-located (0–22 m: Electric Town Circuit / The Opening Act at 1 m; Naruo CC / Airfield Trail 12 m; The
   Goliath with three Legend Island routes). A rolling start crosses the line anywhere within ~120 m, so a
   Goliath crossing can land nearer a Legend Island start than its own. Only **start + path** is unique — a
   Goliath run lies wholly on the Goliath (ov≈1.0) and only clips the plaza of routes it diverges from, which
   never reach the ov gate. This is why the [[fh6-route-anchors]] rule "corroborate geometry, never name" is
   right, and why length alone fails (a 7 km fragment of the 82 km Goliath still lies ON Goliath).
2. **The race-activation SPHERE is not the S/F line.** `race_triggers.tz` sphere 5555 (Goliath) sits at
   (4116,-5047), 419 m from the actual S/F crossing (~(4184,-5461)); a full 82 km Goliath lap drives THROUGH
   half the map's start spheres (5031, 131, 8003…). So the sphere cannot key a course. The catalogued route
   START (`ref_route_point i=0`) sits 39 m from the crossing with the next route 197 m away — that is the
   usable anchor, not the sphere. `_anchor_at()` (spheres) stays a corroborator only.

**Why:** the game emits NO route-id field in telemetry, so identity must come from position matched to the
catalogue. Grid-cell keying (rounded drive-start) fragmented one course into many keys because the capture
window opens at a drifting rolling-start approach point, not the line.

**How to apply:** never key or name a course by the activation sphere, by length, or by nearest start alone —
use nearest catalogued start (proposes) + path overlap (decides). A drive that lies <60% on every nearby
catalogued route is correctly left unidentified (it did not follow that road), not force-labeled. The DAEMON
half (name the map live at load-in off the spawn + catalogued start, disambiguated once enough path is
driven) is still pending a game-off restart. Related: [[fh6-course-identity-workflow]], [[fh6-route-anchors]],
[[fh6-turn-identification-rule]], [[lap-canon-rule]].
