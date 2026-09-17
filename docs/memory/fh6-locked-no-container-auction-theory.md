---
name: fh6-locked-no-container-auction-theory
description: "Working theory (Jett, 2026-09-03, not independently verified) -- the one known edge case where a car shows a LOCKED tune but the dashboard has zero on-disk save container for it: bought from the Auction House with someone else's tune already installed, which apparently never writes a local Tuning_* container the way a normal in-game save or a Tune Browser download does"
metadata: 
  node_type: memory
  type: project
  originSessionId: 6df3e83b-72ec-4c37-9c9f-0b4b3817f1f4
  modified: 2026-09-03T23:20:00.000Z
---

**The observation.** A car showed as locked in-game, but `/disk-tune?ordinal=N` returned
`available:false`, `"reason": "no on-disk tune for this car"` -- zero `Tuning_N_*` containers
anywhere on disk for it (verified directly this session). This is distinct from the normal
"downloaded/locked" case this project already handles well (a Tune Browser download DOES write a
container -- that's the entire mechanism the Clone Plan / Build Sheet flow depends on).

**Jett's explanation, offered as the only known way this specific gap occurs (not independently
verified by me -- I have no way to test Forza's actual save-write behavior on an Auction House
purchase from here):** someone else owns a car, installs a tune on it, then Jett buys that car
FROM the Auction House. The purchased car arrives with the seller's tune already installed and
locked, but the purchase itself apparently does not trigger the same local-container write that a
normal save or a Tune Browser download does.

**Ruled out explicitly this session, do not re-raise:** this is NOT an Eliminator-mode artifact.
See [[fh6-not-eliminator]] -- that was a wrong inference from a car-list cache, corrected and
retracted, and is not in play for this project at all.

**How to apply.** If a car shows `available:false`/no container again, check first whether it
matches this pattern (a build that's locked/not-yours, with genuinely zero prior ownership
history) before treating it as a bug in the identification pipeline -- it may be this same,
already-understood edge case. This is a real, if narrow, blind spot in the project's entire
save-file-based identification methodology: an Auction-House-acquired locked build may be
permanently unreadable by this pipeline, the same structural limit as any car whose build was
never captured to a local save file, for whatever reason. Worth a concrete next step if this
recurs: watch a real Auction House purchase's container directory at the moment of purchase to
confirm one way or the other, the same verification approach already used for the Tune-Browser-
download banner-text question flagged in [[fh6-lab-runtime-layout]].
