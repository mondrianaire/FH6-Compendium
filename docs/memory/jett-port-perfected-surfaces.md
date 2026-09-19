---
name: jett-port-perfected-surfaces
description: "Jett's correction (2026-09-03) — a rewrite must PORT a surface that was already perfected (the in-game build sheet identity), never redraw it from scratch; and say so if a port is skipped"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 6df3e83b-72ec-4c37-9c9f-0b4b3817f1f4
  modified: 2026-09-03T05:30:50.391Z
---

When rebuilding a dashboard "from the ground up", surfaces that were already perfected
against the game — the v1 TAKE TO GAME build sheet: menus in the game's order, named
levels with pips, PI chips, tuning tabs with sections, values + units, slider track with
knob and pole labels — must be **ported**, not re-drawn from a new data source.

**Why:** the v2 sheet was redrawn from the database, silently dropping that identity, and
then showed impossible content (a blank aspiration row, gear slider positions printed as
ratios). Jett had spent a large amount of time getting the v1 surface right and asked why
it was abandoned. The reason (the v1 renderer was tangled in v1 closures) was a shortcut
that was never surfaced.

**How to apply:** before rewriting any presentation, list the surfaces the old version got
right and lift them (markup + stylesheet) into the new host; feed them from whichever data
source is now authoritative. If a port is skipped for cost, say so in the reply at the time.
When a rewrite changes the data source, check the new content against the old for
impossible values before showing it. See [[fh6-dashboard-redesign]],
[[fh6-judge-against-the-course]].
