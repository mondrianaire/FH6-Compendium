# Kaitai Struct for the variable-length formats — assessment

*2026-09-18. Question: `check_bt_template.py` is offset-based, so it cannot validate the
variable-length parts — BXML's recursive node tree, `.nav`'s spline payload, `.str`'s string blobs.
Should Kaitai Struct (`.ksy`) generate parsers for those instead?*

**Verdict: no, and the investigation is what settles it.** Two of the three formats are a good Kaitai
fit but no longer need it; the third cannot be expressed correctly in Kaitai at all. Details below,
all measured.

## What changed while investigating

The goal behind the question was **verification**, not code generation. That turned out to be
reachable in stdlib Python, so the dependency buys much less than it looked like it would:

| Format | Deep check now running | Result |
| --- | --- | --- |
| BXML | walk the full recursive node tree | **7,121/7,121 consume the file to EXACTLY EOF** |
| `.str` | resolve every string in both tables | **118,536 resolved, 0 unresolved**; value/key hash sets identical in 290/290 |
| `.nav` | solve the two-ended layout | closes on 171/171; overlap bounded 0–16 B on every file |

These run inside `check_bt_template.py` (`DEEP:` lines) and cost ~35 lines each. A walk that lands
exactly on EOF is the strongest statement available about a variable-length format — if the structure
were wrong, it would not close.

## Per-format verdict

### BXML — good fit, no longer needed

Kaitai handles both hard parts natively. The index width is derived, not stored
(`u1` ≤255 strings, `u2` ≤65535, else `u4`), which is a textbook `switch-on` with integer cases; and
the node tree is recursive, which Kaitai types support directly. A `.ksy` would be clean.

But the walker already proves the structure over all 7,121 entries, and `fh6_bxml.py` already
round-trips BXML to ElementTree — a *stronger* check than any layout assertion, because it exercises
the semantics too. Kaitai would add a build step to re-derive a parser we have and have verified.

### `.str` — best fit of the three, also not needed

This is what Kaitai's `instances` are for: the string blobs are reached by offset rather than read in
sequence, and `pos:` expresses that natively where a `.bt` has to seek awkwardly. If we were starting
from nothing, this is the one I would write in Kaitai.

We are not starting from nothing, and the deep check resolves all 118,536 strings.

### `.nav` — **cannot be expressed correctly in Kaitai.** Two hard blockers.

**1. No half-float.** Kaitai's numeric types are `u1/u2/u4/u8`, `s1/s2/s4/s8`, `f4`, `f8`. There is no
`f2`. The `.nav` node record stores road width at `+0x1c` as IEEE-754 **binary16** — `fh6_nav.py`
decodes it with `struct.unpack('<e', …)`. In Kaitai you would read `u2` and convert in the host
language, so the spec stops being the parser for the one field a surface query actually wants. Bit
types don't rescue this: you can slice the sign/exponent/mantissa but the expression language has no
`pow`/`ldexp` to reassemble them.

**2. Overlapping fields that require reconstruction.** This is the deeper problem, and I found it by
failing to reproduce the layout. The WVAN payload is laid out **from both ends**:

- forward from `0x90`: `node[]` (48 B each), then `spline[]` (24 B each);
- anchored to the payload **end**, each section occupying `align16(size)`: `valBlob`, `keyBlob`,
  `valOff[]`, `keyOff[]`, `attr[]` — and then `link[]` and `memberNode[]` placed backward from there.

The two regions **overlap**. The last `spline` record's trailing `(memberEnd, attrEnd)` `u64` pair
occupies the same bytes as `memberNode[0..1]`, and the writer never fills them in; `fh6_nav.py`
reconstructs them as `nLink` / `nAttr`.

Measured over all 171 files, the overlap is exactly **0 bytes on 79, 8 on 89, and 16 on 3** — never
negative, never more than 16. It is structural, not corruption.

Kaitai can *place* overlapping fields (`instances` with explicit `pos` may overlap freely). What it
cannot express is "these two values are not real — substitute `nLink` and `nAttr`." A generated parser
would return whatever bytes happen to sit there for the final spline of every file, silently. That is
worse than no parser.

> This also corrects my earlier reading. I first walked `.nav` forward with position-alignment and got
> 79/171; the map in `fh6_nav.py`'s docstring aligns each section's **size** and anchors it to the end.
> The docstring is right and my forward reading was wrong — but the overlap it mentions in passing is
> load-bearing, and is now measured rather than asserted.

## Cost side

- `ksc` is **JVM-based**; this machine has no Java (`java: command not found`), and the Python runtime
  `kaitaistruct` isn't installed either. Adoption means a JVM build dependency plus a pip runtime.
- That cuts against a clear house style: `fh6_swatchbin.py` decodes BC7 with "no numpy, no PIL," and
  every reader here is stdlib-only. A JVM in the loop to regenerate parsers is a large change in kind.
- Generated parsers would **replace working, verified code** — a rewrite whose upside is a spec we
  would then have to keep in step with the same readers it replaced.

## Where Kaitai would win

Not hypothetically — concretely, if either of these becomes true:

1. **A second language needs these formats.** Kaitai compiles one `.ksy` to C#, C++, Go, Java, JS,
   Rust and more. If the dashboard ever parses `.owt` or BXML in the browser instead of via generated
   JSON, one spec beats two hand-written parsers. `.owt` and `.str` are the natural candidates.
2. **We publish this work.** A `.ksy` is a better artifact for other people than either a `.bt` or a
   Python module, and BXML in particular is of general interest to the Forza community.

If that day comes, start with `.str` and BXML, keep `.nav` in Python, and keep the deep checks either
way — they are what actually catches drift.

## Recommendation

Keep the current arrangement: **`.bt` for byte layouts, Python readers for parsing, and
`check_bt_template.py` for proof.** Revisit Kaitai only under one of the two triggers above, and never
for `.nav`.
