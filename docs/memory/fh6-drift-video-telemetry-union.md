---
name: fh6-drift-video-telemetry-union
description: MEASURED 2026-09-12 — drift videos sync to UDP captures; body slip angle from VelX/VelZ explains Drift Zone scoring (LOVO R2 0.88 vs 0.64 speed-only)
metadata: 
  node_type: memory
  type: project
  originSessionId: c945cf04-0a47-42c1-bf6d-dbada521d23a
  modified: 2026-09-13T08:04:32.009Z
---

Prep for a free-mode v2 "drift" tab that unions the video corpus with live telemetry.
Scratchpad scripts of session c945cf04: sync.py, union.py, autosync.py.

**Overlap:** 9 of the 10 transcribed drift videos sit inside telemetry captures
(`captures/fh6_20260909_*.csv`, UTC Sep 10 00:20–02:26); the Sep 1–6 videos have none.

**Sync:** video t0 = file mtime − duration is WRONG by −11 to −103 s, different per video (ShareX
mtime). Matching hand-read HUD mph to telemetry Speed syncs every video to 0.44–1.29 mph mean
error. A no-OCR candidate (HUD-absent rewind/menu seconds vs telemetry IsRaceOn==0) matched
exactly on one video and failed on the other — not usable alone. Real fix: record with an exact
start timestamp.

**Telemetry facts (99 fields):** VelX/VelZ are CAR-LOCAL (|Vel|=Speed exactly; +Z forward; a
−VelZ run was a backwards slide) → body slip β = atan2(VelX, VelZ). `DistanceTraveled` does NOT
advance in free roam (ratio to path 0.000) — use PosX/PosZ path length. The analyzer's drift flag
(rear CombinedSlip > 2.5) is useless for scoring (r +0.05).

**Joined 858 one-second gaps (824 scoring):** pts/s r with speed +0.83, path/s +0.83, |β| +0.47,
rear SlipAngle +0.45, yaw −0.39. Real-distance law: 176 pts/m median (≈283k/mi), cv 0.215.
**Angle law — pts per metre by |β|:** 0–10° 36 · 10–20° 106 · 20–30° 156 · 30–40° 171 · 40–50° 179 ·
50–60° 187 · 60–75° 191 · 75–90° 189 · >90° 138. 13 of the 21 flat on-route seconds sit at |β|<10°
(median 5.9°); off-route flat seconds have normal angle (40°). Past-90 reduces, not zeroes, at 1 Hz.

**Leave-one-video-out prediction of pts/s:** speed-only R² 0.639 (MAE 518) · distance-only 0.618 ·
**distance × β curve 0.879 (MAE 247)**, flat seconds predicted 712 vs ~2,500. So telemetry alone
can estimate Drift Zone scoring live; video is only needed to calibrate and to see on-route/zone.

**SUPERSEDES the 1 Hz angle bins (perframe.py, 2026-09-12):** averaging β over a second blurred the
curve (Jett's objection). Per-frame NNLS (metres per frame-state → gap pts, 845 gaps / 111k frames):
0–10° 21 · 10–20° 146 · 20–30° 156 · 30–45° 171 · 45–60° 189 · 60–75° 185 · 75–85° 199 · 85–90° 205 ·
90–95° 216 (73 m only) · 95°+ 101; LOVO R² 0.922 (MAE 216). A hard zero at exactly 90° is NOT
supported, but only 1.4% of metres are ≥90° and sync is ~±0.3 s — still OPEN, needs deliberate runs.
**Grip:** rear SlipAngle/CombinedSlip are normalised (>1 = past grip); above β 20° the rear is past grip
on essentially every metre (grip-at-angle <0.1% of metres; β vs rear SlipAngle r +0.84), so the corpus
cannot separate "angle" from "losing grip" — adding grip state changed nothing (LOVO 0.91). Open, not refuted.

**2026-09-13, both modes (zone 9 videos + Drift Attack 4 runs, x2 divided out):** angle is a THRESHOLD at ~10-12°,
not a ramp — under 10° pays ~0, from 12° full rate (~140-160), then a gentle rise to ~175-205 by 60-90°. Two-number
model distance × [β≥10 ? ~179 : 0] ≈ full curve (zone LOVO 0.907 vs 0.919; attack 0.905 = 0.905); distance-only
0.78 / 0.64. Speed term mild (attack 143 <25 mph → ~170 >35). Rear SlipAngle <2 at 20-90° paid 0 but on 48 m only.
Sept 9 captures are now .csv.gz (daemon compression) — read with gzip. Scripts: attackmodel.py, perframe_zone5.py.

Answers the dead ends in [[fh6-drift-angle-channel-dead-ends]]; refines [[fh6-drift-rate-law]]
(per-metre × angle, not per-metre alone). Integration must happen from a session in the lab worktree.
