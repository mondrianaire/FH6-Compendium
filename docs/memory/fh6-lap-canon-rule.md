---
name: fh6-lap-canon-rule
description: HARD RULE (Jett, 2026-09-06) — the game's lap metadata (CurrentLap, LapNumber, LastLap) is canon for laps; rewinds are lap-clock reversals, not race-clock drops; free-roam rewinds don't matter
metadata:
  type: feedback
---

Jett, 2026-09-06, on lap reconstruction: "WE NEED TO RELY ON THE CURRENT LAP METADATA SUCH AS LAP
TIME AS CANON." Rewinds over the start/finish line create a new lap time every time; mid-lap rewinds
and menu pauses are still legitimate laps, not partials. And: "if the user is in free mode, the
rewinds dont matter."

**Why:** measured on `captures/fh6_20260905_232556.csv` — on all 6 rewinds the landing row's
(LapNumber, CurrentLap) named a kept row EXACTLY (same lap clock, same odometer, 0–1 m on the road),
over the line and mid-lap alike. The race clock did not: it dropped 15.68 s for 7.84 s of undone
driving once, and dropped 3.43 s across a menu pause with the lap continuous once (a false rewind that
split a lap). The odometer resets mid-event. Rewinds send no frames: a silence of 2–20 s with a
CurrentLap ≈ −5000 sentinel on the frame before it. Free roam has an idle lap clock, so nothing is
timed and nothing to revoke.

**How to apply:** `analyze_session.final_timeline` — rewind ⇔ LapNumber drops or CurrentLap drops
≥0.25 s on the same lap. Excluded, in the same guard: a lap-clock clearing (>3→<1 s = boundary or
tear-down), a landing with odometer <50 m (a start / new event — every event opens with a stationary
~2 s countdown at 0 m), and an idle lap clock at the landing (lap 0 / LapNumber 0 = exit to free roam,
handed back on the driven line). Cut at the last kept row with (LapNumber, CurrentLap) ≤ the landing's;
if that walks off this car's stint the marker says `cut:"stint"` and revokes the stint rather than
splicing across a car change. Corroborate with position (`on_line`); the splice is the rewind's, never
a pause; a dropout stays a `gap` at any speed (only `_pos_gap ≥ JUMP_M` beyond what the lap clock
allows is a `jump`). Shipped in commit a9cbcd1 (schema 5, 78 tests). Never reintroduce a race-clock or
odometer revocation axis. Related: [[fh6-judge-against-the-course]], [[fh6-session-state-2026-09-06]].
