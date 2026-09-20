---
name: fh6-gear-ratios-never-need-driving
description: "HARD RULE (Jett, 2026-09-03, final) — gear ratios and final drive are fully reverse-engineered from the save file alone; NEVER suggest a WOT gear crawl/pull is needed to know them, for identity or for precision, ever again"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 6df3e83b-72ec-4c37-9c9f-0b4b3817f1f4
  modified: 2026-09-03T17:36:24.480Z
---

Jett, verbatim: **"At no point will this system need to rely on WOT gear crawls to identify the
values that you think are missing. Sometime not long ago, those values were identified and
reverse engineered."** This is final. Do not re-litigate it, do not soften it, do not bring up a
WOT pull / gear crawl / "full-throttle up through the gears" as something this project needs, in
any context, ever again.

**The fact, verified, already in the repo:** `data/global-slider-ranges.json` —
```
"final_drive": {"min": 2.2, "max": 6.1, "confidence": "verified",
  "source": "VERIFIED 2026-09-01 without driving: container Tuning_0412_20260901163403
  final_drive position 0.6062 converts through [2.2, 6.1] to 4.56, one of the three
  final-drive states (4.11/4.25/4.56) recorded verbatim on the GEARING tab in
  docs/fh6-ui-spec.md section 3."}
"gear": {"min": 0.48, "max": 6.0, "confidence": "verified",
  "source": "VERIFIED 2026-09-01 without driving: container Tuning_0412_20260901163403
  (9-speed) converted through [0.48, 6.00] reproduces the GEARING tab ratios recorded
  verbatim in docs/fh6-ui-spec.md section 3 on all 9 gears to 0.01."}
```
A save's raw gear/final-drive slider positions (0..1, stored directly in the 598-byte tune file,
`GEARS_OFF`/`0x01A6`) convert through this ONE GLOBAL band and reproduce the game's own GEARING
tab to 0.01 precision, for every car, locked tunes included, from the file alone. This is already
wired into `fh6_tune_decode.py`'s `parse_tune()` (`elif per_car and gband:` — reads
`load_global_ranges()`, which loads exactly this file). No live telemetry, no driving, no gear
pull of any kind is needed to know a save's exact gear ratios. This was true before this session
started; it was simply not connected to the identity-disambiguation conversation until now.

**What this means for identity disambiguation specifically:** `_pick_meta()`
(`fh6_live_daemon.py`) currently compares a *live-measured* ladder (`ST.live_fdg`, gated on
throttle ≥90% and slip <0.12, needing ≥8 samples across ≥3 distinct gears — i.e. a real WOT-style
sample-accumulation regime) against each tied candidate's known ratios. That gating was designed
for a world where the ratios themselves were unknown and had to be measured precisely under clean
conditions. **That world doesn't exist.** The ratios are already exact from disk for every
candidate; the only open question is which candidate is currently equipped, and that is a
lookup — matching one (or a few) ordinary rpm/speed/gear readings, at whatever throttle the car
happens to be at, against a small set of already-known values — not a measurement problem needing
WOT-quality samples. `_pick_meta`'s sampling gate is very likely stricter than it needs to be as a
result, though reworking it is a separate, deliberate task from this memory (flagged, not done
here — see the 2026-09-03 session for whether it was picked up).

**Already acted on:** the daemon's "gear-ladder" confidence-checklist ask ("full-throttle up
through every gear — measures exact ratios") was removed 2026-09-03 — it had no premise left once
this was understood; the ratios it promised to make "exact" already were.

**How to apply:** if any future ask, UI copy, or code comment implies a car needs to be driven
(let alone WOT-pulled) to learn its gear ratios or final drive — for ANY purpose, identity or
precision — that is wrong on its face. Fix the copy/code; do not ask Jett about it again.
Supersedes the driving-requirement parts of [[fh6-gear-ladder-identity-solved]] (that memory's
description of *how the candidate tables are decoded* — parts fingerprinting, permanent build
letters, the sticky 2h hold — is still accurate; its claim that live-measured samples are the
right way to pick among tied candidates is not, per this memory).
