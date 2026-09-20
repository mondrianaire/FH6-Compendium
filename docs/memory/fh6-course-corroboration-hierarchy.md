---
name: fh6-course-corroboration-hierarchy
description: "Which metadata actually corroborates a course id, measured — mode is the only new load-in signal; sphere is offset; elevation/road_class/finish are redundant"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 6df3e83b-72ec-4c37-9c9f-0b4b3817f1f4
  modified: 2026-09-07T03:19:56.235Z
---

Geometry (S/F crossing + the path the drive lies on) proposes and decides a course identity. Every other metadata channel is a CONFIRM/VETO over that pick, never a namer ([[fh6-route-anchors]] rule). Measured on the real corpus (2026-09-06), ranked by what each actually adds:

- **Live mode (RacePosition)** — the ONE genuinely new load-in signal. Packet has no mode field; `RacePosition > 1` is positive proof of a race field. At a plaza-shared spawn it keeps only the `is_race` variant, resolving 3 of 4 real plaza pairs at load-in with zero motion (Chiheisen/Temple, Ito/Ine — which it *corrects*, not just confirms, Naruo/Airfield). Wired: daemon `_match_learned_start(sf, rpos=)` gate + analyzer `_catalogue_key(solo=)` tie-break (reward a match, never punish — a route can be is_race yet driven solo).
- **Activation sphere** (race_triggers.tz → `route_anchor`, 36) — spawn-in-own-sphere is the route 93/94 uniquely, BUT the sphere is the free-roam TRIGGER, sited 136–778 m from the S/F spawn line on every measured plaza pair (Goliath's is 420 m off). So it confirms a free-roam-ACTIVATED start, essentially never a Rivals/PvP load-in. Safe tie-break only; 35% route coverage so absence says nothing.
- **Elevation / road_class** — REDUNDANT with the geometry gate: you can't score ov≥0.7 on a route on a different mountain or surface, so path overlap already implies both. `session_event` stores no `start_y`, so elevation can't disambiguate a learned start either.
- **Finish line** — redundant at load-in: you spawn at the START, not the finish, so candidate finishes can't pick one at spawn; the driving path-match already uses the whole geometry. Not built.

Irreducible: Goliath vs Legend Island Trail (same start, both is_race, differ only loop-vs-p2p) — no load-in signal splits it; the path-match does (paved loop vs dirt sprint diverge at once). Shared `_an()/_route_spheres()/_sphere_for()` in analyze_session; analyzer half deploys live via subprocess, daemon half needs a restart. Extends [[fh6-course-keying-catalogue]].

**Back-to-back PvP race change (a DIFFERENT problem — detecting a course CHANGE, not naming one).** In Horizon Open PvP races run back-to-back; the daemon's 1.5s event-exit hysteresis masks the freeroam blip between them, so `ST.loop` stayed on race 1 and `_ev_named` blocked re-matching (Hokubu Ascent read as the prior Goliath). Signal: **a new race resets `DistanceTraveled` to 0, laps only ADD to it** — validated on fh6_20260906_222143 (8 races, every one reset the odometer at a distinct start, drops of 5,952–17,855 m, no lap ever dropped it). Fix (fh6_live_daemon, 65536f1): track `ST._ev_dist` across every on-track frame (the reset frame sits at CurrentLap 0 = maybe "freeroam", so don't gate on game=="event"), and on a >500 m drop with an active auto-loop call `_end_auto_course` so the auto-course block re-identifies. Daemon change → deploys on restart. Dashboard half: `onCourseChange` must not strand the old course when the new one's file isn't built yet — drop it, return false, and `adoptLoop` falls to the catalogued route.
