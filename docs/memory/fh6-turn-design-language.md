---
name: fh6-turn-design-language
description: "Established design vocabulary (Jett, 2026-09-03, standing) for describing any turn: the 5-segment phase model (Braking/Turn-in/Mid-corner/Exit/Straight-crest) and the 5-state grip system (calm/front/rear/both/impact; one canonical palette still pending) -- plus the PI-pill rule (never bare PI text, always piBadge()). Full standard: design-language.md (in the recursing-bardeen worktree docs/, to move to lab docs/)"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 6df3e83b-72ec-4c37-9c9f-0b4b3817f1f4
  modified: 2026-09-11T17:03:03.680Z
---

Jett's standing design language for describing any turn, established consistently between v1s
tuning tab and training-zone.json. Two orthogonal axes -- WHERE in a turn something happened, and
WHAT happened -- always described this way, never a one-off phrasing.

**The 5-segment turn model (WHERE):** Braking, Entry (renamed from "Turn-in" by Jett 2026-09-11, decision
D6; the data key stays `turn_in`; display-only, APPLIED in the lab at `75f93e2`), Mid corner, Exit, Straight/crest. This is
the canonical, complete vocabulary for any point in or around a turn.

**Verified against the actual code, 2026-09-03 -- a real, precise seam, not a rejection of the
model:** the daemon's live corner detector (`fh6_live_daemon.py`, corner detection ~line 445)
captures exactly 4 numbered phases per corner, and they map cleanly onto four of the five:
  - Phase 1 (`pre`, the 60-row window before lat-g crosses 0.35) = Braking
  - Phase 2 (up to 80% of peak lat-g) = Turn-in
  - Phase 3 (the >=80%-of-peak window) = Mid corner
  - Phase 4 (after dropping below 80%) = Exit
**Straight/crest is NOT captured as part of the same corner record at all.** The corner detector
only exists while the car is actively cornering (`abs(lat) > 0.35`); it has no concept of before/
after as part of one object. Crest detection is a SEPARATE, disconnected mechanism
(`import_diagnosis.py`'s `CREST_AIR_G` threshold) never unified into this same 4-phase numbering.
**Apply this:** before building anything that compares across all 5 segments (the "data failure
fingerprint" idea discussed 2026-09-03), this seam must be closed first -- joining crest detection
into the same phase structure as 1-4, not assumed to already be there.
**UPDATE 2026-09-11:** recorded laps now carry all 5 as geometry arc spans (`fh6_turns.py` →
`ref_route_turn.segments` → `corner_segment`, mid = curvature ≥80% of peak, connectors capped at
45 m). The seam remains for the LIVE detector (still 4 phases) and for diagnosis (entry/mid/exit
around the apex) — three derivations, see `design-language.md` §2.3 (recursing-bardeen worktree docs/, to move to lab).

**The grip-state color system (WHAT):**
  - green = within grip (state 0 / "calm")
  - blue = front slipping (state 1)
  - red = rear slipping (state 2)
  - purple = all four slipping (state 3 / "both")
  - yellow starburst icon = impact event (state 4)
The classifier is consistent (`fh6_live_daemon.py`, `analyze_session.py` ×2,
`build_course_from_laps.py`: impact if |lat|>3 g or smash; both if front>1 and rear>1; front; rear;
calm — front/rear = max |CombinedSlip| of the axle's two tyres). **The PALETTE is NOT consistent
(corrected 2026-09-11):** `DGRIP` (panel.js) ≡ v1 `GRIP` paints calm a recessive `#2a313c`, while
`TRACE_GRIP` ≡ v2 app.js `GRIP` paints calm green `#00d27a` (= the app's status tokens), and the two
use different words (understeer/oversteer/drift vs front slipping/rear slipping/all four). "Green =
within grip" is only true on speed traces. **DECIDED 2026-09-11 (Jett, D1/D2): `DGRIP` is canonical.** Fills use `col`;
lines and text use `ink` — calm's ink is the car's class colour when known, else `#8b97a7`, never green
(green is taken by "fastest" and "success"). Words on screen: within grip / understeer / oversteer / drift /
overdriven / impact / jolt; v1's axle wording goes in tooltips; `TRACE_WORD` retires. **MIGRATED in v2
2026-09-11:** one `DGRIP {col, ink, word, tip}` + `GSTATE`, `gripOf()`, `gripInk()` in dashboard/v2/panel.js;
TRACE_GRIP / TRACE_WORD / app.js GRIP deleted. Paint grip only through these (no hex literals). v1
(dashboard/app.js) is untouched. Standard: lab `docs/design-language.md` §3.2 / §4.2.

**PI PILL RULE (standing, applies everywhere):** never render PI as bare text ("PI 700", "700 PI").
Always use `piBadge(cls, pi[, sm])` — v2's is `dashboard/v2/app.js:32` (vector-drawn); v1 has a
SEPARATE PNG-art implementation at `dashboard/app.js:25` (they are not shared). Class-only:
`clsBadge(cls)`; class + count: `classPill(cls, n)`. **Class colours (D5, 2026-09-11):** one source = CSS tokens
`--pc-*` in styles.css :root, with `PI_COLORS` read from them — APPLIED in the lab at `699b990` (identical
rendering verified). Fixed
2026-09-03: the Build Sheet header (`panel.js` `openSheet()`) was showing no PI indicator at all;
wired in `piBadge(cls, pi, true)` (small variant) to match the car header exactly. Check for this
rule any time a new surface displays PI.

**How to apply:** when discussing, designing, or building anything about a turn or a grip event,
use these exact terms -- five turn segments, five grip states -- not synonyms or a re-invented
scheme. When wiring real detection logic to these categories, verify the underlying data actually
covers all five segments before assuming it does (see the crest gap above) -- the language being
established does not mean the data plumbing already matches it everywhere.

**GRIP IS THE TYPICAL DISTRIBUTION, NEVER THE WORST MOMENT (Jett 2026-09-10, HARD).** A turn/phase's
grip must be shown as the DISTRIBUTION across the 5 states, not a single worst-case label. The bug it
fixed: `corner_segment.grip_state` stored `max()` (the single worst sample) per lap-phase, so any
at-limit instant promoted the whole phase to "drift/overdriven" and every hard phase read the same
scary word (Edamame T1 showed drift for 3 of 5 parts). Fix shipped at 31ab843:
  - `corner_segment.grip_hist` (JSON `[calm,front,rear,both,impact]` sample counts) is the source of
    truth; `grip_state` is now the MODAL (typical) state. Set in `import_corners.py`.
  - `build_web` phaseObs row = `[lap, entry, min, exit, grip_state, time_s, grip_hist, mean]`.
  - `phaseAgg` (panel.js) averages grip_hist EQUAL-WEIGHT PER LAP (each lap normalised to 1 then
    meaned) into `mix` -- so one long/messy lap can't dominate -- and `grip = argmax(mix)`.
  - Render grip ONLY as a stacked DGRIP distribution bar (`gripBar`) with the legend + a plain read
    (`gripRead`: "47% within grip · drift 31%"). A lone grip swatch/word is the anti-pattern.
The two colour axes stay strictly ORTHOGONAL: SEG_COL (phase palette: braking #6c8cf0 / turn_in
#45c8b0 / mid #f0b429 / exit #63d19e / straight #8a95a5) encodes WHERE only; DGRIP encodes grip only.
Never let a phase's structural colour stand in for grip -- conflating them is exactly what confused Jett.

**TURN ANALYSIS = a two-pane per-turn drill-down (course mode, 31ab843).** Clicking a turn (map
marker, corner strip row, or ‹ › nav) opens: LEFT `turnMap()` -- the corner zoomed to fill the pane,
5 parts in SEG_COL, apex ringed, entry/apex/exit speed pills, and a phase-time RAIL whose cell widths
= median seconds per part, each filled with that part's grip mix; RIGHT `turnStatsHTML()` -- TIMING
first (time-in-turn as s and % of lap `lap_s`, a per-part time-budget bar, a best-vs-typical Δ table
flagging the part with most to find), then Information (geometry), Per-phase statistics, and a Grip
card. Every figure is a median over the active trace preset (class/build/tune) with honest lap counts.
See [[fh6-turn-source-ref-route-turn]] for where the turns themselves come from.

**KNOWN GAP (2026-09-11):** the typical-not-worst rule covers RECORDED laps only. The live corner
detector's per-phase state (`axle()` = MAX slip over the phase) and the per-second dock strip (max
within the second) are still worst-moment reads. Don't cite the rule as implemented for live views.
**Jett decided 2026-09-11 (D3): live must be TYPICAL too** — a live phase carries a sample histogram and
its modal state instead of `axle()` max; the dock strip reports the modal state of each second. Decided,
not yet implemented.
