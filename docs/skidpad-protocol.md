# Skidpad runs — what to drive

*Written 2026-09-18. Analysis side: `scripts/analysis/skidpad.py`.*

## What this is for

Every build has a maximum lateral force its tyres hold before letting go. We can already read that off
the telemetry — `CombinedSlip` is Forza's own normalised slip and **1.0 is the tyre's limit**, so plotting
`|lat_g|` against it draws the tyre curve and its peak *is* the ceiling.

The problem is that frames scavenged from ordinary racing come from different corners at different radii,
speeds and steering inputs, and the peak moves with all of them. Measured on one build across six sessions,
the front ceiling wandered by **0.37 g**. A steady circle pins radius, speed and steering down, which is the
one thing the archive can't supply after the fact.

**Total ask right now: two builds, about three minutes of driving.** Not all twenty-five. If the first two
work, the rest is worth doing; if they don't, we've learned that cheaply.

---

## Before you start

1. **Lab running** — `scripts/lab_up.ps1`. You need the daemon on :8765 recording; the dashboard is optional
   but useful for the live readout.
2. **Turn off traction control and stability management.** This matters more than anything else here — with
   them on, the game intervenes before the tyres reach their limit and the curve never peaks. ABS doesn't
   matter (there's no braking in this test).
3. **Dry weather, daytime.** Wet changes the friction curve, which is a different measurement.

---

## Where to drive

Requirements, in priority order:

- **Flat.** A camber adds or removes lateral g and would be recorded as grip. This is the one that will
  quietly ruin a run.
- **Paved**, and the same surface for both builds so they're comparable.
- **Open**, with room for a circle of **40–50 m RADIUS** — that is 80–100 m across, roughly a football
  pitch's width — plus space to run wide when it lets go. Size matters more than anything except flatness:
  a tight circle cannot be driven at the grip limit, only drifted (see *When it goes wrong*).
- No traffic, no scenery to clip.

An airfield apron or a large car park is the classic choice — the Airfield area is the obvious candidate,
but pick whatever you know is genuinely flat and open. **Use the same spot for both builds.**

---

## The run — per build, about 90 seconds

Do this **twice per build, once each direction.** Both directions cancel out any camber in the surface and
any left/right asymmetry in the car, and they're reported separately so a difference shows up instead of
being averaged away.

1. **Optional but helpful:** on the v1 dashboard (`http://localhost:8000/`, the live status panel), click
   **➕ new run** to split the stint, and type `skidpad` into the tag box and click the tag button. The
   detector doesn't need this — it finds the runs on its own — it just makes them easy to locate later.

2. **Get rolling at about 30 mph** and settle into a big circle. Pick a steering lock and *hold it* — the
   circle should stay the same size throughout. Resist the urge to steer more as it gets faster; that's the
   most common way a skidpad turns into "a corner" and gets rejected.

3. **Feed the speed up gradually**, a couple of mph at a time, holding the same steering. Steady throttle —
   no stabs, no lifts. **Never touch the brake.** *The climb is part of the measurement, not just the
   preamble* — the curve needs samples from well below the limit as well as at it, so take ten or fifteen
   seconds getting there rather than arriving immediately.

4. **Use the least throttle that holds the speed.** This is a grip test, not a drift. If the back steps out
   and you're catching it with opposite lock, you are past the peak and measuring sliding friction instead
   of grip — ease off until it hooks up again and hold just below that.

5. **Find the limit and sit there.** The car stops tightening and starts running gently wide. Hold it right
   there — **ten seconds or more**. *That plateau is the measurement.*

   **Sanity check while you drive:** on a 40–50 m circle a grippy build should be doing **60–80 mph** at its
   limit. If you are at 30-something, the circle is too small or the car is sideways.

6. **Come off gently**, turn around, and repeat in the other direction.

7. **Second build:** swap car, same spot, same two circles.

---

## What makes a run count

The detector keeps frames where **all** of these hold, and needs **4 seconds or more** of them in a row with
the radius steady to within 25%:

| condition | why |
|---|---|
| no brake at all | braking loads the tyre longitudinally and smears the peak |
| `\|long_g\|` ≤ 0.20 | steady speed — neither accelerating nor slowing hard |
| yaw ≥ 8 °/s | actually turning |
| speed ≥ 18 mph | above walking pace |
| one direction | a direction change splits the run |
| radius steady within 25% | a circle, not a corner |

So the things that will silently cost you a run: **braking**, **winding on more steering as it speeds up**,
and **big throttle changes**. Slow, steady, boring is correct.

---

## When it goes wrong — how to recognise it

The first attempt (2026-09-18) came back as two clean, well-detected runs that measured the wrong thing, so
these are worth knowing:

| symptom | what happened |
|---|---|
| top speed around 30 mph | circle far too small — 13 m radius instead of 45 |
| measured ceiling well below what the car shows while racing | sliding friction, not grip |
| `slip F/R` both above ~1.3 | drifting: the tyres were past their peak the whole time |
| `slip F/R` both below ~0.85 | never actually reached the limit |

**The number to watch in the output is `slip F/R`.** The limiting axle — the higher of the two — should sit
at **0.9 to 1.2**. That is the tyre at its peak. Above it the tyre is sliding and the reading comes out LOW;
below it you never found the limit and it also comes out low. A run outside that band gets a `!`.

Practically: creep up until the car just starts to wash wide, then **back off three to five mph** and hold
there. The fastest speed at which it still *tracks* the circle is the measurement — not the speed at which
it starts sliding.


---

## When you're done

```bash
python scripts/analysis/skidpad.py captures/fh6_*.csv --pooled
```

It prints one line per run: the radius and speed you held, the **front** and **rear** ceiling, and which axle
gave up first. Send me the output, or just tell me you've run them.

---

## What I'm checking

**The bar is the two directions on one build agreeing to within about 0.05 g.**

If they do, the protocol controls what I claimed it controls, and it's worth doing the remaining builds — at
which point we get a clean per-build grip ceiling, a measured understeer/oversteer balance, and a target
precise enough to finally test whether the ceiling can be predicted from the parts and sliders alone.

If they don't agree, something in the setup is off (most likely camber in the surface), and we'll have found
that out in three minutes instead of forty.

Either way: **don't drive all twenty-five until the first two come back clean.**
