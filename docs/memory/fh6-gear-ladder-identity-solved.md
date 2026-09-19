---
name: fh6-gear-ladder-identity-solved
description: "HARD RULE — the \"which of N tied saves is equipped\" problem is already solved by _pick_meta()'s gear-ladder match; never treat it as unsolved or reimplement a shallower version"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 6df3e83b-72ec-4c37-9c9f-0b4b3817f1f4
  modified: 2026-09-03T17:38:18.362Z
---

**SUPERSEDED IN PART — read [[fh6-gear-ratios-never-need-driving]] first.** This memory's account of
*how candidates are decoded* (parts fingerprinting, permanent build letters, the sticky 2h hold)
still holds. Its claim that live-measured WOT samples are how ties get separated does not: the gear
ratios and final drive were reverse-engineered into a verified global band before this session
started (`data/global-slider-ranges.json`), so no live measurement of them was ever necessary —
identify the equipped candidate by matching against KNOWN values, not by measuring unknown ones.

When two or more saved builds for a car tie on cylinders/drivetrain/PI (the coarse live-telemetry
signature), the dashboard shows an "IDENTITY NOT SETTLED" state asking for gear evidence. **This is
not an open problem.** It is fully solved, already implemented, and sophisticated — read
`_pick_meta()` in `scripts/telemetry/fh6_live_daemon.py` (~lines 775–1096) before touching any
identity/ambiguity code or copy. Jett has corrected this same misunderstanding — that the gear
disambiguation is missing, weak, or needs "one full pull through the gears" as if starting from
zero — more than once across sessions (most recently 2026-09-03, with real frustration that it kept
recurring). This memory exists so it stops recurring.

**Why the problem looks harder than it is:** it's tempting to assume the daemon has to build an
UNKNOWN gear ladder from scratch by watching the player shift, the way you'd reverse-engineer an
unknown car. That's wrong. Every candidate save's *exact* gear ratios and final drive are already
sitting decoded on disk (the 598-byte tune file stores 10 gear floats + final drive directly) — the
daemon reads ALL candidates' full ratio tables via `TUNE.tune_to_deliverable()` up front. The only
unknown is which candidate is *currently equipped*, and that only takes a partial gear-ladder read
to answer, not a full pull.

**How it actually works** (`_pick_meta`, `fh6_live_daemon.py`):
1. **Candidates, not saves.** Saves are first grouped by exact PARTS fingerprint (sha1 of every
   non-null part id) into real *builds* — slider tweaks of one build are not separate candidates.
   Each build gets a PERMANENT letter (`data/build-letters.json`) that never changes once assigned.
2. **Coarse score first** (cylinders, PI, redline, save recency) usually settles it outright.
   `n_signature_ties` only rises above 1 when builds survive this scoring tied — genuinely
   hardware-plausible candidates, not every save on file.
3. **When tied, compare against the LIVE-measured ladder**, sourced from whichever of two places
   has it: the analyzer's `fd_gear` (exact, per completed lap) or the daemon's own live accumulator
   `ST.live_fdg` (median rpm/mph per gear, needs ≥8 samples in a gear). Either needs **≥3 distinct
   gears measured** — not every gear, not a "full pull."
4. **Unit-free when it has to be.** If any candidate's final drive is itself only *derived* (a
   linear guess from the slider %, not measured), an absolute ratio compare would be comparing a
   real ladder against a guess and could never clear the gate — audit finding "more driving makes
   disambiguation worse." So it falls back to comparing gear-to-gear STEP ratios (final drive
   cancels out), trading final-drive discrimination for correctness.
5. **Clear-winner gate**: lowest error must be < 0.06 AND beat the runner-up by > 0.02, or it stays
   ambiguous — `ladder_tied: true` in the match object means the ladder RAN and genuinely cannot
   separate them (identical gearing), which is a real dead end where a manual pick is the only
   escape, distinct from `n_signature_ties > 1 with gear_disambig: false` (just needs more driving).
6. **Verified identity is sticky for 2h** (`ST.gear_id`), surviving menus/pauses that drop the live
   frame, but yields instantly to contradicting live evidence (cylinder or redline mismatch) —
   never a stale lock.
7. **A picked save can be corroborated** without a full ladder: if it survives the hard filters
   (same live cylinders, gearbox big enough for gears actually used), that's accepted evidence too.
8. **Live PI staleness is caught separately**: once identity is settled, a live CarPI matching NO
   known save proves an unsaved in-menu change happened (`stale` in the match object) — sliders and
   shop browsing write nothing to disk, so this is the only way to detect it.

**Fixed 2026-09-03 (commit 23dcbf1), after Jett flagged — in their words — feeling "legitimately
crazy" that this had been raised many times with nothing changing.** Two UI surfaces promised that
an explicit "drive up through the gears" / "full pull" action was what settles a tie: the
"DRIVE TO RAISE CONFIDENCE" checklist's `gear-ladder` ask (`fh6_live_daemon.py`, in the
confidence/`ask()` builder) and the identity-ambiguous card's own `identity` ask in the same
function, plus the dashboard's `panel.js` headerCopy() ambiguous-state text. All three were false
or misleading: the real mechanism needs no explicit drill (it runs passively on ~3 clean gears,
already gated by `n_signature_ties`/`gear_disambig`), and the checklist's gear-ladder ask fires
almost permanently (`g_meas < g_tot`, true for most boxes) so it read as a constant, unmeetable nag.
The `identity` ask was removed outright; the gear-ladder ask kept its real, separate, achievable
purpose (telemetry-exact ratios) with the false identity claim stripped; the dashboard card now
leads with the pick instead of promising a pull. **If this ever resurfaces — new ask copy implying
gears must be deliberately driven to settle an identity tie — that is the same regression again;
remove the promise, don't re-add a drill.**

**How to apply:** the match object returned by `/disk-tune` already carries everything —
`n_signature_ties`, `gear_disambig`, `max_gear_seen`, `box_exercised`, `held`, `ladder_tied`,
`picked_ok`, `stale`, `builds` (with permanent letters + part diffs vs the base build). If the UI
copy or a fix ever needs to change what "identity not settled" says or does, read these fields and
`_pick_meta`'s logic first — do not write copy or code that implies the gear ladder is unknown or
that a "full pull" is required; it needs a partial ladder (≥3 gears) compared against tables the
daemon already has in full. If something about this flow looks broken, the fix is almost certainly
in how these fields are *consumed* (dashboard copy, a stale UI assumption), not in rebuilding
disambiguation logic that already exists. Related: [[fh6-daemon-ts-request-is-a-pick]].
