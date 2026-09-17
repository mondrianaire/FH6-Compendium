---
name: fh6-external-tuning-sources
description: "Vetted external FH6 tuning guides — trust ranking, the consensus baseline numbers we adopted, and which two sources contain errors"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 6df3e83b-72ec-4c37-9c9f-0b4b3817f1f4
  modified: 2026-08-23T04:26:01.508Z
---

Digested 7 external FH6 tuning guides (2026-08-22/23) for the turn-phase slider infographic. They are **convergent consensus**, which is what makes the numbers trustworthy — but quality varies, so cross-check.

**Trust ranking:**
- ★★★ **forzatune.com** — the ForzaTune app makers; expert, methodology-driven. Best source. Has a per-car calculator app (proprietary).
- ★★★ **forza.guide** — community/Reddit doctrine; also has a Meta Cars page (/meta) + a live spring-rate calculator + numbered 01–09 workflow.
- ★★½ **gamingpromax.com** — best-structured single article; full Mechanical Balance writeup.
- ★½ **grindout.com** — commercial boosting site; consensus BUT has the damping-ratio error (below).
- ★½ **skycoach.gg** — commercial boosting, ad-heavy; ride-height-by-car-type numbers.
- ★ **vpesports.com** — machine-translated; has a diff error (below). Low trust.
- **forzafire.com** — not prose; a tool site (Builder, tunes DB, best-cars-by-class + 6 category sub-guides). The lead for the shelved engine-swap/meta-build angle.

**Two error catches (the payoff of reading all of them):**
1. grindout says "bump ≈ 60% of rebound" — WRONG. Consensus (gamingpromax + skycoach + the universal 18/6 baseline) is bump ≈ ⅓ of rebound; rebound ≫ bump. We encoded rebound 18 / bump 6.
2. vpesports says "increase diff accel to fix power-oversteer" — WRONG (backwards); every other source correctly says REDUCE accel diff.

**Consensus baselines adopted into the dashboard** (`SLIDER_BASE` in dashboard/app.js, shown as absolute anchors on move cards when the current value is unknown): rebound 18, bump 6, brake bias 52%, brake pressure 100%, diff accel 55% (RWD road), decel 15%, AWD center 80% rear. **Mechanical Balance target 0.55–0.65 (~0.60)** and **Aero balance 0.40–0.45** are shown on the turn-phase anatomy image — MB is FH6's new live front-vs-rear-grip stat, set with ARBs first, and is fundamentally a mid-corner (phase-3) target.

**Confirmed, not new:** none of the 7 has a per-car slider min/max database or a per-part PI table — all use the weight-scaling spring formula (which forza.guide's calculator confirms exactly: k = f²·W_axle/19.56, recommended road freq 2.80 Hz F / 2.90 Hz R). This validates our derivation approach and the [[fh6-data-capture-constraint]] (the "datasource" IS the formula). Relates to [[fh6-slider-range-derivation]].
