---
name: fh6-car-switch-save-writes
description: MEASURED 2026-09-11 — when a Tuning container gets written around car/build changes; the daemon's "switching instances writes NO file" (b99e232) was never measured
metadata:
  type: project
---

The daemon comment "switching garage instances writes NO save file" (fh6_live_daemon.py ~L1169,
commit b99e232, 2026-08-28) was a stated premise, never measured. Jett reported switching copies
DOES trigger a save. Tested 2026-09-11 against 85 captures (2026-08-28→09-11, 29 GB) × 206
containers, joining car changes to container save moments (folder ts = UTC save moment; Data
mtime lags 6–40 s):

- Change to a DIFFERENT model: **0 / 179** wrote a container.
- Same model, build (cid) changed across a menu visit ≥10 s: **30 / 36** wrote one; the written
  file's drivetrain matched the car switched TO in **24 / 24** checkable; 30/31 new content; all
  downloaded — i.e. mostly APPLYING downloaded tunes (the 4166 M2 FE 700→901→953→795→868 run is the
  My Tuning Setup row). Telemetry has no instance id, so copy switches and tune applies look alike.
- The one clean copy-switch case, Ariel Nomad 2430 (multiple copies; stock RWD 601; Jett's copies
  AWD 700 + RWD 700): 10:07:36 AWD→RWD wrote an **AWD** file 2 s later (the car LEFT); RWD→AWD at
  10:11 and →RWD at 10:15 wrote nothing; **no RWD Nomad file has ever been written.** n=1 — the
  rule (outgoing car? only if changed? only if that copy has a setup?) is undetermined.

**Risk this exposes:** the new-save edge re-anchors identity to the newest file as "the car you're
sitting in" (~L2596). A write for the OUTGOING copy would pin the wrong build, and the hold's
contradiction check compares cyl, redline and PI but NOT drivetrain — so same-engine/same-PI copies
differing only in drivetrain (the Nomad case) are not caught. Settle with a controlled switch test
on the Nomads before building on either reading. Scripts: scratchpad transitions/join/enrich of
session c945cf04. See [[fh6-savefile-tune-decode]], [[fh6-identity-two-directions]].
