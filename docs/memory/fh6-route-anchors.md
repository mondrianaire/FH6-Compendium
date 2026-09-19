---
name: fh6-route-anchors
description: "race_triggers.tz = 36 race-activation spheres naming a ref_route id at a world position (the only populated route-id field in the game data); imported as route_anchor / session_event / course_route.anchor_*; corroborates and tie-breaks geometry, never names; the .str tables cannot carry the route join and the event catalogue sits in encrypted sfsdata / GameTunableSettings.zip"
metadata: 
  node_type: memory
  type: project
  originSessionId: 6df3e83b-72ec-4c37-9c9f-0b4b3817f1f4
  modified: 2026-09-06T02:28:43.473Z
---

**The find (data-audit session, 2026-09-05; verified by main):**
`Content\media\tracks\brio\triggerzones\tz_race_activations\race_triggers.tz` -- 14 KB plaintext
XML, 36 spheres `race_trigger_zone_rt<N>`, radius 100 m, telemetry metre frame. `<N>` is a
`ref_route.route_id`, 36/36 resolve, median 10.6 m from their own centre-line. Every other id
field in the shipped data is zero (Tracks.Route, .nt locator GUIDs, NewProfile_CareerRaces rows).

**What it proves:** a session event whose START lies in `rt<N>` began where route N's race begins.
An observation, not a shape match. **What it does not:** 33 of 36 spheres have another route's
centre-line within 100 m (131 is 0.3 m from 5555), so it never overrides a geometry verdict and
never names anything. Rule in import_course_match.apply_anchors (after a 4-lens adversarial
review, 6 findings fixed): a sphere promotes only with a STRICT MAJORITY of all the course's
events (>= 2, more than half); verified -> record agreement; probable settled only between its
own two candidates -> verified; partial stands; none -> 'anchored' with route_id STILL NULL
(identity in anchor_route_id only, so corners / centre-line / naming, which gate on route_id,
stay unidentified). A point in two spheres (2311/311 overlap) is unresolved. `--check` I12 warns
on every disagreement and FAILS if an anchored row carries a route_id. Stage order: routes ->
anchors -> surface -> course_match. Tables: route_anchor, session_event (every analyzer event with
start/end position, stage telemetry), course_route.anchor_route_id/anchor_events/anchor_agree,
ref_route.is_race. The analyzer stamps `anchor` on each session event. First live run under the majority rule:
13 verified / 3 probable / 30 partial / 22 none / 0 anchored -- six courses corroborated, no verdict
changed (4200_-5450: 6 of 16 events in 5031's sphere, the rest start elsewhere, stays none with
the evidence recorded); one WARN (-4750_-1550: geometry 5191 partial, sphere 5041).

**Where the names actually are:** [[fh6-course-identity-workflow]] / [[fh6-objectmodel-catalogue]] -- the join lives in the never-encrypted ObjectModelGame.zip, not in any .str.

**Handoff corrections recorded** in docs/handoff-to-main-route-identification-2026-09-05.md section 7:
tz_races ids 3333-3337/8001-8005 ARE in ref_route (files are cutscene boxes); anchors do not
break the Soni/Irokawa name tie (same route, two event names).

**How to apply:** when a course's identity is disputed, read course_route.anchor_* and session_event
before the polyline argument. Never let `anchored` feed a name. See [[fh6-course-identity-workflow]].
