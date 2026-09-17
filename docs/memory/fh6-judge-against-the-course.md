---
name: fh6-judge-against-the-course
description: "The FH6 lab's most recurrent bug shape — judging something against the wrong reference set — with the seven instances found so far and the two rules that kill it"
metadata: 
  node_type: memory
  type: project
  originSessionId: 6df3e83b-72ec-4c37-9c9f-0b4b3817f1f4
  modified: 2026-08-29T01:25:16.587Z
---

The single most recurrent bug in this project. Seven instances by 2026-08-28, all the
same shape: **a value judged against a reference that was convenient rather than
correct.**

1. Double-lap map — the reference lap was the session MAXIMUM, so a merged lap
   outranked every real one (1923 m "course" over a 1032 m road).
2. Partial-lap reference best — a 492 m window correctly timed at 15.09 s became the
   build's best, making every real 30 s lap 200% off. 1 competitive lap out of 84.
3. `/laps` course length — derived from the FETCHED PAGE, ordered fastest-first, so
   `limit=3` saw a 660 m "course". Coverage that depends on how many rows you asked for
   is not coverage.
4. Turn identification — turns judged by how the car BEHAVED rather than by the road's
   curvature. See [[fh6-turn-identification-rule]].
5. `turnTable` — the session's turn set outranked the model's because "the session sees
   the model live, db.js is a snapshot". True only while the analysis is CURRENT; a
   superseded-detector analysis is the STALER of the two. Fixed by stamping
   `turns_info.det` and comparing generations.
6. `audit_models.py` check 5 — turn_count compared to len(established), i.e. a value
   cross-checked against its NEIGHBOUR rather than re-derived from evidence. Satisfied
   by self-consistent nonsense: 184 == 184 over a 172-turn map.
7. `map-too-long` — a POINT-TO-POINT judged by a circuit's rule ("the map should be one
   typical lap"). 1900_6100 self-retraces 0.0%, its ends sit 3105 m apart, every lap
   lies 100% on it, and it was failing.

TWO RULES THAT KILL IT:

**Judge against the COURSE, not against the sample.** The accumulated model is the
truth; a session, a page, a lap, a drive is one sample of it. Ask "what is this a
sample OF?" before comparing anything to anything.

**Re-derive, don't cross-check.** Two adjacent stored values agreeing proves nothing —
a wrong rule writes both. A check that can actually disagree recomputes the value from
the evidence. This is why the audit missed 221 bad turns while reporting clean.

COROLLARY (2026-08-28): incomparable is not worthless. A VOID lap keeps its grip trace
and loses only its time; a PARTIAL lap is the same case and was being deleted outright
(24 of 151), which hurt most on long courses never completed — the corners practised
most were the ones least known. Whenever something is excluded from a comparison, ask
whether it should be excluded from the DATA.

See [[fh6-lab-runtime-layout]] and [[fh6-dashboard-redesign]].
