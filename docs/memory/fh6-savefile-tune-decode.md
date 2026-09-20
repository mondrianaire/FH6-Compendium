---
name: fh6-savefile-tune-decode
description: "FH6 stores every tune as a plaintext 598-byte Data file on disk — struct-parseable, breaks the locked-downloaded-tune wall, obsoletes shop-check screenshots"
metadata: 
  node_type: memory
  type: project
  originSessionId: 6df3e83b-72ec-4c37-9c9f-0b4b3817f1f4
  modified: 2026-08-28T15:29:57.960Z
---

FH6 writes each tune as a **plaintext 598-byte binary** at
`C:\XboxGames\GameSave\pgs\u_2533274793510722_16D460\88\ContainersRoot\Tuning_<ordinal>_<yyyymmddhhmmss>\Data`.
Verified 2026-08-22: 496 files / 158 ordinals (all 158 resolve via data/car-ordinals.json),
all exactly 598 bytes, matching HDR gist 41426137a24ef83b3f391542ce51982d. NOT encrypted
(the encrypted `...ProfileBackup` blob is a different store). `struct.unpack` reads them — no key, no deps.

Layout: 0x00=0x03 version; 0x01=lock flag (1=downloaded/locked, 0=self); 0x000E–0x00D2=U32 part IDs
(bucket A, 0xFFFFFFFF=empty slot); 0x019E–0x0252=F32 sliders (bucket B) stored **NORMALIZED 0..1**
(0.5=midpoint, 1.0=max, -1.0=unused gear), order follows tuning-variables.json `tuning_order`.

**Why this matters:** the 492 locked/downloaded files carry full non-default values (avg 24.8 real
sliders) — the in-game UI hides downloaded-tune numbers but the disk has them. This **breaks the
locked-tune wall** the telemetry/decode pipeline was built to climb, and can retire the ~9
screenshots/car shop-check typing for owned/local tunes. See [[jett-tuning-workflow]] (downloaded
tunes were "LOCKED, no view/modify" — true in-UI, false on-disk).

**BUILT 2026-08-22:** `scripts/telemetry/fh6_tune_decode.py` (parse_tune/scan_tunes/tune_to_deliverable),
daemon endpoints `/disk-tunes` + `/disk-tune?ordinal=N`, and the dashboard **📀 On-disk tune** panel in
Live·Decode (verified in-browser). Field order + de-normalization VALIDATED against footage-verified Golf R
values (no screenshot needed): caster 6.5/5.0, brake bal 52, camber −1.3, ride-height 6.9/8.1, damping fixed
[1,20]. 20 sliders are game-fixed→absolute; 7 per-car (springs/rideheight/downforce/finaldrive/gears)→% toward
pole until a per-car range is registered. Part IDs: `id%1000`=tier for ALL parts (0=Stock,1=Street,2=Sport,3=Race), ordinal-scoped AND global.
Transmission family 2102 = Race transmission, tier=speed count (0→6sp,4→7,5→8,6→9,7→10,8→4) — but 2102 is a
shared global namespace, not race-trans-exclusive (diffs use it too), so match on the transmission SLOT.
Aspiration named by slot (turbo/supercharger type) × tier.
**ENGINE/POWERTRAIN — CORRECTED 2026-08-23 (the earlier "swaps not decodable" conclusion was a bug):** the `engine`
slot family (id//1000) is ALWAYS the car's OWN ordinal — it encodes ONLY the engine BUILD level (tier=id%1000),
NEVER the swap. Reading it (the old rule "family!=own=swap") made EVERY car decode as "Stock engine" → the false
"0 swaps in garage". The engine's REAL identity = the family shared UNIFORMLY by the engine-INTERNAL slots
(camshaft/valves/displacement/pistons/fuel_system/ignition/exhaust/intake/flywheel/oil_cooling + the aspiration
slot) — verified 227/227 configs uniform. A family used by ≥2 distinct cars, or that is another car's ordinal, is
a SWAP. **The "1022=F430" claim was RIGHT after all:** ~18% of engine families ARE donor car ordinals (1022 F430
V8, 2154 M4 I6, 2794 911 Turbo, 1009 Evo X, 2270 Skyline, 3759 Huracan…); the rest are catalog ids named by
majority-brand of the cars that share them (733=Honda SC 4-cyl, used by Civic/Beat/City/Acty + Exocet). IMPACT:
**104 of 159 garage cars had a hidden engine swap.** BUILT: `engine_family_of()` + `load_engine_catalog()` in the
decode, `scripts/telemetry/build_engine_catalog.py` → `data/engine-swaps.json` (134 families), daemon
`_learn_engine_catalog` accrues measured cyl/redline/hp/PI per family (cross-car signature transfer — Jett's
"track PI/signature per part" idea). Row now reads "Engine SWAP · <name> · <disp>L · <cyl>". EVs still MUTUALLY
EXCLUSIVE `motor` slot = "Stock electric powertrain". Daemon `_enrich_engine_desc` still folds live cyl/redline/
dyno-hp into the row. See [[fh6-external-tuning-sources]] for the roster source (data/car-ordinals.json, 660 cars). **DIFFERENTIAL** id%1000 is a
discipline TYPE (family=namespace): 0=Stock, 5=Race(64 cars,verified), 6=Rally, 7=Off-Road (all idx-7 drive
fronts), 3=Sport; else "type unverified" (was mislabeling 55% of non-stock cars "Race"). **TIRE COMPOUND** idx (updated 2026-08-23 from an in-game Tire-Compound MENU video, Exocet ord 2866):
only idx 0=Stock is VERIFIED. The menu gives the REAL FH6 NAMES — Stock(can be Slick) / Semi-Slick Race / Slick Race /
'Horizon' Semi-Slick Race / Offroad Race / Snow / Drift / Drag (NO plain "Race"; no Street/Sport/Rally on that car) —
but the menu GRID ≠ save index (idx4 is globally empty yet grid-pos-4=Drift; dominant idx5=67cars can't be Drift) AND
shows only a car's AVAILABLE subset, so it does NOT map name→index. Exocet stock tile = "Stock Tire Compound (Slick)"
→ the My Cars pane "Slick Tires" = STOCK (idx0), not an upgrade. data/tire-compounds.json now holds the real-name
guesses (tagged unverified) + the observed roster. To finish the index map (incl. 11/12/15): install+save a few
distinctive compounds on ONE car, decode tire_compound%1000 — the index is GLOBAL so one car anchors the garage. Gears+final-drive now print derived-exact (see [[fh6-slider-range-derivation]]). Every category
resolves in `_part_view` / `_conversion_rows` / `tune_to_deliverable`. Standard deliverable = FH6 Upgrades&Tuning menu style. **READ-ONLY, never write** (cloud-sync = tampering).
**Deploy gate:** restart the live daemon (8765) at a break to serve the endpoints. Polish backlog +
full details in research/savefile-decode-2026-08-22.md.
**CONTAINER WRITE SEMANTICS (2026-08-28):** a Tuning container is written when a downloaded tune is
APPLIED (locked=1) or an own tune is SAVED (locked=0) — so for locked tunes the way to (re)capture a
missing file is RE-APPLY from Find Tunes, never "save" (impossible in-UI). **RE-APPLYING the tune that
is ALREADY ACTIVE writes NOTHING** (evidenced 2026-08-28: numerous re-applies, zero new containers) —
to force a write, apply a DIFFERENT tune first, then re-apply the wanted one (or change any part/slider
and save, if own). Advice copy must never prescribe a bare re-apply for an already-active tune. Garage INSTANCES don't get
their own tune files (two cars of one model can share one container) and NO tune↔livery link exists on
disk; identity for locked tunes = gear-ladder verification (sticky, `ST.gear_id`) + livery pins/causal
auto-association (`data/build-liveries.json`, identity-timeline `_gear_log`). Livery/SoulBoundLivery/
BaseLivery containers (name+creator UTF-16 header, bigThumb.webp only for full designs) are the player's
recognition key; paint-only cars write BaseLivery with no thumb; untouched factory paint writes nothing.

**The rest of the save folder (decoded 2026-09-03):** beside `Data` sit `header` and `Thumb.png`. `header` v7 = u32 7 · u32 nTitle · UTF-16LE title · u32 nDesc · UTF-16LE description · SYSTEMTIME created (16 B, UTC; own saves = save moment, downloaded = author's creation) · u32 flag · u64 creator XUID · u32 nCreator · UTF-16LE gamertag. `Thumb.png` is NOT png: own saves = WebP 670×376; downloaded = ForzaTech texture `burG` (u32 header len @8 = 140; W,H u32 @76; TXCB/TXCH chunks) holding a BC7 670×376 image — wrap in a DDS DX10 header (dxgi 98) and Pillow decodes it. The importer reads the whole header; build_web exports renders to api/thumb/<container>.webp.
