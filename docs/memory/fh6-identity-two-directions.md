---
name: fh6-identity-two-directions
description: "HARD RULE (Jett, 2026-09-06) — forwards identification (live telemetry → which build) may use the gear ladder/PI/signature; the REVERSE direction (distinguish, compare, tool, A/B) MUST run on the two-tier hash — hw_hash (upgrades) + tune_hash (sliders)"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 6df3e83b-72ec-4c37-9c9f-0b4b3817f1f4
  modified: 2026-09-06T09:17:54.860Z
---

Jett, 2026-09-06: "for forwards identification purposes -> unidentified build to identified this
type of thinking is fine but anytime we need to go the other direction we NEED to utilize the two
tier system of hardware hash for upgrades and slider hash for tooling, enabling the future A/B
testing abilities."

Two directions, two mechanisms:
- **Forwards** (unidentified → identified): the gear ladder, live PI, and cyl/redline signature read
  live telemetry to GUESS which saved build is equipped. Correct — that is all telemetry can do when
  there is no file yet, and same-PI/same-gearing builds are inherently indistinguishable this way.
- **Reverse** (identified → distinguish / compare / tool / A-B): MUST key on the two file-derived
  hashes, never on the forwards machinery. `hw_hash` (`fh6_tune_decode.py` hw_hash) = the
  hardware/upgrades fingerprint; `tune_hash` (`fh6_tune_decode.py` tune_hash) = the slider/tooling
  fingerprint. A/B is: same `hw_hash`, different `tune_hash` (the `variation` status, `panel.js`).

**Why:** the two hashes come from the save file and are exact; the gear ladder is a guess. Stretching
the forwards tools to distinguish saved variations is what caused the "saved a new tune but the wrong
one stays selected" bug — the ladder re-guessed from telemetry and overrode a build whose file was
already known, picking an OLDER same-gearing save. It also enables A/B: comparison only means anything
keyed on hw_hash + tune_hash.

**The forwards ORDER (Jett, 2026-09-06, refined):** identification priority is
1. **`cid`** (`CarOrdinal|DrivetrainType|NumCylinders|CarPI`, `fh6_live_daemon.cid`, telemetry-exact) —
   the PRIMARY identity. It confidently pins the GROUP of saved builds that share it.
2. **The file** — within that cid group, the equipped build is the one the user SAVED or PICKED, keyed
   by its `(hw_hash, tune_hash)`. A save is authoritative; the gear ladder must not override it.
3. **The gear ladder — LAST RESORT ONLY.** It runs only when there is no save/pick anchor, and then it
   is a best GUESS marked unverified, never a "verified/held" identity and never a 2 h sticky hold that
   outranks the file. ("gear ladder shouldnt be the first identification, the cid value" ... "yes only
   as last resort".)

The Aug-13 bug is this order inverted: today `cid` filters the group, then the gear ladder immediately
picks one build and HOLDS it 2 h, so it latched onto an old same-cid save and beat the file.

**The header shows RESOLUTION, not a journey (2026-09-06, commit eb46c21).** The old status spectrum
(UNKNOWN→DOWNLOADED→CLONE→RATIFIED) is replaced by resolution states over the tree: RESOLVED (one saved
hw_hash+tune_hash, clone-able), AMBIGUOUS (cid matches N saved builds — pick/drive), UNSAVED (live car
matches no saved build, or a variation whose sliders aren't saved — incomplete). `resolutionState()` /
`resolutionHTML()` in panel.js, off buildStatus()'s signals; the similar-upgrades→tunes header groups are
the interactive resolution. Do not reintroduce the linear spectrum as the primary status.

**How to apply:** once a build is IDENTIFIED (cid group + file) or SAVED/PICKED, its
`(hw_hash, tune_hash)` is authoritative for selection and comparison — the forwards gear ladder must
not override a hash-pinned build. Do not fix reverse-direction problems (which variation is this, A/B,
tooling) with more gear-ladder/PI heuristics; route them through the two hashes. Related:
[[fh6-tuning-lane-split]], [[fh6-savefile-tune-decode]], [[daemon-ts-request-is-a-pick]],
[[fh6-gear-ladder-identity-solved]].
