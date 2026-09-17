---
name: fh6-class-r-vs-x
description: "Game has R (class 6, PI 901–998) and X (class 7, PI 999) as separate classes, but the lab's class maps call class 6 \"X\"; Jett says X is a special R at 999 — research open"
metadata: 
  node_type: memory
  type: project
  originSessionId: 63926deb-8e01-4766-84fa-7872acdeb097
  modified: 2026-09-11T16:46:42.354Z
---

**Measured 2026-09-11.** The game's own `ref_class`: 6 = **R**, PI 901–998; 7 = **X**, PI 999 only.
Rivals events (`ref_rivals_event`) run class_id 0–6 (86 each) — there are no X events.

**The lab mislabels class 6 as X:** `CLASS = {…, 6: "X", 7: "X"}` in `scripts/telemetry/analyze_session.py:42`
and `fh6_live_daemon.py:30`; `_CLS_ID = {…, 6: "X"}` in `scripts/db/build_web.py:584` (FH5-era convention).
All 12 laps labelled X had PI 912–998 — R cars. No R-labelled laps and no laps at PI 999 exist.

**Jett (2026-09-11):** "X is just a very special R with 999 PI, i dont think there is a difference when it
comes to laps though, more research needed."

**Why:** the class letter drives pills, lap grouping, Rivals class lists and filters; a wrong letter
mis-files laps and mis-labels badges.

**How to apply:** don't "fix" the three maps before the research question is answered (does the game ever
separate X from R — leaderboards, event restrictions, PI caps?). Working rule until then: display letter by
PI (901–998 → R, 999 → X); laps may pool R with X. Tracked as decision D4 in `design-language.md` §1.7
(recursing-bardeen worktree docs/, destined for lab docs/). Related: [[fh6-turn-design-language]].

**Telemetry confirms FH6's bands = `ref_class`** (class and PI are reported independently): D 100–400,
C 404–500, B 502–600, A 601–700, S1 702–800, S2 803–900, 901–999 for class 6/7 (labelled X).
**FIXED at `10d594c` (2026-09-11):** `classForPi()` in `dashboard/v2/panel.js` now uses FH6's bands
(D ≤400, C ≤500, B ≤600, A ≤700, S1 ≤800, S2 ≤900), matching `ref_class` at every D–S2 boundary — the
build-sheet header pill now reads A for a PI 700 car (was B under the old FH5 bands). v1's `CLS_OF_PI`
was already correct. The **top band still returns X above 900** (unchanged) — the R/X split (game R=901-998,
X=999) is open research (D4), and the lab's class maps label class 6 as X, so returning R would mix letters.
