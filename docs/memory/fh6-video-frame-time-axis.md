---
name: fh6-video-frame-time-axis
description: HARD RULE — never read a video's time axis from ffmpeg's fps filter; select by source frame index and verify with -ss
metadata:
  type: feedback
---

When sampling a gameplay video into a data series, select rows by **source frame index**
(`select='not(mod(n,stride))'` with `-vsync 0`), never with ffmpeg's `fps` filter, and
never treat the filter's output-frame index as seconds.

**Why:** on 2026-09-09 I cut drift-run HUD strips with `fps=1` from a capture that ffprobe
reported as exact CFR 30 fps, and labelled row R as t=R seconds. Checked against direct
`-ss` seeks, the filter's output index 80 was a different frame — roughly 0.4 s ahead —
and the offset kept growing. Every timestamp *and* every value in the first transcription
of two videos was wrong, and I had already reported figures from it. Three independent
addressings of t=80 (`-ss` before `-i`, `-ss` after `-i`, and `select='eq(n,2400)'`) all
agreed with each other and disagreed with the fps filter.

**How to apply:** compute `stride = source_fps / sample_fps`, refuse the job outright if
the source is VFR (a frame-index stride is not a fixed time step there — transcode to CFR
first), and always re-seek a spread of rows with `-ss` and check them against their strip
rows before trusting the axis. `scripts/drift/extract_hud.py --verify` does this. Related:
[[fh6-drift-corpus-discipline]], [[fh6-decode-the-whole-record]].
