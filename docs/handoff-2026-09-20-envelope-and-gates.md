# Handoff — 2026-09-20: the grip envelope end to end, and gates that prove the docs

Worktree `forza-eliminator-tips-db-c512c3`, branch `claude/forza-eliminator-tips-db-c512c3`, pushed to
`origin` at **`feb53fe`** (verified by `git ls-remote`). Companion to
[`handoff-grip-envelope.md`](handoff-grip-envelope.md) (the feature) and to the drag-strip handoff from
the parallel session, whose work this was checked against (§5).

Two strands, which turned out to be the same strand: **build the radius envelope**, and **stop the
documentation lying about what exists.**

## 1. The grip envelope — Stages A→C, shipped

The question: for a corner of radius r, on this surface, in this class, how fast has it actually been
carried? Full detail in [`handoff-grip-envelope.md`](handoff-grip-envelope.md); the decisions worth
carrying forward:

**`sqrt(a_p90 · r)` is not the p90 of speed.** The plan specified the bound as a derivation from lateral
g. Held-out coverage was **76.2 %** against a nominal 90 %, because within a band a sample can be fast at
low g or slow at high g — the two distributions do not map. The bound is now the **measured** p90 of
observed speed, each sample projected to the band midpoint by `v·√(r_mid/r)` before the percentile is
taken. Coverage **88.5 %**.

That change also bought 8× the corpus. `mph` has no ceiling (max seen 273.3) where `lat_g` censors hard
at 3.00 g, so classes **A and S1 — every band of the two biggest** — get a speed bound even though their
`a_p90` is unknowable. 24 of 24 publishable bins carry a speed; 11 did before.

**Saturation nulls the p90, not the row.** An early cut marked saturated bins unpublishable and silently
lost A and S1 entirely. Their medians (2.07–2.41 g) sit far below the censoring point and are sound.

**`bias_g` is measured per row, never a literal.** Jett's decision of 2026-09-19 was to publish the
50–80 m band *with* its optimism stated. Measuring per row proved that right: the 50–80 m bias is not one
number — S1 **+0.315**, S2 **+0.270**, A **+0.019**. A frozen +0.212 would have been wrong for all three.
The flag is a COLUMN (`bias_g` / `bias_note`) so the UI can neither invent a caveat nor drop one.

**Gate 4 is NOT TESTABLE and says so.** Dirt has 32 samples across 9 bins; none clears the sample gate.
Tarmac vs dirt cannot be compared on this corpus — the envelope is tarmac-only in practice. That is a
recorded limit, not a pass.

## 2. What the envelope needed from the schema

| schema | what | why |
| ---: | --- | --- |
| 11 | `grip_envelope` | computed inside `import_corners.py`, so it inherits the `corners` cascade — no new `rebuild.py` stage, and a session import cannot leave it stale |
| 12 | `corner_segment.med_r_m` | the DRIVEN radius per phase. The turn's catalogued `ref_route_turn.radius_m` is the road's fitted centre-line and misses recorded `lat_g` by a median 0.39 g, so the envelope is looked up by this and **never** by the catalogued radius |

`migrate()` gained an **index path**: it now parses every `CREATE INDEX` out of `schema.sql` and replays
the missing ones. Because they are all `IF NOT EXISTS`, there is no hand-maintained list to drift.
Adding an index to `schema.sql` is now sufficient — proved when `ix_session_hit` needed exactly one edit.

That closed a real defect: `ix_corner_segment` was **declared and absent**, leaving 68 k rows with no
index at all. `migrate()` covered columns, tables and views but not indexes — precisely the hazard
`fh6db.py`'s own comments warn about.

## 3. The gates — `check_db_docs.py`, 8 checks

Built after a re-measure found **56 stale row counts** and `DATA-INVENTORY` still calling `corner_obs`
empty while it held 17,560 rows. Prose does not fail loudly.

| check | proves |
| --- | --- |
| `schema` | `schema.sql` EXECUTES, and declares exactly what the live DB has |
| `handoff` | every table AND view documented, with the right column list |
| `counts` | row counts still true — **reported, not failed** |
| `values` | every value that EXISTS in a catalogued enum is documented (the SET is failed on) |
| `json` | every store parses and declares a version or its provenance |
| `scripts` | the pipeline and gates are listed, and every path named resolves |
| `sources` | all 13 non-binary sources declare category/location/read/reader, and resolve |
| `stores` | two-way: every tracked store is documented |

Three design decisions that make them usable rather than ignorable:

- **PENDING vs BROKEN.** A declared object the live DB lacks is only a defect when nothing will ever
  create it. If it is registered in `migrate()` / `V2_COLUMNS` / replayed by `ensure_indexes()`, it is
  merely pending and gets reported, not failed — otherwise the gate cries wolf at another session's
  in-flight work.
- **Counts are reported, not failed.** The DB is written continuously; counts corrected in the morning
  were stale by the afternoon. A gate that can only be green between two imports is a broken gate, and
  this project has withdrawn one of those before. `--refresh` rewrites them; `--strict` gates.
- **`--refresh` refuses mid-rebuild.** A stage does `DELETE FROM x` then re-inserts, so a count read
  inside that window is a **transient zero**. `corner_segment` read 0 mid-rebuild and settled at 67,755.
  Writing that into the docs would have looked like a measurement.

Companion: `check_bt_template.py`, 9 checks over the 8 binary formats in `docs/formats/` — offsets against
the canonical reader and every real file, deep structural walks for the variable-length three, and a
`paths` check that every declared source location resolves.

## 4. What the gates found (all real, all fixed)

- **`ix_corner_segment`** declared, absent, 68 k rows unindexed.
- **3 tracked stores documented nowhere** — including `field-catalog.json`, the 2,007-row source for the
  three `ref_field*` tables. The field catalogue was itself uncatalogued.
- **All 10 views undocumented** in the handoff, and `DATA-INVENTORY` listed 6 of them. Views are the
  consumer contract — `build_web.py` generates from them and nothing re-derives.
- **`ref_field_reliability` carries TWO vocabularies on one tier ladder.** `tier` is the ordering;
  `tier_name` is per-domain. Slider values use the named hierarchy; part-name confidence reuses the same
  tiers as `proven`/`derived`/`unknown`. **Compare on `tier`, never `tier_name`** — code grouping by name
  would silently mix them.
- **§7 was the worst-drifted section in the inventory**: 23 of 35 line counts wrong (some >2×), and 46 of
  81 scripts absent — including `import_corners.py`, which now owns the envelope. The line-count column
  is gone on purpose; roles come from each script's own docstring.
- **`clone-coverage.json` had neither version nor provenance** — a generated report where a stale copy was
  indistinguishable from a fresh one.
- A 10-byte undecoded block at `0x04` in the tune blob; the `.owt` version is `0x0200` not `2`; a
  CryptoContainer's chunk size cannot be inferred from its file size.

## 5. Checked against the parallel session's lap guards

Their drag-strip work re-analysed all 442 captures and added guards striking impossible lap times. The
envelope consumes the same traces, so it was **measured**, not assumed clean:

- **`void` laps contribute ZERO samples** — excluding them changes nothing (S1 50–80 m: n=2,815,
  p90 106.7 mph either way).
- **603 samples (2.2 %) come from laps whose TIME was struck to `NULL`, and that is correct.** A
  rewind-corrupted lap clock does not make the trace wrong; the lap-canon rule keeps the trace of an
  untimed lap, and the envelope reads speed and `lat_g` per sample, never `lap_s`.
- **124 drag runs do not distort it.** A straight reads as a huge radius (p50 260 m), so only **8** of
  their samples fall inside the 15–200 m scope — a small independent check that `r = v/ω` behaves.

Their handoff asked for the two `VMAX` constants to be kept in sync **by hand**.
`tests/test_lap_speed_ceiling.py` now enforces it, and says to DELETE itself if they are ever promoted to
one shared home rather than being taught the new layout.

## 6. Open

1. **Stage C ships the speed; `a_p90` is censored for A and S1.** The drill-down should lead with the
   bound and treat `a_p90` as present-when-known.
2. **Gate 4 needs dirt laps, not code.** 32 samples over 9 bins.
3. **The slip-corrected radius is the real fix** for `bias_g`. `VelX`/`VelZ` are in the captures, so
   β is computable and `R = v/(ω − dβ/dt)` removes the bias at source — an analyzer change plus a replay.
4. **`field-catalog.json` can declare neither version nor provenance** — its top level is a list.
   Wrapping it in an object fixes that and breaks its readers; make that call deliberately.
5. **`session_hit` has no primary key**… it does now (`hit_id`, schema 12 — surrogate, because 6,754 of
   26,871 rows are exact full-row duplicates and any natural key would delete real observations).
6. **Three `_backup*` directories are tracked in git** — transient dumps, not stores. Reported, not mine
   to remove.

## 7. Standing notes for whoever is next

- **Run both gates after any game update or schema change.** They exit non-zero to gate a commit.
- **When a check fails, fix the thing — but if a check can never pass, withdraw it and say why.** Gate 1's
  second half and gate 3's error form were both withdrawn with measured cause, not for convenience.
- **Measure before writing a number into a doc.** Two entries in this session's own commits had to be
  corrected because a value was composed before it was read.
- **Gate every ad-hoc DB measurement on `rebuild_in_flight()`.** Three times a mid-write read nearly
  became a false report.
