---
name: jett-no-ocr-rivals-detection
description: "Standing direction (2026-09-16): NO OCR for this project going forward; detect the Rivals 'beat' via the game's auto-launched menu STATE, not screenshots or a time comparison"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 6df3e83b-72ec-4c37-9c9f-0b4b3817f1f4
  modified: 2026-09-17T01:37:40.733Z
---

Jett, 2026-09-16: the project will **not rely on OCR / screenshot transcription** going forward. This
supersedes the screenshot-based rivals-times work in [[fh6-edamame-rivals-times-2026-09-11]] and the OCR
path (`transcribe_rivals_routes.py`, `/shots`+`/shot`) as a SOURCE for rivals data — do not propose OCR to
read the rival's target time.

**To detect "beat the rival":** identify the game's Rivals **winner / "continue with a new time?" screen** —
NOT a time comparison, NOT OCR. CORRECTED SIGNATURE (Jett screenshot 2026-09-16, live-confirmed): this screen is
**NOT a menu** — `IsRaceOn` STAYS 1, `game`=="event", telemetry keeps flowing at ~60 pps, dashboard still reads
"ON COURSE · EVENT · lap N · P1" — but the **car is STATIONARY (~0 mph, idle RPM) after a completed lap**. So the
beat state = **on==1 AND game=="event" AND mph≈0 sustained (car parked) right after a lap completion** (a fresh
`LastLap` @ packet byte 300). Detect that on-course-stationary dwell — no menu, no IsRaceOn→0, so no confusion
with a real pause/quit (which DO drop IsRaceOn→0). When the user picks "continue," the car moves again on the
SAME course + SAME `cid`; the game's `LapNumber` resets low for the new rival, but the daemon's **`loop_lap`
keeps counting across the boundary** (empirically confirmed: `loop_lap`=4 while the new rival's game `LapNumber`
had reset to 2) — so the loop/session is preserved automatically. `RacePosition` is a constant 1 in solo Rivals
(not a signal). This is a small new STATE DETECTOR over existing signals (Speed, IsRaceOn/on, game, LapNumber,
LastLap). Missed capturing the exact 0-mph winner frame once (user continued first) — sample it next time to pin
the mph threshold + dwell duration.

**BUILT 2026-09-16 (commit c946289).** Daemon `compact()` now forwards sanitised game-reported `last` (LastLap) +
`best` (BestLap) in the live frame. Two detectors in the lap-completion block (fh6_live_daemon.py ~:651): **live PB**
= the game's BestLap dropping → `pb` SSE event (tracked per daemon run via `ST._prev_best`; a new-rival BestLap reset
can't false-flag); **rival-beat / winner screen** = on-event + stationary (~0 mph, `t_mono`-based >1.2 s dwell) right
after a completed lap → `rival_beat` SSE event, cleared when the car moves again. getattr-defaulted state (no
ST.__init__ change); needs a daemon RESTART (done via lab_up.ps1). Dashboard: live.js listens for `pb`/`rival_beat` →
`LIVE.pb`/`LIVE.beat` + `fh6Toast()` transient banner ("⚡ NEW PB" / "★ RIVAL BEATEN · continue with a new rival →").
The events fire in-game (need a completed lap / a beaten rival to see live). live.js v115 / panel.js v249 / styles.css v187.

**Session continuity is ALREADY preserved — do not touch core session logic.** A "session" = the CSV capture
file (`sid = basename(csv_path)`); only daemon startup, the 192 MB roll, or manual `/reset` open a new capture —
a menu does none of these. The new rival is a new **stint** in the SAME session; `cid` (car+tune, since CarPI
encodes upgrade+tune) and `route_key` stay constant. So both rivals' laps already land in one `session_id`
(each lap carries `l.sid` in `COURSE.laps[]`). Continuity work is a **detector + dashboard scoping**, never a
capture roll / session promotion at the new-rival edge (the `_auto_suspend`/`_end_auto_course` design exists to
avoid a fabricated final pass + course re-anchor at the pause — hands-off). Related: [[fh6-spec-rivals-events]],
[[fh6-lab-runtime-layout]], [[fh6-lap-canon-rule]].
