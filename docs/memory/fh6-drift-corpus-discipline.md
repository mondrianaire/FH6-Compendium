---
name: fh6-drift-corpus-discipline
description: HARD RULE 2026-09-09 — drift video findings accumulate in data/drift-runs; never claim a mechanic from one video
metadata:
  type: feedback
---

Jett uploads drift videos one at a time and expects the DRIFT ZONE scoring system
(the "Drift Zone / N,NNN PTS" ticker at the BOTTOM of the screen) to be understood by
accumulation. The skill-chain popup at the TOP of the screen is a different economy and
is explicitly **not** what he is asking about.

Never state a mechanic, formula, or threshold from a single video. Transcribe, bank,
and leave the question open.

**Why:** on the first video I fitted `rate = 800 + 69 × mph` (r=0.907) and reported a
speed model, a resolved wall-contact rule, and a chain formula as findings. The second
video contained many seconds at 46–65 mph scoring **zero** — the speed model was
refuted immediately. Video 1 had simply held angle roughly constant, so speed absorbed
all the variance. Jett's correction: "wait for a lot more data before making these
types of extreme claims." This is [[fh6-judge-against-the-course]] and
[[fh6-sample-is-not-population]] recurring in a new place.

**How to apply:** for each new video run `python scripts/drift/extract_hud.py <video>`,
read the HUD strips by eye (no OCR — guessed digits are worse than none), fill the stub
in `data/drift-runs/<stem>.json`, then run `python scripts/drift/corpus.py` and report
what the WHOLE corpus says, counter-evidence included. Open questions and their
`settles_when` gates live in `data/drift-questions.json` — meet the gate or leave the
question open. Angle is not on the HUD, so any rate difference at equal speed stays
unexplained rather than attributed. See [[fh6-slider-value-reliability-hierarchy]] for
the same evidence-tiering instinct applied elsewhere.
