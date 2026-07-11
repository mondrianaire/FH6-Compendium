# Forza Horizon 6 — Tuning Decision Database & Dashboard

A local database of FH6 tuning variables and current meta cars, plus a
double-click dashboard that recommends **which car and which mods to buy** for a
given discipline, PI class, and budget.

> ⚠️ **Meta freshness.** FH6 released **2026-05-19**. Dataset captured
> **2026-06-07**, re-verified **2026-07-11** (patch audit + leaderboard-usage
> cross-check via forza.guide — see `meta_recheck` in `data/meta-cars.json`).
> Every claim carries a confidence tag (✅ verified / 🟡 probable / ⚠️ contested).
> Re-run research as the meta settles.

## Layout

```
data/                      ← the database (source of truth, hand-curated JSON)
  tuning-variables.json    full tuning parameter schema (ranges, units, baselines, tune order)
  meta-cars.json           top meta cars per class/discipline (price, drivetrain, mods, tunes)
  upgrade-strategy.json    upgrade/buy order + drivetrain rules + build principles
  eliminator-tips.json     Eliminator (battle royale): mechanics, car-drop levels, phase-by-phase tips
  sources.json             every source used, with tier + what it informed
scripts/
  build-db.mjs             compiles data/*.json → dashboard/db.js (window.FH6_DB)
dashboard/
  index.html               open this in a browser (no server needed)
  styles.css  app.js  db.js
research/
  notes.md                 methodology + confidence notes
```

## Use

1. Open `dashboard/index.html` in any browser (double-click).
2. **Recommend a Car** tab: pick discipline / class / budget → ranked picks.
   Click a card for mods-to-buy order, tune baseline, and share codes.
3. **Garage Tracker** tab: every meta car with its use case and an
   acquisition-difficulty indicator (🟢 easy / 🟡 medium / 🔴 hard). Tick cars as
   you collect them — owned state persists in your browser (localStorage), never
   in the data files.
4. Other tabs: tuning-variable reference, upgrade strategy, Rivals tracks, and
   Eliminator (battle-royale mechanics + tips by match phase).

## Updating the data

Edit the JSON in `data/`, then rebuild the bundle:

```bash
node scripts/build-db.mjs
```

This regenerates `dashboard/db.js`. The dashboard reads only from that bundle, so
no edits to `app.js` are needed when adding cars or tunes.

## Scope (v1)

First pass focuses on **current top-meta cars** per discipline (road, touge/street,
dirt/rally, cross-country, drag) — not the full ~600-car list, which has no settled
per-car tune data this early. Schema is built to expand to the full roster.
