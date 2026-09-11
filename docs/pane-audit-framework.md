# Pane audit framework — real-estate budget, duplication, minimum-viable fields

A repeatable procedure for auditing any region of the dashboard's layout: how much vertical space it
spends, whether it says the same thing twice, and whether everything it shows is still reachable after
it's been made smaller. Copy §4.2's template, fill it in, done.

*Written from the audit of the left-pane course-info stack (`courseInfoPill` + `courseHeroHTML`,
`dashboard/v2/panel.js`) on 2026-09-11, synthesized from four parallel audits plus a direct code read
that corrected one measurement. That audit is carried through every section as the worked example —
look for the **FH6 example** call-outs. The framework itself is region-agnostic.*

---

## 0. Why this exists

Jett's complaint that started this: in course mode, before you reach the **course map** — by far the
most important element in the left pane — you scroll past a mini course-info panel and then a larger
one. Both panels are individually reasonable. The problem only shows up when you ask three questions
no single component's author asks while building it:

1. *How much of the scarce vertical budget does this region cost, relative to what it's worth?*
   (§1 — real-estate budget)
2. *Does anything on screen already say this?* (§2 — duplication detection)
3. *If I shrink this, did I actually delete data, or just move it somewhere still reachable?*
   (§3 — minimum-viable-fields test)

Any pane region can be run through the same three questions. §4 turns them into steps + a template.

**A fourth question, added after this audit found it the hard way:** *does a CSS rule force this
region to a size its own content doesn't justify?* `#leftHd`'s measured content was ~50px, but a
shared `.pane>header{height:70px}` rule (written to fit an older 3-row design) held it at 70px
regardless — 20px of pure rule-driven waste that a content-only measurement misses entirely. Always
check the *applied* CSS rule for a fixed height/min-height, not just the content that fills it.

---

## 1. The real-estate budget model

### 1.1 The principle

**Vertical pixels are a budget, and one element in most regions is the reason the region exists.**
In the left pane that's the course map — everything else (scope band, course-info) exists to orient
the map, not to compete with it.

> **Rule of thumb:** the primacy element gets the majority share of the region's height at the
> reference viewport. Everything else is *overhead* — necessary, but overhead — and overhead is
> audited against a ceiling, not against how much it would like to have.

### 1.2 Scoring one element

For every visually distinct block in the region, record two numbers and derive a third:

| column | how to get it |
|---|---|
| **value** (1–3) | 3 = needed for the decision made in the next glance. 2 = useful most sessions but tolerates a half-second lookup. 1 = reference/provenance — matters only when something looks wrong or during debugging. |
| **px cost** | the element's rendered height in CSS px at the reference viewport, *including* its share of parent gaps/padding **and any CSS-forced min-height/height that exceeds its content** (see §0's fourth question). Measure live (`getBoundingClientRect().height`) — a stylesheet reading is a fallback, never the record of truth, and always cross-check against a fixed-height rule on the element or an ancestor. |
| **density** = value ÷ px cost × 100 | higher density = leave alone. Lower density = a collapse/merge/tooltip candidate. |

Rank every element by density, lowest first — that ranked list is the compaction priority order.

### 1.3 Setting the ceiling

```
region height H  (measured at the reference viewport, this region's own box only)
  primacy element   ≥ 60–70% of H     (the map, the chart, the thing people came for)
  overhead total    ≤ 30–40% of H     (everything else, combined)
```

Not a law — a region with no dominant element (a settings pane, a table-only pane) doesn't have a
primacy element and this split doesn't apply the same way. Name the split explicitly in the results
template (§4.2) so the next audit checks against the number actually agreed, not a fuzzy memory.

### 1.4 FH6 example — the budget, measured (corrected)

Reference viewport: 4K portrait @ 200% = **1080 × 1920 CSS px**.

| block | source | height |
|---|---|---|
| `#leftHd` (mini pill) | **CSS-forced** `.pane>header{height:70px}` (`styles.css:203–204`) — content alone (78×48 glyph + one text line) is only ~48–56px | **70px** (not the content figure — the fixed rule wins) |
| `.pane>.body.map` top padding | later, more specific override at `styles.css:909` (`padding:2px`) beats the earlier `:308` rule (`padding:6px`) by source order | **2px** |
| hero glyph row (`.ch-glyph`) | `.ch-glyphsvg{width:132px;height:58px}` + legend | **≈58px** |
| hero stats row (`.ch-stats`) | `.ch-s b` 17px + `.ch-s em` 9.5px stacked, `line-height:1.15` | **≈30px** |
| hero bars block (`.ch-bars`) | header ~15px + one `.ch-bar` row (~19px) per class + 2px gaps + footnote ~14px | **≈145px** at 6 classes (the route 6001 case) |
| hero confidence line (`.ch-conf`) | one 11px line | **≈17px** |
| hero freshness line (`.ch-note`) | one 9.5px mono sentence, may wrap | **≈14–26px** |
| `.chero` own padding + 4 inter-block gaps | `padding:6px 8px 8px` + `gap:6px`×4 | **≈38px** |
| **total overhead before the map** | | **≈375–390px** |

At H = 1920 that is **≈20% of the whole pane** spent before the map even starts — and the map still
shares what's left with the turn table underneath it. A first pass at this number (content-only, no
fixed-height check) came in ~15px low; always apply §0's fourth question before trusting a total.

### 1.5 Cheap ways to cut px cost (ordered by how much they change the visual design)

1. **Check for a fixed height/min-height on the element or an ancestor first.** If one exists and
   exceeds the content, that's free height back with zero markup change — cheaper than any of the
   levers below and easy to miss (see §0).
2. **Fold two rows into one line.** A stacked value/caption pair (a "dashboard tile" idiom) said on
   one baseline instead — `LABEL value` inline — costs roughly half the height for the same fact.
3. **Move a class-by-class (or any per-category) breakdown from N always-visible rows into 1 row + a
   drawer.** The single biggest lever when it applies: a 6-row bar chart becomes one line of pills
   plus a hover/caret drawer that shows the same numbers with more detail.
4. **Shrink type, not meaning.** Do this last — smallest yield, and it's the one lever that trades
   legibility for space rather than removing genuine redundancy.
5. **Never hide the primacy element's own controls to save space elsewhere.** If the map's legend or
   layer toggles get compressed to make room for course-info text, the budget was moved, not spent.

---

## 2. Duplication-detection checklist

### 2.1 What counts as a duplicate

A duplicate is a **fact**, not a string. `"9 turns"`, `"9/9"`, and `"9 turns on 13+ laps"` are three
different strings and *two* underlying facts (a total, and a confidence-bucketed subset of it) —
matching on literal text misses this; matching on the underlying **data field or computation** catches
it, and also catches when two facts merely *coincide numerically* in one example without being the
same computation (worth naming as a near-duplicate, not collapsing outright).

### 2.2 Method — build a field inventory, then group by source, not by wording

1. **List every rendered fragment**, component by component, from the actual render code — grep the
   template literal for every `${…}` and the static text beside it. Don't skim; every fragment gets a row.
2. **Tag each fragment with its underlying field(s)** — the variable/computation it reads, not the
   label text next to it.
3. **Group fragments by that tag**, across every component in the region, not just within one.
4. **Any group with more than one contributing component is a duplication candidate.**
5. For each candidate, decide the primary appearance (§2.3) and what happens to the rest — drop, fold
   into the primary's string, or demote to a drawer/tooltip. Never silently delete the fact (§3
   enforces this).
6. **Check whether the same underlying data is computed differently at each site** before collapsing —
   two renders of "the same fact" can carry different filters (e.g. one reads the currently-filtered
   lap set, the other always reads the unfiltered whole). If so, they are not fully interchangeable —
   the collapse can still merge them, but the surviving copy should say which one it is (typically the
   unfiltered baseline moves to a drawer as reference context rather than being deleted).
7. **Check for format drift on every genuine duplicate** — when the same field grows a second call
   site with its own formatting ("9 turns" vs "9/9"), that's the underlying symptom: a fact escaping
   its one shared rendering helper. Fixing the duplicate is also the fix for the drift.

### 2.3 Picking the primary appearance

- Keep it in the component that already has the *supporting* detail.
- Prefer the appearance that costs the fewest incremental px (an addition to an existing line beats a
  new line).
- If two appearances tie, keep the one nearer the primacy element for facts the primacy element can't
  show itself (counts, provenance); drop the copy next to something the primacy element already
  communicates visually (e.g. a shape/loop rendered by the map itself doesn't need a second textual copy).

### 2.4 FH6 example — the resolved field groupings

| canonical fact | appears in (today) | verdict | primary appearance kept |
|---|---|---|---|
| route silhouette + start/finish dots | mini glyph (no tooltip) + hero glyph (+ legend) | duplicate render of the same shape, at two sizes | the small glyph, **with a tooltip added** carrying the legend's meaning — the legend text alone can't just move to a drawer, since the surviving glyph never had a tooltip to begin with |
| length | mini meta line + hero stat | duplicate | one inline stat cell |
| turn count | mini "9 turns" + hero "9/9" (measured/catalogued) + hero confidence "9 on 13+ laps" | first two are a true duplicate (same field, two formats); the third is a *different* computation (a confidence bucket) that happens to equal the total in the worked example | measured/catalogued fraction inline once; confidence breakdown kept once, in the drawer, as its own fact |
| laps on the course (264) | mini "22 of 264 drawn" + hero bar-chart header + hero freshness line | one number, three renders | one inline fraction (drawn/total) subsumes all three; car count folds to a tooltip on that same cell |
| discipline / road | mini rid-line suffix + mini's own badge tag | duplicate **inside the same component**, no hero involvement | the rid-line suffix; delete the badge tag |
| per-class lap breakdown | mini pills (counts suppressed) + mini's own plain-text drawer row + hero's proportional bar chart | triplicate | counts re-enabled on the pill rail (now the only always-visible copy) + the bar chart in the drawer (strictly more detail — proportional width, click-to-scope, unfiltered baseline); the plain-text drawer copy adds nothing on top of those two and is dropped |
| laps-by-class bar chart vs. the SCOPE band's own class buttons | scope band buttons show counts under the *current filter*; the hero bar chart shows counts over *every* lap, unfiltered | **not a true duplicate** — same axis, different denominator | both survive: scope band unchanged (out of this region's scope), hero's version demoted to the drawer as the unfiltered reference |
| kind chip vs. mode tags | one chip (single label, fallback-derived) + one tag per mode in a list that can hold more than one value simultaneously | duplicate **only when they'd say the same thing** — a route offered in both Rivals and Career needs both stated, since the kind chip's fallback can only ever name one | kind chip if present, plus one tag per mode the kind chip didn't already state — not a flat "keep one, drop the other" |

Facts that appear once and should stay exactly where they are: track name, route id, on-course /
browsing / on-event status, naming-provenance chip, median/best lap + car, climb, freshness timestamp
(minus the subsumed total), "sessions not yet counted," the "shares road with" line. A duplication
pass that "fixes" a component with no duplicates is scope creep.

---

## 3. The minimum-viable-fields test

### 3.1 The rule

**Collapsing a region must never reduce the set of facts a viewer can reach — only how many are
visible without an interaction.** Every fact keeps a home in exactly one of three tiers:

| tier | means | when |
|---|---|---|
| **1 — inline, always visible** | rendered in the collapsed, no-interaction state | removing it would change the decision made in the next glance |
| **2 — one interaction away** (caret/drawer, hover, click-to-expand) | checked sometimes, not every glance — a *widening* of an inline summary, not a new fact |
| **3 — tooltip only** (`title=` or equivalent) | provenance/meta that matters only when something looks wrong |

There is no tier 4. If a fact doesn't fit 1, 2, or 3, the redesign is about to drop it — stop and place
it before shipping.

### 3.2 Running the test on one fact

Ask in order, stop at the first "yes": (1) does removing it from the always-visible surface change
what can be decided from a glance? → Tier 1. (2) is it a widening of something already summarized
inline, checked occasionally? → Tier 2. (3) is it provenance/an id/a timestamp that matters only when
debugging? → Tier 3. None fit → the fact was mis-scoped for this region; flag it as its own finding
rather than forcing a tier.

### 3.3 FH6 example — classifying the course-info facts (final)

| fact | tier | lands after collapse |
|---|---|---|
| track name, route id, on-course/browsing status | 1 | identity row (unchanged in spirit, one line now) |
| length+loop, median, best+car, climb, turns measured/catalogued, laps drawn/total | 1 | one inline facts row, flattened (label:value on one baseline, not stacked) |
| class availability + per-class counts | 1 | the facts row's class-pill rail (counts re-enabled — this moved UP a tier once the bar chart left the always-visible surface, since it became the only always-visible class breakdown) |
| route shape / loop-vs-P2P | 1 (visual) + 3 (the dot-colour legend, as a tooltip) | the shape is drawn (tier 1, "is a fact by being drawn," per §4.3's exception); its legend text moves to a tooltip on that same glyph — it must **not** simply disappear, since the surviving glyph had no tooltip to begin with |
| laps-by-class bar chart (proportional, unfiltered baseline) | 2 | drawer |
| laps-by-car breakdown | 2 | drawer (unchanged — was already tier 2) |
| confidence split | 2 | drawer |
| "shares road with X" | 2 | drawer, own line |
| naming-provenance chip | 3 (already correct) | unchanged |
| freshness (build time, sessions pending, geometry provenance) | 3 | drawer, minus the one clause now subsumed by the inline laps fraction |

Every duplicate found in §2.4 has a landing tier here — that's the check that closes the loop:
duplication detection says what to remove; the MVF test proves the removal reassigned rather than deleted.

---

## 4. The repeatable process

### 4.1 Steps

1. **Pick the region and its reference viewport.** Name the pane, the component functions, the exact
   viewport (this project's default: 1080×1920, portrait 4K@200%).
2. **Measure**, including the fourth question from §0: check every element and its ancestors for a
   fixed height/min-height before trusting a content-only number. Use live `getBoundingClientRect()`;
   stylesheet arithmetic is a sanity check, not the record.
3. **Score** with §1.2's table; fix the primacy split (§1.3).
4. **Inventory** every rendered fragment (§2.2), tagged by underlying field, across every component in
   the region — including whether two sites compute the "same" field under different filters (§2.2.6).
5. **Detect duplicates**, grouping by field; pick a primary appearance for each (§2.3); separately note
   near-duplicates that merely coincide numerically in the worked example.
6. **Classify** every canonical fact — duplicated or not — with the MVF test (§3.2).
7. **Draft the target layout** against the tiers and density ranking: tier 1 stays inline (compacted
   with §1.5's cheapest levers first, fixed-height rules removed first), tier 2 to a drawer, tier 3 to
   a tooltip. Recompute the projected height against the ceiling.
8. **Prototype, remeasure, reconcile.** Build it, measure the real px, and confirm every row from step
   4 still has a home. Zero rows may end up homeless. Record before/after numbers.

### 4.2 Results template

```markdown
## Pane audit — <region name>

Date: <yyyy-mm-dd> · Reference viewport: <w>×<h> CSS px · Components: <fn @ file:line, …>

### Budget
| block | value (1–3) | px (measured, incl. any fixed-height rule) | density | verdict |
|---|---|---|---|---|
Primacy element target share: <x>% of H · Overhead ceiling: <y>% of H
Current overhead: <measured px> (<pct>% of H) — <over/under> ceiling by <delta>

### Field inventory & duplication
| canonical fact | shown in | verdict (unique / duplicate n× / near-dup, different filter) | primary appearance kept |
|---|---|---|---|

### MVF classification
| fact | tier (1/2/3) | landing spot after collapse |
|---|---|---|

### Decision log
- <each call that wasn't mechanical, and why>

### Before → after
| | before | after | ceiling |
|---|---|---|---|
| overhead height | | | |
| primacy element height | | | |
| facts dropped | 0 (must always be 0) | | |

### Open questions
- <anything needing a call from whoever owns the product/design decision, not the framework>
```

### 4.3 Exceptions the framework doesn't resolve on its own

- **A region with no single primacy element** (a settings list, a table-only pane) — skip §1.3's
  split, apply a flat overhead ceiling to the whole region.
- **An element that IS a fact, not just a display of one** — a shape communicates loop/P2P *by being
  drawn*. Score it on visual/identity value, not on how many words it would otherwise take — but its
  *legend* (what a dot colour means) is still a separate fact that needs its own tier, typically 3.
- **Live/event-only rows** (banners, transient states) are conditional, not part of the steady-state
  budget — measure the region in its normal state, note conditional rows separately.
- **Two renders of "the same" fact computed under different filters/scopes are not automatically the
  same fact** — check before merging (§2.2.6); the correct move is often "keep both, demote the
  unfiltered/global one to the drawer," not "delete one."

---

## 5. Source index

| thing | where |
|---|---|
| mini course-info pill | `dashboard/v2/panel.js` `courseInfoPill()` 2008, painted by `paintLeftHeader()` 1826 / `paintLeft()` 1745 |
| hero course-info panel | `dashboard/v2/panel.js` `courseHeroHTML()` 1864 |
| shared pane-header height rule | `dashboard/v2/styles.css:203–204` (`.pane>header{height:70px}`) — affects `#leftHd` AND `#rightHd` |
| mini pill CSS | `dashboard/v2/styles.css:1176–1224` |
| hero CSS | `dashboard/v2/styles.css:543–583` |
| class pill / design-language rules | `docs/design-language.md` §0, §1 (line 28–29: the class pill is the one intentionally rounded element) |
| the game's own UI conventions | `docs/fh6-ui-spec.md` |
| viewport reference | memory `fh6-dashboard-monitor-portrait` |

Line numbers drift; search for the function/class name if a line has moved. Every px number here is a
*measurement claim*, not a constant — re-run step 2 of §4.1 before trusting an old audit's numbers on
a component that's since changed, and always re-check for a fixed height/min-height rule first (§0).
