---
name: fh6-turn-map-readability
description: "Jett's rules for any turn/corner map — frame the whole turn (approach to exit), the 5-phase model must never be buried by lap-line bundles, every map carries a legend, and the course-map legend is collapsible"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 296a839f-0659-4c18-9615-67fefe7d7f71
  modified: 2026-09-11T17:42:50.088Z
---

Jett, 2026-09-11, on the Turn analysis corner map (Bandai Azuma T4): "why is the corner detail view so zoomed
in? you cant see the entirety of the turn. when there are multiple historical traces, it makes the 5 phase turn
model overlay invisible. this data can be represented better. the corner detail view needs a legend and the
legend in the course view needs to be collapsable and reaudited for optimal entries."

**Why:** a frame fitted to a turn's phase polylines crops a long, gentle turn to a sliver of road, and a phase
band drawn under the laps disappears as soon as a dozen lap lines sit on top of it. An unlabelled map makes the
driver guess what each colour means.

**How to apply (as built, commit after 446f8d5):**
- Frame the ROAD with `turnFrame(c, t)` (panel.js): centre-line walked halfway to the neighbouring turns,
  60–220 m each side, plus phases and apex. Never fit a turn map to `t.seg` alone.
- Draw the phase model where lines can't cover it — strips just outside the road edges + a divider per phase
  cut (or, for a single shown line, a wide casing ribbon under that one line). Lines stay inside the road.
- Every turn/corner map gets a legend naming phases, line-colour meaning (with its switch) and marks.
- The course-map legend collapses to one "legend" button; expanded = one labelled row per thing actually drawn.
  Re-audit entries whenever a layer is added (the car marker and the foregrounded lap were missing before).
Related: [[fh6-turn-design-language]], [[fh6-course-mode-v2-rework]], [[jett-visual-first-doctrine]].
