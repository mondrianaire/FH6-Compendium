---
name: fh6-drift-rate-law
description: Drift Zone pays ~260,000 pts per MILE, not per second — speed sets the rate only by covering ground sooner
metadata:
  type: project
---

Measured 2026-09-09 over 824 scoring seconds, 10 captures, 5 cars, ≥3 zones
(`scripts/drift/rate_model.py`).

Among seconds that are scoring at all, the ticker pays close to a **fixed amount per unit
of distance** — roughly **260,000 points per mile**:

- Fitting `rate = a + b·mph` gives **a = −492 pts/s**. A per-second law needs a big
  positive intercept; a per-distance law needs ~0 against a residual sd of 719. It's the latter.
- `pts/mile` is much steadier than `pts/second`: **cv 0.216 vs 0.378**.
- `pts/mile` by band is near-flat 20→89 mph (medians 247k / 270k / 286k / 296k / 293k),
  where a per-second law would fall as 1/speed. Holds at the top too: a 119 mph gate entry
  paid 8,306 pts/s, ≈279,000 per mile — on the constant, not above it.
- Similar across cars (255k–300k) and zones (247k–280k).

**What it means practically:** for a fixed-length zone, going faster does *not* multiply
the total — it mostly finishes the zone sooner at the same points per mile. The lever is
holding a scoring state over as much of the route's **length** as possible. This is the
mechanism behind the slow-donut exploit already in the guide: looping one corner adds
distance inside the zone without advancing to the finish.

**Residual, stated honestly:** band medians still climb ~17% from the 20s to the 50s
before flattening. That is either a real mild speed term or the driver holding more angle
when faster — the corpus cannot separate them, because angle is not measured. See
[[fh6-drift-angle-channel-dead-ends]]. Seconds that score *nothing* are outside this law
entirely — those are [[fh6-drift-zone-route-channel]].
