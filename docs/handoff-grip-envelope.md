# Handoff — the grip envelope: where it stands

*2026-09-18, §5 decided 2026-09-19. Companion to [`plan-grip-envelope.md`](plan-grip-envelope.md), which holds the design and the two
audits. This is the state of play: what is built, what was measured, what failed, and what a future agent must
not redo.*

**The question:** for a corner of radius r, on this surface, in this car — how fast before the front or the rear
lets go? **Status: Stage A built and populated. Stage B UNBLOCKED — §5 decided 2026-09-19.**

## 1. Built and shipped

| Piece | Where | Commit |
| --- | --- | --- |
| Driven radius from yaw rate (`r = v/ω`), per trace point | `analyze_session.py` → `lap_point.r_m` (schema 9) | `29076e8` |
| x/z no longer rounded to whole metres (one decimal) | `analyze_session.py` `_pts_out` | `29076e8` |
| `--sessions FILE` for targeted replays | `backfill_laps.py` | `629274c` |
| Radius populated over the official-lap corpus | 83 captures, 30m20s | — |

**Coverage now:** 192,995 of 511,998 trace points carry `r_m`, across 718 laps and 71 courses; 418 of those laps
are ones the game itself timed. Everything else is `NULL` and stays that way until another replay.

## 2. Why radius does not come from geometry — do not re-try this

`ref_route_turn.radius_m` is the road's fitted centre-line radius, not the line the car drives: across 7,527
mid-phase observations it implies 130 mph through a 62 m radius (5.5 g), missing recorded `lat_g` by a median
**0.39 g**.

Fitting the radius from the stored path instead **also fails**, for a reason that is easy to miss:
`lap_point.x/z` were **rounded to whole metres**, and at 4 m spacing that quantisation is a ~14° heading error
per step. The planned ±12 m window gave a **+3.33 g** median error. Widening to ±24 m removed the bias (+0.013 g)
but not the spread; ±40 m and beyond over-smoothed hairpins.

Yaw rate needs no differencing and no rounding, which is why the shipped version uses it. The rounding itself is
now fixed at source, so a future fit would not hit the same wall — but it would still be a worse estimator than
the telemetry's own channel.

## 3. Gate results, measured not assumed

**Gate 1 (bias) — PASS.** Median implied `v²/r` − recorded `lat_g` = **−0.095 g** on the yaw-rate radius.

**Gate 1's original second half — WITHDRAWN, with cause.** It demanded ≥60% of samples within 0.3 g. Stored
`lat_g` is a *peak* over the frames a checkpoint spans while `r_m` is a *median* over those same frames, and
`lat_g` is a filtered channel carrying banking. Per-sample agreement therefore has irreducible spread: **raw
60 Hz telemetry with no estimator at all reaches only 42%**. A gate no data can pass is a broken gate. Replaced
by gate 1b, below, which tests at the level the envelope reports at.

**Gate 1b (bin-level agreement, ≤0.20 g) — 4 of 5 bands pass** on the envelope's own sample definition
(no brake, throttle ≤ 50, steady radius, no impact):

| Band | n | laps | implied `a` | recorded `g` | diff | |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| 15–30 m | 955 | 328 | 2.188 | 2.195 | −0.007 | PASS |
| 30–50 m | 2,754 | 501 | 2.392 | 2.311 | +0.081 | PASS |
| **50–80 m** | 2,050 | 473 | 2.489 | 2.277 | **+0.212** | **FAIL** |
| 80–120 m | 819 | 269 | 2.161 | 2.088 | +0.073 | PASS |
| 120–200 m | 298 | 137 | 1.910 | 2.012 | −0.102 | PASS |

**50–80 m fails this gate and ships anyway, flagged** — §5. The FAIL above is the honest reading of the
estimator, not a reason the band is absent: it is published with its measured bias attached as data.

Outside 15–200 m the estimator degrades as expected and those bands are out of scope: 200–400 m reads −0.182,
and 400 m+ reads **−0.270** (implied 0.276 g against 0.546 g recorded) because at near-straight radii the yaw
rate is dominated by steering corrections rather than cornering.

## 4. The 50–80 m band — investigated, and it is a real bias

Contamination was the obvious suspect, and the friction circle shows up exactly as predicted: braking samples
read **+0.309**, clean pedals **+0.175**, steady radius **+0.194**, transitional **+0.265**.

But tightening the steadiness filter makes it **worse, not better**:

| Steadiness | n | laps | diff |
| --- | ---: | ---: | ---: |
| < 15% | 2,050 | 473 | +0.212 |
| < 10% | 1,343 | 392 | +0.236 |
| < 6% | 634 | 279 | +0.257 |

Noise converges under filtering; this diverges. **The mechanism is body slip:** with a slip angle the car yaws
faster than its path curves, so `ω > v/R`, `r = v/ω` reads too tight, and implied `a` reads high. 50–80 m is
where the most slip is carried — hard, committed cornering — so the bias peaks there. The same mechanism
explains the whole sign pattern: too high at cornering radii, too low at 400 m+.

**The real fix, when someone wants it:** the captures carry `VelX`/`VelZ`, so body slip β is computable and
`R = v/(ω − dβ/dt)` removes the bias at source. That is an analyzer change plus a replay, not a patch.

## 5. DECIDED — publish 50–80 m with the bias flagged

Scope is 15–200 m (Jett, 2026-09-18). **Jett, 2026-09-19: publish the 50–80 m band, carrying its measured
bias.** Coverage stays complete and the optimism is stated rather than hidden. Stage B is unblocked.

The band is the most-driven corner size in the set and reads roughly **+0.21 g optimistic** (§4). Two
things follow, and getting either wrong re-opens the problem:

**The flag is a COLUMN, not a UI string.** `grip_envelope` carries the per-band bias as data —
`bias_g` (signed, in g) plus a short `bias_note` naming the cause. The schema's own rule is that every
value a consumer needs is a column written once at ingest, not a computation performed on every read; a
caveat that lives only in a template is one refactor away from being dropped, and this is precisely the
caveat that must not be. The UI renders what the column says. It never invents a caveat and never omits
one.

**The number is MEASURED at build time, never a literal.** +0.212 g was measured on one corpus under one
sample filter, and the §4 table shows it moving with the filter (+0.212 → +0.236 → +0.257 as steadiness
tightens). Stage B computes `bias_g` per band from the same samples it builds the envelope from —
median implied `v²/r` minus median recorded `|lat_g|` — so the flag tracks the data instead of freezing a
snapshot of it. Bands whose bias is small still get the column; it simply reads near zero.

Wording ships as measured, e.g. *"+0.21 g optimistic — body slip makes `r = v/ω` read tight"*. Not
"approximate", not "±" — the bias has a sign and a cause, and both are known.

This does not retire the real fix. A slip-corrected radius (§4) removes the bias at source and would drive
`bias_g` toward zero on its own; until then the column is how the envelope stays honest.

## 5b. Stage B — BUILT 2026-09-19, and gate 3 fails

`grip_envelope` (schema 11) is declared in `schema.sql` + `V2_TABLES` and computed inside
`import_corners.py`, so it inherits the `corners` stage's cascade and a session import cannot leave it
stale. 73 bins over `(class, surface, radius_band)`, **24 publishable**, built in 0.11 s.

**Gates 2, 5, 6 PASS.** Monotonic within every scope+surface (B: 49.5 → 102.3 mph, C: 50.0 → 103.4,
S2: 70.8 → 133.9); zero `grip = 4`; no published p90 over 2 % saturated; every published bin ≥ 8 laps.

**Gate 4 is NOT TESTABLE.** Dirt has 32 samples over 9 bins and not one clears the sample gate. Tarmac
vs dirt cannot be compared on this corpus — the envelope is tarmac-only in practice. `mixed` (16 bins)
and `unknown` (14) are computed and stored but not published: `mixed` blends two grip regimes along one
route, `unknown` has no `road_class` at all. The real fix is per-SAMPLE surface from `ref_route_surface`,
which is per route POINT, not a better route-level label.

**Gate 3 FAILS — median hold-out error 6.2 mph against a ≤ 5 mph gate**, and the diagnosis matters more
than the number. The signed error is **+4.9 mph, over-predicting 76 % of held-out samples**, which is
what a p90 upper bound is *supposed* to do — the gate as written asks the envelope to predict TYPICAL
apex speed, the same category error as gate 1's withdrawn second half.

But the well-posed test does not rescue it. Held-out **coverage** of `v_envelope_mph`:

| Fitted quantile | Nominal | Achieved |
| --- | ---: | ---: |
| p90 (shipped) | 90 % | **76.2 %** |
| p95 | 95 % | 83.7 % |
| p99 | 99 % | 89.3 % |

**`sqrt(a_p90 · r)` is not the p90 of speed.** Within a band a sample can be fast at low g or slow at
high g, so the two distributions do not map; the derived speed under-covers. `a_p50` and `a_p90` are
sound grip statistics — `v_envelope_mph` is the part that fails validation.

**Consequence: Stage C stays blocked.** The plan says the UI ships only after every gate passes, and the
speed column is not calibrated. Do not surface `v_envelope_mph` yet. Either publish `a_p90` alone as a
grip figure, or compute the speed bound directly as the p90 of observed speed at that radius rather than
deriving it from g — that is the open question, and it is a real one, not a formality.

**Saturation nulls the p90, not the row.** `lat_g` is censored at 3.00 g and classes A and S1 run
3.0–12.1 % saturated in every band, so their p90 is unknowable — but their medians (2.07–2.41 g) sit far
below the ceiling and stay sound. An early cut of this discarded both and silently lost the two biggest
classes in the corpus.

**`bias_g` is measured per row** (§5), and measuring it per row was right: the 50–80 m bias is not one
number. S1 reads **+0.315**, S2 **+0.270**, A **+0.019**. A single frozen +0.212 would have been wrong
for every one of them.

## 6. What a future agent must know

- **The envelope sample definition keeps only 4% of samples** (7,240 of 182,343): no brake, throttle ≤ 50,
  steady radius, no impact. Per-band laps stay healthy (137–501), so the bins are real — but the base is far
  narrower than raw counts suggest, and pedal channels only exist from 2026-09-11.
- **`r_m` is NULL on every lap not re-analysed since 2026-09-18**, and so is sub-metre x/z. The store is
  deliberately mixed-precision; `r_m IS NULL` is the only marker of which is which.
- **Stage B belongs inside `import_corners.py`**, not as a new `rebuild.py` stage — see the plan's [A6]. A new
  table with no `STAGES`/`DOWNSTREAM` entry breaks the project's most-repeated hard rule.
- **"grip used" (schema 7) stays the authority** for how hard a corner was driven. The envelope must never say
  "ceiling" or "grip limit" in the UI — its vocabulary is "radius envelope" — or the drill-down grows a second
  source of truth for grip.
- **An envelope is a lower bound**, never "the car's maximum": nothing in the data distinguishes the car's limit
  from the hardest anyone tried. That wording ships in the UI verbatim.

## 7. If you resume this

1. ~~Take the §5 decision.~~ Done 2026-09-19: publish 50–80 m flagged.
2. Build Stage B inside `import_corners.py` over 15–200 m; gates 3–9 in the plan. It must emit `bias_g`
   and `bias_note` per band, computed from its own samples — see §5.
3. Stage C (UI) only after the numbers hold.
4. Optional, and the thing that would make 50–80 m trustworthy: body-slip-corrected radius (§4), which needs a
   replay — `backfill_laps.py --sessions` makes a targeted one ~24 min instead of 90.
