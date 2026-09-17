---
name: fh6-decode-the-whole-record
description: Decoding only the fields the current question needs hides the rest. The route files were parsed twice keeping 12 of 56 bytes per point; road width and banking sat in the skipped 44 for hours.
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 6df3e83b-72ec-4c37-9c9f-0b4b3817f1f4
  modified: 2026-09-02T23:42:47.604Z
---

On 2026-09-02 the FH6 route centre-lines (`Route<id>.owt`) were parsed twice — once by a research subagent at 05:39, once by me later — and **both passes kept only the first 3 floats of a 56-byte record**, because position was all route-matching needed. The other 11 fields were treated as padding. When Jett asked whether the raw data held official turn numbering, decoding the rest took one probe and revealed a lateral half-width vector (perpendicular to travel on 98.2% of 568,158 steps) and a unit surface normal giving banking. Road width and camber at every 2 m of every route, sitting in bytes we had already read into memory and thrown away.

**Why:** a known record stride is a budget, and an unexplained remainder is a finding waiting to happen. Both passes verified the format by confirming the bytes they *wanted* were there — correct point counts, plausible lengths, closed loops — which proves nothing about the bytes they ignored. This is the sibling of [[fh6-sample-is-not-population]]: that one is "don't generalise from a subset of the files", this one is "don't stop at a subset of the fields".

**How to apply:** when reversing any binary format, account for the WHOLE record before declaring it understood. State the stride, state how many bytes each identified field consumes, and name the remainder explicitly as unexplained. Probe unknown fields cheaply: are they finite floats, small ints, monotonic, low-cardinality, unit-length vectors, perpendicular to something? Record the answer even when the current task does not need it.

Second failure in the same episode, worth its own guard: the finding **existed** in a subagent's scratchpad and in a critic's summary I read, but nothing in `data/` or `docs/` ever mentioned it, so when the follow-up workflow died on a usage limit the knowledge died with the session's attention. A finding that lives only in a scratchpad has not been learned. See [[fh6-raw-data-folder]] and [[jett-github-first-research]].
