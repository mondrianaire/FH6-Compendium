# FH6 local save-file tune decode — BREAKTHROUGH (2026-08-22)

**Verdict:** The screenshot+type "shop check" workflow is obsoletable for owned/local
tunes, and the locked-downloaded-tune wall is broken — by a **plaintext, stdlib-parseable
save file** already on this machine. This resolves the research fork the capture-methods
deep dive left open.

## What was found (measured, this machine)
- Path: `C:\XboxGames\GameSave\pgs\u_2533274793510722_16D460\88\ContainersRoot\Tuning_<ordinal>_<yyyymmddhhmmss>\Data`
- **496** tune `Data` files across **158 unique car ordinals**; **all exactly 598 bytes** (matches HDR gist `41426137a24ef83b3f391542ce51982d` to the byte).
- **Plaintext**, not encrypted: clean IEEE-754 F32 sliders + U32 part IDs + `0xFFFFFFFF` padding. `struct.unpack` reads them directly — no key, no AES, no external binary. (This is a SEPARATE store from the encrypted `...ProfileBackup` blob the deep-dive's savefile agent measured; that agent never checked `C:\XboxGames`.)
- Every ordinal (158/158) resolves to a name via `data/car-ordinals.json`. e.g. 249=Ferrari 250 GTO, 348=Ford GT (×7 tunes), 342=Ferrari F50 (×5), 326=Ferrari Dino 246 (×5).

## Layout confirmed against the gist
- `0x00` = `0x03` on all files (format/version byte).
- `0x01` = lock flag: **492 files = 1 (downloaded/locked)**, 4 = 0 (self-made).
- `0x000E–0x00D2` = installed parts as **U32 part IDs** (bucket A). Clustered IDs (e.g. `0x13880/1/2/3`) = variants within a part family; `0xFFFFFFFF` = slot empty.
- `0x019E–0x0252` = **F32 tune sliders (bucket B)**, stored **NORMALIZED 0.0–1.0** (0.5 = slider midpoint, 1.0 = max), with `-1.0` sentinels for unused trailing gears. Gearing shows as a descending 0..1 run at the tail — consistent with `tuning_order` ending in `gearing`.

## The two decision-critical questions — both answered
1. **Does the local file hold real values for LOCKED/DOWNLOADED tunes?** YES. The 492 flag=1
   ("downloaded/locked") files carry avg **24.8** non-default sliders (max 39) — full custom
   values, not stripped defaults. The UI hides them; the disk does not. **Locked-tune wall broken.**
2. **Plaintext or encrypted?** Plaintext (see above).

## What's left before a full parser (small)
- **Field-order validation (needs 1 ground truth):** align the 46 floats to `tuning_order`
  (tires, springs, ride_height, alignment, ARB, damping, brakes, differential, aero, gearing)
  and confirm against ONE known in-game tune screen. Everything points to the gist order holding.
- **De-normalization:** map 0..1 → displayed value using per-parameter ranges in
  `data/tuning-variables.json` (`tabs`). Fixed-range params (brake %, ARB 1–65) are trivial;
  weight-dependent ranges (springs) may need per-car min/max.
- **Part-ID → part-name** dictionary for bucket A (build incrementally; raw ID diffs already
  tell you what two builds differ on).

## Build plan (offered, ~½ day)
1. stdlib `struct` parser: `Data` → `{cid, ordinal, name, locked, parts[], sliders_norm[]}`.
2. De-normalize via `tuning-variables.json`; label via `tuning_order` + `car-ordinals.json`.
3. Daemon watches `ContainersRoot` (newest `Data` per ordinal) like it watches screenshots;
   pre-fills the build record → mostly **retires** shop-capture typing for owned/local tunes.
4. Read-only, copies only, game closed when possible. No writes ever (saves cloud-sync; a
   modified file could look like tampering). No new deps. Low ToS risk (passive file read).

## Ranking impact
Deep-dive ranked this #1 but "spike-gated." **The spike passed, better than assumed.** It now
outranks OCR/auto-capture outright for owned/local data. OCR stays as the complement for the
one thing the save file can't give (icon-only bucket-A signals not encoded as part IDs, and any
car whose tune was never saved locally). Share-code decode / memory reading remain dead/off-limits.

---

## BUILD COMPLETE (2026-08-22) + coverage findings

**Shipped:**
- `scripts/telemetry/fh6_tune_decode.py` — stdlib parser (`parse_tune`, `scan_tunes`, `tune_to_deliverable`) with the validated field map + range model.
- `fh6_live_daemon.py` — two GET endpoints: `/disk-tunes` (the 158-car library index) and `/disk-tune?ordinal=N` (decoded tune + Clone-Sheet deliverable; falls back to the live/active car).
- `dashboard/app.js` — **📀 On-disk tune** panel leads the Live·Decode subject; fetches per active car, caches, renders parts + tune tables. Verified in-browser via replay (Exocet 2866, Golf R 2142): confidence ~0.92–0.94, 2 tables, no request storm.

**Validation (no new screenshots needed):** de-normalisation `display = min + norm·(max−min)` reproduced footage-verified Golf R values — caster 6.5/5.0, brake balance 52, camber baseline −1.3, ride-height endpoints 6.9/8.1, and all four damping channels solving to a fixed **[1,20]** scale.

**Range model:** 20 sliders are game-fixed and de-normalise to absolute NOW (tire psi 14–55, camber ±5, toe ±1, caster 1–7, ARB 1–65, brakes 0–100/0–200, diff 0–100, damping 1–20). 7 are per-car (springs, ride height, downforce, final drive, gears) — shown as % toward pole; register a per-car range to get absolute (Golf R ride-height seeded).

**Extent of builds on disk:** 496 tunes / 158 cars (avg 3.1/car), **all 158 named** via car-ordinals.json. Gear counts span 4–10 (6/7/10 most common — the 10-speeds match the "cheapest-PI box" doctrine). Per newest tune: ~39/50 part slots populated, 21 absolute sliders + 7 per-car.

**Part-ID scheme (bucket A):** ~58% are ordinal-scoped (`id//1000 == ordinal`) → `id%1000` = upgrade tier index (ARB {0=stock,3=race}, brakes {0=stock,3=race}, compound {0–15=type}); ~42% are global catalog IDs for swappable parts (engine/trans/diff/turbo shared across cars — an engine swap points all internals at the donor engine's ordinal-scoped id). Raw IDs diff perfectly for donor-vs-replica; a small per-category index→name table is the only polish left for full labels.

**Ease of transform → decode deliverable: DONE.** `tune_to_deliverable()` emits the exact Clone-Sheet shape (shop menus + tune tabs, every row `measured` at confidence 1.0 for exact fields). It is a mechanical, one-file transform — the on-disk path can retire the screenshot+type workflow for owned/local tunes and reads the locked-tune sliders the UI hides.

**Deploy note:** the LIVE daemon (8765) needs a restart to serve the new endpoints — do it at a session break; the code is verified on a throwaway replay instance.

**Polish backlog:** per-car range registration (springs/gears/downforce/final-drive → absolute); per-category part-tier name tables; wire `/disk-tunes` into Recording·Decode as a browsable 158-build library; dedupe engine-swap rows.

---

## Per-car range registration — clone precision closed (2026-08-22)

The 7 chassis-specific sliders (front/rear springs, ride height, downforce, final drive, gears) can now
print EXACT numbers, not just slider position — closing the last gap in "full clone instructions."

- `data/car-tune-ranges.json` — persistable per-car [min,max] registry (seeded: Golf R ride height 6.9–8.1).
- `fh6_tune_decode.py` — `load_ranges()`, `back_solve(points)` (least-squares min/max from ≥2 distinct-norm
  points; value = min + norm·(max−min)), `register_range(ordinal, field, norm, value)` (accumulates points,
  solves + persists atomically). `parse_tune` reads the registry → per-car fields flip to absolute.
- Daemon `POST /tune-range` — registers a (norm, displayed-value) point; returns the solved [lo,hi] or null.
- Dashboard — the disk-decode panel shows a `=?` input beside each per-car slider; the user types the number
  they see in-game for that tune. Two saved tunes at different positions back-solve the car's range → every
  tune of that car then prints exact. Verified end-to-end: two points → solved [-650,1850]; seeded Golf R
  ride height flows through the decode path as "6.9 in (exact)".

**Clone status:** for a range-registered car, ALL 27 sliders + the full parts list print exact — complete
recreation instructions, including for locked/downloaded tunes. Un-registered cars show the 20 fixed sliders
exact + 7 as slider position (still cloneable by eye) until two known values are entered.

---

## Part-catalog decode — upgrade NAMES resolved (2026-08-22)

Every part slot now resolves to the exact FH upgrade name, closing the "what to install" gap.

- **Tier is `id % 1000` for ALL parts** (ordinal-scoped AND shared global): 0=Stock, 1=Street, 2=Sport, 3=Race (race-variant indices >3 cap at Race). Verified: clutch {0,3}, driveline {0,3}, camshaft/exhaust/intake {0,2,3}.
- **Transmission** family **2102 = Race transmission**; its tier encodes the SPEED COUNT (tier 0→6-speed, 4→7, 5→8, 6→9, 7→10, 8→4) — verified perfectly against each tune's gear_count. Named "Race Transmission · N-speed" using the decoded gear count directly.
- **Aspiration** named by slot + tier: single_turbo / twin_turbo / quad_turbo / pos_supercharger / centrifugal_supercharger × Street/Sport/Race.
- **Engine-swap donors**: some engine-internal families ARE car ordinals (1022=Ferrari F430, 2794=Porsche 911 Turbo S, 2270=Skyline GT-R) — a swapped engine's internals reference the donor car. (Not yet surfaced per-row; internals are tier-named.)
- **Compound** index → name via COMPOUND_NAMES (best-effort FH order; verify per car). **Dimension** slots (widths/rims/track/profile) → "level N". **Cosmetic** (rim style) → "Custom".

Result on the Exocet clone sheet: 37 named, 1 sizing, 2 cosmetic, **0 unresolved**. Implemented in `fh6_tune_decode.py` `_part_view` (+ CATEGORY_DISPLAY / TIER_NAMES / COMPOUND_NAMES / ASPIRATION_TYPE / RACE_TRANS_FAMILY); flows to `tune_to_deliverable`. Standard deliverable rendered as the FH6 Upgrades & Tuning menu — artifact claude.ai/code/artifact/9baffab2.

---

## Seamless decode→clone→tune loop (2026-08-22)

Measured decode latency: parse 0.17ms, full deliverable 0.25ms, endpoint 17ms (127.0.0.1). The gate is
FH's write timing — Data files are written per tune-SAVE (newest was 2.8h ago), not live per keystroke.

Shipped to make the loop hands-free:
- **Daemon folder-watch** (`disk_watcher` thread): watches the active car's tune folder; the instant a new
  `Data` file lands (you save in-game), it pushes a fresh decode + a save-to-save DIFF over SSE (`disk`
  event) within ~1.5s. Verified end-to-end via a temp save-root (`FH6_SAVE_ROOT` override): simulated save →
  banner "front arb 15.7→45.8" appeared with no refresh.
- **Auto-fill the tuning engine from the decode**: `getTune()` now merges disk-decoded exact slider values
  under user entries (keyed by ordinal). The Course/Free tuning panels show EXACT target numbers with zero
  typing — verified 11 values auto-filled (farb 15.7, rarb 49.1, bbal 53, center 72.2…). Per-car position-only
  sliders stay manual until their range is registered.
- **Save-to-save diff** (`tune_diff`): "🔧 Changed since your last save: front arb 15.7→45.8 · …" banner,
  fades after 45s; fires only on a genuine re-save of the same car (not a car switch).
- **Fast per-ordinal scan** (`tunes_for_ordinal`): globs one car's tunes (~1ms) instead of all 498.
- **127.0.0.1 default** + localhost→127.0.0.1 migration: kills the ~2s Windows localhost→IPv6 resolution stall.
