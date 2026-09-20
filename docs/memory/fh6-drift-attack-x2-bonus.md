---
name: fh6-drift-attack-x2-bonus
description: MEASURED 2026-09-12 on one video (E9vcNUs8eL) — Drift Attack x2 bonus is ~2.0x (angle-matched 2.07); true doubling leads the on-screen tag by ~0.15 s; rewind dropouts give automatic sync
metadata: 
  node_type: memory
  type: project
  originSessionId: c945cf04-0a47-42c1-bf6d-dbada521d23a
  modified: 2026-09-13T05:50:51.773Z
---

**Mode:** Drift Attack (Festival Playlist seasonal, e.g. "Shimanoyama Drift Attack", challenge 60,000 pts). HUD: bottom-centre
"Current Best / Drift Attack / N PTS"; inside a bonus area a cyan "x2.0" tag appears AND the digits turn cyan (colour gate:
g>170, b>170, r<120 in crop 900x190 @ x830 y1170 on 2560x1440). Green "+N" / red "-N" that replace the ticker for ~2 s are the
checkpoint/finish gap to "Current Best", not score (t=400 finished 236,017 → "-52" vs 236,069). "Current Best" is the
SESSION best, not the all-time PB (it read 211,521 an hour after 236,069; event card PB 238,042) — so those gaps are
session-relative and not useful for analysis (Jett, 2026-09-12). Never call a Current Best rise a "new PB".

**Auto-sync found:** the UDP stream STOPS during rewinds (no IsRaceOn=0 frames; data gaps of 3-14 s). Video HUD-absent run
starts match telemetry gap starts to ±0.03 s over 24 rewinds → t0 with no hand-read speeds. HUD reappears ~0.3 s after
telemetry resumes (fade-in), so match STARTS, never ends. This replaces the unreliable menu-dropout idea for rewind-heavy runs.

**x2 result (144 clean 1-s gaps, per-frame NNLS, one video):** m grid best 2.05-2.10; angle-matched pure seconds 2.07 vs
untagged 1.01. Lag fit: best -0.15 s (doubling starts/ends BEFORE the tag; R² 0.959 at lag 0 → 0.978). Raw pts/m ratio
2.50 is angle-confounded — do not quote. Tag episodes median 1.40 s. Base curve in this mode: 0-10° ≈2 pts/m, 10-90°
143-182, 90°+ 143 (52 m only).

**Run 2 (IfeKPdzrTr, 5 Hz, 285 0.2-s gaps):** lag -0.15 s REPLICATED (joint offset/lag fit); m flat 1.8-2.0 (best 1.90).
Few rewinds → rewind matcher mis-paired it 9 min early; constrain t0 to [mtime - dur - 110 s, mtime - dur] and use the
last HUD blackout too. Digits go cyan before the tag is legible (tag fades in). A frozen ticker at 35 mph / β 24° / 44 m
= off-route candidate (Drift Attack has no route channel read yet).

**SETTLED 2026-09-12 after run 3 (kXYiq8eo3m, 5 Hz, 545 gaps, independent rewind sync):** pooled m 2.05 (per run
2.05/1.90/2.00), lag -0.15 s in every run, entry AND exit both -0.15 s. Tag = "inside the area", not "earning" (tag
shows on a frozen ticker). Pooled script: scratchpad x2pool.py. Same event/car/driver only.

**Run 4 (MafLn2sFGM, BMW M2 ordinal 3551 — second car, 1 Hz, 259 gaps, 37-rewind sync sd 0.02 s):** m 2.05; lag
-0.05 (flat -0.20..-0.05 at 1 Hz). Pooled 4 runs: m 2.05, lag -0.15, entry -0.10 / exit -0.15. This HUD has no
"Current Best" row. See also [[fh6-drift-attack-rewind-start-glitch]].

Was OPEN per data/drift-questions.json `drift-attack-bonus-accuracy` gate (≥3 runs, ≥5 Hz around transitions); the
-0.15 s could partly be sync error. Transcripts + scripts: scratchpad of session c945cf04 (e9/, e9analyze.py).
Related: [[fh6-drift-video-telemetry-union]], [[fh6-drift-corpus-discipline]].
