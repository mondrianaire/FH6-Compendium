# Tuning Page Refresh — Architecture Plan

*Drafted 2026-08-15 from a full 3-agent census: 29 rendered blocks, 20 data sections, and the Training Zone boundary. Status: PROPOSAL — not yet implemented.*

## The diagnosis

The census confirmed the hunch: the page holds only **three knowledge bases**, viewed from many angles:

- **LEVERS** — things you can change: parts and sliders (slider catalog, drivetrain rules, engine swaps, parts data)
- **INSTRUMENTS** — things that measure the car: panel rows, telemetry pages, static tests, formulas
- **BEHAVIOR** — what the car does on the road: five phases, cornering envelope, symptoms, conditions

Everything else is a **PATH** — an ordered walk through those bases (buy order, templates, tune sourcing, capture protocol).

The current page interleaves all four with no spine: STEP-0 doctrine sits a full page-scroll away from the buy-order detail it summarizes; the corner map indexes sliders the visitor hasn't met yet; the diagnostic payoff (symptom→slider) is buried seven blocks deep in the Tune Lab while its richer sibling (the friction matrix) lives on another tab; tune sourcing — the least load-bearing section for a self-tuner with locked downloads — sits dead-center.

**Two orphaned datasets** (bundled, never rendered anywhere):
1. `parts-effects.json` — every measured part table, PI ledgers, engine decodes. Zero references in app.js.
2. `tuning-test-battery.json → build_forensics` — all four case studies, panel-matching doctrine, steady-state doctrine, catalog quirks. The project's hardest-won knowledge has no surface.

**Eight duplications** where the same fact lives in 2–4 files and can silently diverge (worst: template baselines say 28F/27R psi, −1.2 camber, center ~70 while the slider catalog says 28/27.5, −1.3, 72 — *they already diverged*).

## The organizing principle

Two rules, applied everywhere:

**1. The page reads as the tuning loop.** A session flows *decide → adjust → measure → diagnose → verify*, so the page does too. Every section is one station of the loop; paths are short rails between stations, not separate essays.

**2. The tab boundary is usage-mode, not topic.** TUNING = what you open while the game is paused (lookups, matrices, calculators, checklists, test procedures). TRAINING ZONE = what you read on the couch (mechanisms, archetypes, physics, feelings). Compact tools get mirrored onto Tuning with "why →" links back to Training; doctrine prose lives once, on Training.

## The new page structure

```
🔧 TUNING — the workbench
├── 0 · START HERE (path rail, compact)
│     "What are you doing right now?" → three doors:
│     Build a car → §4 · Set a baseline → §3 · Fix a symptom → §1
├── 1 · DIAGNOSE (BEHAVIOR → the router)
│     Merged diagnostic surface: friction axle×phase matrix (compact mirror),
│     symptom→slider matrix, conditions pre-flight checklist.
│     One entry point for "the car does X."
├── 2 · ADJUST (LEVERS — the slider catalog, rebuilt)
│     Fixed 9-tab rack order (the in-game order). Every slider card carries:
│     phase glyphs · panel-visibility badge (from Test Zero) · ratio pair ·
│     baseline · unlock part · direction rules.
│     The interactive corner map becomes the catalog's INDEX, not an interruption.
├── 3 · BASELINE (PATH — templates)
│     Discipline templates + convergence scale, directly after the catalog
│     they parameterize. Single source for baseline numbers.
├── 4 · BUILD (PATH + LEVERS — parts)
│     Buy order, drivetrain rules, engine swaps, PI doctrine ("the table plans,
│     the preview prices"), display traps — AND the parts-effects tables get
│     their first rendering here (measured engines, aspiration families,
│     negative-PI parts, ballast catalog).
├── 5 · MEASURE (INSTRUMENTS — new "panel decoder" section)
│     Every computed row (My Cars + tune pane) documented: what moves it
│     (sensitivity matrix), what can't (panel-dark), its traps (lazy rows,
│     wiggle-read, green badges). Telemetry-pages inventory mirrored here.
│     Calculators: cornering envelope, aero-brake index.
├── 6 · VERIFY (INSTRUMENTS — Tune Lab + the evidence room)
│     Test battery (fold in the stranded breakaway-margin test), capture
│     protocol, results log (populate from session history), and the
│     build_forensics case studies rendered as the "evidence room" —
│     every doctrine linked to the case that proved it.
└── 7 · SOURCE (PATH, demoted)
      Tuners/codes move to the bottom — or entirely to the Cars tab, where
      the all-codes overlay already lives. Locked downloads make this
      reference material, not workflow.
```

## The data refactor (single-sourcing)

One fact, one file; everything else references.

| Fact | Canonical home | Currently also in |
|---|---|---|
| Cornering envelope model | `formulas.json` | test-battery (full second copy → becomes pointer) |
| Baseline slider values | `tuning-templates.json` | tuning-variables baselines (→ reference template id) |
| 30/70 AWD split | `upgrade-strategy.json` drivetrain_rules | tuning-variables, templates |
| Slider effects/directions | `tuning-variables.json` (canonical per-slider record, stable slider IDs) | symptom matrix, drift slider_map, training-zone entries (→ reference IDs) |
| Weight-scaling rule | `formulas.json` | build_forensics |
| Viper engine solve | `parts-effects.json` donor_solution | formulas worked example, case_study_3 (→ pointers) |
| Tuner knowledge | merge decision needed: 4 files (tuners/roster/sheets/codes) → one `tuners.json` with kinds | — |
| Cold-tire rule, capture workflow, aero-brake index | one home each, cross-tab links | duplicated across Training/Lab boundary |

New data needed: `panel-rows.json` (or a key in tuning-variables) — the panel decoder's backing store: every computed row, movers, traps, Test-Zero visibility. Most content already exists in test-battery prose; this normalizes it.

## The prose budget (core design law — Jett, 2026-08-15)

> "The finished product should have almost no paragraphs at all — visual cues, formatted formulas, charts and graphs."

**Budget: ~1 caption sentence per block.** Everything else is structure. Knowledge is never deleted — it moves into drawers and tooltips.

| Today's prose form | Converts to |
|---|---|
| Mechanism explanation | Annotated SVG — the labels live ON the chart, not beside it |
| Doctrine / rule paragraph | **Rule card**: icon + imperative headline + one consequence line |
| "Why it works" / evidence prose | **▸ why drawer** (collapsible, closed by default) |
| Numbers buried in sentences | Stat tiles / **formatted formulas** (sub/sup + fraction layout, not code strings) |
| Test procedure paragraphs | Numbered step strips with icons |
| Comparison prose | Side-by-side extremes (the ratio-bar pattern) |
| Case-study narration | Timeline strips (the friction-run pattern) |
| Any game concept named in text | The game's own pixels (game-assets.json library) |

Worst offenders (census): grip-science concept paragraphs, situational-model doctrine prose, Tune Lab doctrine blocks, braking-science concept, chassis-character reading list, formula registry worked-example prose. Every phase of this plan applies the budget to whatever it touches; phase 4 sweeps the remainder.

## Visual language additions

- The five phase colours stay the connective tissue (unchanged).
- **Knowledge-base triad**: LEVERS / INSTRUMENTS / BEHAVIOR each get a persistent icon + accent used on section headers and cross-links, so "what kind of fact is this" is legible at a glance.
- **Panel-visibility badges** on every slider card: `panel-visible` / `panel-dark` — Test Zero's empirical split, surfaced as UI. This is the single highest-value new annotation: it tells you instantly whether the panel can confirm a change or whether you need telemetry.

## Implementation phases

1. **Data dedup + IDs** (no visual change): single-source the eight duplications, add stable slider IDs, build panel-rows data. *Risk: low. Everything else depends on it.*
2. **Skeleton reorder**: new section order + subnav rail, sourcing demoted. Content unchanged, placement fixed.
3. **New surfaces**: panel decoder section, merged diagnostic router, parts-effects rendering, evidence room (build_forensics).
4. **Polish**: visibility badges, cross-tab mirrors/links, results-log population, corner-map-as-index rework.

Each phase is independently shippable and browser-verifiable.
