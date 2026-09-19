---
name: fh6-course-mode-redesign-reenact
description: v2 course mode was audited against the imported Redesign spec and reenacted (commit 27ec441); the deliberate deviations that must NOT be re-flagged as bugs
metadata: 
  node_type: memory
  type: project
  originSessionId: 6df3e83b-72ec-4c37-9c9f-0b4b3817f1f4
  modified: 2026-09-11T08:33:35.593Z
---

The `dashboard/v2` course mode was audited against the imported Claude Design
"Course Mode - Redesign.dc.html" (design project 051332d2-244d-4e27-a533-b65ce3c2cd59,
read via the DesignSync MCP) and the 45 confirmed gaps were reenacted at commit
**27ec441** ("Course mode: reenact the redesign spec — 8 regions").

**Structural spine now (the layout that IS correct):**
- LEFT pane always = course hero → whole-course map (`.cmap`, `courseMap` in app.js) → turn list (`turnTableHTML`). Selecting a turn only HIGHLIGHTS its marker + paints its phases; the left pane never swaps.
- RIGHT pane (turn selected) = `turnStatsHTML`, which now includes the per-turn map via `cornerMapHTML` ("the corner, phase by phase"). The turn map lives HERE, not on the left.

**Deliberate deviations from the spec — do NOT "fix" these back toward the spec; they were Jett-directed after the spec was drawn:**
- Shared filter bar (`#coursefilter`, 6 presets) scoping every pane — spec put a 3-button subset inside the trace header. Keep the shared bar.
- Left map lap-time GRADIENT colouring + a "turn phases" whole-map view toggle in the floating legend (`MAP_VIEW`) — spec had flat green/blue + static legend. Keep both views.
- Fastest-passes leaderboard is car-named and uncapped/scrollable (info panes may scroll, and "which car did each lap") — spec had a capped 7-col table. Keep.
- Header stamp = build version, not a session id (deliberate, to show which code build is on screen).
- Car identity shows in TWO places by Jett's choice (commit 78dc011): the full `#hdr` band AND the spec's slim inline bar (`#idbar` / `paintIdBar`, course-mode-only, between `#hdr` and `#trace`). Both read from the same `resolutionState()`/`gateStrip()` source. Do NOT remove the inline bar as "redundant" — the redundancy is intentional.

**Layout fix that landed with this:** the left map got `min-height:210px` and the turn list beneath it scrolls (`.pane>.body.map>.grp .tt-wrap{overflow-y:auto}`) — otherwise a long turn list crushed the map to 0px under the no-scroll body.

Supersedes the v1-era plan in [[fh6-dashboard-redesign]] (that was `app.js` `liveCourseDashboard`/`.dash-body`; this is v2). See [[fh6-turn-design-language]] (SEG_COL/grip model), [[fh6-turn-identification-rule]], [[jett-visual-first-doctrine]].
