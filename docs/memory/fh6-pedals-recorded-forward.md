---
name: fh6-pedals-recorded-forward
description: "Throttle/brake are recorded on every lap point only from 2026-09-11 (schema 6, lap_point.thr/brk); Jett chose NOT to backfill history — laps before read \"no pedal data\""
metadata: 
  node_type: memory
  type: project
  originSessionId: 296a839f-0659-4c18-9615-67fefe7d7f71
  modified: 2026-09-11T18:02:52.295Z
---

Jett asked for a brake/throttle paint on the speed trace, course traces and single-turn analysis (2026-09-11).
Recorded laps had no pedal data (lap_point = arc, mph, grip, x/z, elev, dist). When I floated replaying the old
captures, Jett said: "wouldn't it be better to just begin recording user input data from now on and using this
direct data for future recordings?"

**Why:** the capture CSVs already hold Accel/Brake for every frame, so recording forward costs nothing; a full
replay of ~360 captures (21 GB) through backfill_laps.py is long and re-derives stores for little gain.

**How to apply:** pedals flow analyze_session.lap_pts (cols 7/8) → resample → _pts_out fields 8/9 (throttle %,
brake %) → laps.db pts → import_telemetry → lap_point.thr/brk (schema 6) → build_web trace fields 7/8 → the
dashboard's "pedals" paint (PEDAL/pedalKey in panel.js; live frames give LIVE.run [7]/[8], LIVE.lap [8]/[9]).
Laps analysed before 2026-09-11 legitimately show "no pedal data" — do NOT propose a backfill unless Jett asks.
The "pedals" mode is never written to the legacy fh6SegMode key (v1 reads it). Related: [[fh6-turn-map-readability]],
[[fh6-never-forget-a-store]].
