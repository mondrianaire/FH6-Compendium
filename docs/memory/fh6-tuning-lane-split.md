---
name: fh6-tuning-lane-split
description: FH6 tuning has two lanes sharing one diagnostic engine — Course (overfit to one track via course_weight) vs General/all-around (breadth-weighted across all contexts)
metadata: 
  node_type: memory
  type: project
  originSessionId: 6df3e83b-72ec-4c37-9c9f-0b4b3817f1f4
  modified: 2026-08-22T12:00:17.657Z
---

The FH6 telemetry tuner has TWO lanes that share the SAME diagnostic engine (`advice_for` in
analyze_session.py) and differ only in the weight term applied to each diagnosis:

- **Course lane** (Rivals / marked loop / timed event → the Course workflow): weights by
  `course_weight` = how much THIS track uses each dimension. Deliberately OVERFITS to one course.
- **General / all-around lane** (Free Tuning workflow — Horizon Open / freeroam / public play):
  weights by `breadth` = how consistently a problem appears across every context the build has driven
  (corner-type × surface). Deliberately does NOT overfit — acts only on systematic weaknesses.

Built 2026-08-22 (in response to Jett's "public play should give general suggestions; course tuning
is dramatically different from general"). Analyzer: corners tagged `surface` (smooth/rough from
`SurfaceRumbleFL..RR` > 0.1 sustained); `general_tuning_for()` builds a balance signature (USI +
dominant-red axle per corner-type×surface bucket), a `robustness`/consistency score, a `surface_split`
flag, and adds `breadth` (+ `context_split`) to each advisory. Daemon passes `c["general"]` in the live
analysis. Dashboard: `generalTuningPanel()` in the Free Tuning workflow — balance-signature matrix +
breadth-weighted numeric moves via `tuningMoves(adv, [], cur, "breadth")`. Verified in-browser
(Exocet: hairpin USI +0.83 understeer → front ARB/spring softer, rear ARB stiffer).

Directive from Jett: aggregate across ALL surfaces the car has encountered — if a car is
handling-specific, it shows through as a split balance signature (`surface_split`), not a pre-filter.
Blanket problem (every context) → blanket tool; context-split → balance tool. Relates to
[[fh6-savefile-tune-decode]] (the disk tune is the current build the general lane recommends against).
