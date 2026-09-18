-- FH6 Lab central database — data/fh6.db
--
-- THE RULE THIS SCHEMA EXISTS TO ENFORCE: every value a tool or the dashboard needs is a COLUMN,
-- written once at ingest, not a computation performed on every read. Before this file the project
-- resolved part names, slider units, tile positions, PI and clone routes at call time, from a dozen
-- JSON files, with the resolver logic duplicated in clone_parts.py, fh6_tune_decode.py, app.js and
-- the daemon. Four copies of a rule is four places for it to be wrong, and it was.
--
-- LAYERS (by table prefix):
--   ref_*   Reference. Imported wholesale from the game's own database (FH6_Database.sqlite) and its
--           string tables. NEVER hand-edited: a rebuild drops and repopulates every ref_ table.
--           Provenance for the whole layer is one row in import_run.
--   tune_*  Save-file truth. One row per container per slot / slider / gear, names and physical
--           values already resolved against the ref_ layer at import time.
--   hw_*    The hardware-package tier of the hierarchy: distinct part sets, independent of sliders.
--   session_*, course_*, lap_*  Telemetry.
--   obs_*   Human/observed evidence — screenshots, menu reads, PI steps. The only layer a person
--           writes by hand, and every row carries its source.
--   plan_*  Materialized deliverables (clone routes, readiness) — recomputed on demand but STORED,
--           so the dashboard and CLI read identical rows.
--   v_*     Views. The dashboard bundle is generated from these; no consumer re-derives.
--
-- CONVENTIONS
--   * Times are ISO-8601 UTC strings ('2026-09-02T05:14:14Z'). The game's container folder stamps are
--     UTC; local time never enters a column.
--   * A part id of 4294967295 (0xFFFFFFFF) means EMPTY SLOT and is stored as NULL part_id, never 0.
--   * confidence ∈ ('proven','verified','derived','read','unknown') — same vocabulary everywhere.
--   * JSON columns hold table-specific overflow only; anything queried is promoted to a real column.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ============================================================================
-- META
-- ============================================================================

CREATE TABLE IF NOT EXISTS schema_meta (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);
-- rows: schema_version, game_build (BuildNumber.txt), gamedb_md5, created_utc

CREATE TABLE IF NOT EXISTS import_run (
  run_id       INTEGER PRIMARY KEY,
  kind         TEXT NOT NULL,           -- one of scripts/db/rebuild.py STAGES: gamedb | events | curves | parts_extra | containers | telemetry | routes | surface | course_match | route_names | corners | observations | diagnosis | field_catalog ('road_class' = surface before 2026-09-05)
  source       TEXT,                    -- path or description of what was read
  started_utc  TEXT NOT NULL,
  finished_utc TEXT,
  n_rows       INTEGER,
  ok           INTEGER DEFAULT 0,
  notes        TEXT
);

-- ============================================================================
-- REFERENCE LAYER — the game's own truth
-- ============================================================================

-- Every display string in the game, from the 288 .str tables.
-- A reference in the game DB is a u64: (H(table_name) << 32) | H(key_name), where
-- H(s) = { h = 0xFFFFFFFF; for each UTF-8 byte c: h = rotl32(h ^ c, 7) }.
-- lo32 is NOT unique across tables (1,035 of 6,105 collide), so resolution MUST go through
-- the table identified by hi32 — the reason table_name is half the primary key here.
CREATE TABLE IF NOT EXISTS ref_string_table (
  table_name  TEXT PRIMARY KEY,
  name_hash   INTEGER NOT NULL UNIQUE,  -- H(table_name) = the hi32 of every ref into this table
  n_entries   INTEGER NOT NULL,
  has_csv     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS ref_string (
  table_name  TEXT NOT NULL REFERENCES ref_string_table(table_name),
  key_hash    INTEGER NOT NULL,         -- H(key_name) = the lo32 of a reference
  key_name    TEXT,                     -- 'IDS_Name_412' — NULL when only the hash survives
  content     TEXT NOT NULL,
  PRIMARY KEY (table_name, key_hash)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS ref_class (
  class_id     INTEGER PRIMARY KEY,     -- 0=D … 7=X
  name         TEXT NOT NULL UNIQUE,
  norm_max     REAL NOT NULL,           -- CarClasses.MaxPerformanceIndex
  pi_max       INTEGER NOT NULL,        -- MaxDisplayPerformanceIndex
  norm_prev    REAL NOT NULL,           -- lower anchor (0.0 for D)
  pi_prev      INTEGER NOT NULL         -- 99 for D — the anchor below the 100 floor
);
-- Display PI = max(100, ceil(pi_prev + (norm - norm_prev) * (pi_max - pi_prev) / (norm_max - norm_prev)))
-- Verified on 660/660 cars; ceil, not round.

CREATE TABLE IF NOT EXISTS ref_car (
  ordinal            INTEGER PRIMARY KEY,
  year               INTEGER,
  make               TEXT,
  model              TEXT,
  display_name       TEXT NOT NULL,     -- 'Honda NSX-R' as the game prints it
  full_name          TEXT,              -- '1992 Honda NSX-R'
  media_name         TEXT,              -- HON_NSXR_92 — joins the asset zips
  class_id           INTEGER REFERENCES ref_class(class_id),
  class              TEXT,
  pi                 INTEGER,           -- stock display PI
  pi_norm            REAL,              -- PerformanceIndex, 0..1
  curb_weight_kg     REAL,
  weight_dist        REAL,
  drivetype          TEXT,              -- FWD/RWD/AWD
  engine_placement   TEXT,
  cylinders          INTEGER,
  displacement_cc    INTEGER,
  aspiration         TEXT,
  num_gears          INTEGER,
  stock_engine_id    INTEGER,
  stock_drivetrain_id INTEGER,
  stock_carbody_id   INTEGER,
  stock_wheel_id     INTEGER REFERENCES ref_wheel(wheel_id),
  stock_wheel_level  INTEGER,           -- MassLevel of the stock rim: the anchor every rim chip is drawn against
  base_cost          INTEGER,
  rarity             REAL,
  rating_handling    REAL,
  rating_speed       REAL,
  rating_accel       REAL,
  rating_braking     REAL,
  rating_launch      REAL,
  rating_offroad     REAL,
  front_ride_height_m REAL,
  rear_ride_height_m  REAL,
  front_tire_mm      INTEGER,
  rear_tire_mm       INTEGER,
  front_rim_in       INTEGER,
  rear_rim_in        INTEGER,
  is_drivable        INTEGER,
  in_autoshow        INTEGER,
  data               TEXT                -- JSON: the remaining Data_Car columns, unpromoted
);
CREATE INDEX IF NOT EXISTS ix_car_class ON ref_car(class_id, pi);
CREATE INDEX IF NOT EXISTS ix_car_media ON ref_car(media_name);

CREATE TABLE IF NOT EXISTS ref_engine (
  engine_id     INTEGER PRIMARY KEY,
  name          TEXT,                   -- '3.2L I6' as the swap menu prints it
  media_name    TEXT,
  config        TEXT,
  cylinders     INTEGER,
  displacement_cc INTEGER,
  aspiration_stock TEXT,
  mass_kg       REAL,
  redline_rpm   REAL,
  data          TEXT
);

CREATE TABLE IF NOT EXISTS ref_drivetrain (
  drivetrain_id INTEGER PRIMARY KEY,
  drivetype     TEXT,
  shift_system  TEXT,
  is_swap_set   INTEGER,                -- 1 = a shared swap set (e.g. 2102), 0 = a car's own stock set
  n_cars        INTEGER,                -- how many cars reach this set
  data          TEXT
);

CREATE TABLE IF NOT EXISTS ref_car_body (
  carbody_id    INTEGER PRIMARY KEY,    -- Data_CarBody.Id == List_UpgradeCarBody.CarBodyID
  ordinal       INTEGER REFERENCES ref_car(ordinal),
  variant       INTEGER,                -- 0 = stock body, 1.. = kits
  name          TEXT,                   -- 'Rocket Bunny - Widebody Kit'
  length_m      REAL, width_m REAL, height_m REAL, wheelbase_m REAL,
  data          TEXT
);
CREATE INDEX IF NOT EXISTS ix_carbody_ord ON ref_car_body(ordinal, variant);

CREATE TABLE IF NOT EXISTS ref_motor (
  motor_id      INTEGER PRIMARY KEY,
  name          TEXT, media_name TEXT, mass_kg REAL, battery_kwh REAL, redline_rpm REAL, data TEXT
);

-- The 50 container slots. slot_index is the position in the save file's part array
-- (fh6_tune_decode.PARTS order); it is NOT Data_UpgradePart.Id for slots 42..49.
CREATE TABLE IF NOT EXISTS ref_slot (
  slot_index       INTEGER PRIMARY KEY,
  slot             TEXT NOT NULL UNIQUE,  -- our stable name: tire_compound, rim_style, …
  part_name        TEXT,                  -- the game's PartName (Data_UpgradePart)
  source_table     TEXT,                  -- List_Upgrade* the ids live in
  category         TEXT,                  -- Car | Engine | Drivetrain | CarBody | Motor | Wheels | none
  key_column       TEXT,                  -- Ordinal | EngineID | DrivetrainID | CarBodyID | (none)
  upgrade_type_id  INTEGER,               -- UpgradeTypes.id, for the (TypeId, Level) name lookup
  menu_area        TEXT,                  -- 'Tires and Rims'
  menu_area_order  INTEGER,               -- the Upgrade Shop tile order
  menu_order       INTEGER,               -- order within the area
  is_visual        INTEGER DEFAULT 0,     -- picked by manifest rank, not by level
  in_upgrade_shop  INTEGER DEFAULT 1      -- 0 = Paint and Customize (hood, skirts, rear bumper)
);

-- Every purchasable part in the game, all 40-odd List_Upgrade* tables unified.
-- (slot, part_id) is the key because ids repeat across slots.
CREATE TABLE IF NOT EXISTS ref_part (
  slot          TEXT NOT NULL REFERENCES ref_slot(slot),
  part_id       INTEGER NOT NULL,
  key_id        INTEGER,                 -- Ordinal / EngineID / DrivetrainID / CarBodyID this row belongs to
  level         INTEGER,                 -- the catalogue level — the ONLY correct name key (never the id's low digits)
  is_stock      INTEGER DEFAULT 0,
  name          TEXT,                    -- resolved: Upgrades.Name via (upgrade_type_id, level)
  manufacturer  TEXT,
  price         INTEGER,
  mass_diff_kg  REAL,                    -- the part's own mass delta; 42 of the List_Upgrade* tables carry one
  weight_dist_diff REAL,                 -- and its front/rear distribution shift
  tile          INTEGER,                 -- 1-based position in that car's menu for this slot
  tile_count    INTEGER,                 -- how many tiles the menu shows
  requires_aspiration TEXT,              -- the sub-menu only appears under this aspiration
  requires_graphics   INTEGER,
  confidence    TEXT NOT NULL DEFAULT 'proven',
  data          TEXT,                    -- JSON: the physics columns of the source row
  PRIMARY KEY (slot, part_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS ix_part_key ON ref_part(slot, key_id, level);
CREATE INDEX IF NOT EXISTS ix_part_name ON ref_part(name);

-- The tuning bands a fitted part supplies. This table is what kills the "=?" capture problem:
-- a slider's real min/max/default comes from the installed part's physics row, not a screenshot.
CREATE TABLE IF NOT EXISTS ref_part_slider (
  slot        TEXT NOT NULL,
  part_id     INTEGER NOT NULL,
  slider      TEXT NOT NULL REFERENCES ref_slider(slider),
  def_value   REAL,                      -- the physical default the game writes on install
  min_value   REAL,
  max_value   REAL,
  def_norm    REAL,                      -- (def-min)/(max-min), or 0.5 when min == max
  locked      INTEGER DEFAULT 0,         -- min == max: the slider exists but cannot move
  PRIMARY KEY (slot, part_id, slider),
  FOREIGN KEY (slot, part_id) REFERENCES ref_part(slot, part_id)
) WITHOUT ROWID;

-- The 36 tuning sliders, in save-file order, with how each one converts.
CREATE TABLE IF NOT EXISTS ref_slider (
  slider        TEXT PRIMARY KEY,        -- front_spring_rate, rear_arb, front_camber, …
  slot_index    INTEGER NOT NULL,        -- offset order in the container (0x19E + 4*i)
  group_name    TEXT,                    -- Tires | Gearing | Alignment | Antiroll Bars | Springs | Damping | Aero | Brake | Differential
  display_name  TEXT,                    -- as the Tuning screen prints it
  unit          TEXT,                    -- psi | in | lb/in | deg | kgf | % | ratio
  band_source   TEXT NOT NULL,           -- part | fixed | gear — where min/max come from
  source_slot   TEXT,                    -- which container slot supplies the band when band_source='part'
  fixed_min     REAL,                    -- when band_source='fixed' (camber -5..5, caster 1..7, toe -5..5)
  fixed_max     REAL,
  formula       TEXT,                    -- human-readable conversion, for the UI's help text
  confidence    TEXT NOT NULL DEFAULT 'verified'
);

CREATE TABLE IF NOT EXISTS ref_wheel_category (
  category_id   INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,           -- Stock | Sport | Multi Piece | Specialized | All Rim Styles
  display_order INTEGER
);

CREATE TABLE IF NOT EXISTS ref_wheel (
  wheel_id      INTEGER PRIMARY KEY,     -- List_Wheels.ID — what the rim slots store
  name          TEXT,                    -- 'Hockenheim R'
  manufacturer  TEXT,                    -- 'TSW'
  full_name     TEXT,                    -- 'TSW Hockenheim R' — the in-game name bar
  media_name    TEXT,
  mass          REAL,                    -- NOT the performance attribute; kept for reference only
  mass_level    INTEGER,                 -- 0 heaviest … 4 lightest — THE weight class for cloning
  price         INTEGER,
  is_stock      INTEGER,
  category_id   INTEGER REFERENCES ref_wheel_category(category_id),
  display_order INTEGER,                 -- rank inside the category = the menu tile order
  tile_row      INTEGER,                 -- rank//3 + 1
  tile_col      INTEGER                  -- rank%3  + 1
);
CREATE INDEX IF NOT EXISTS ix_wheel_class ON ref_wheel(mass_level, category_id, display_order);

CREATE TABLE IF NOT EXISTS ref_compound (
  compound_id     INTEGER PRIMARY KEY,   -- List_TireCompound.TireCompoundID
  name            TEXT,                  -- the upgrade name that fits it ('Rally Tire Compound')
  internal_name   TEXT,                  -- '51_Modern_Rally'
  lat_slip_peak   REAL,                  -- asphalt peak slip angle — the analyzer's grip threshold
  long_slip_peak  REAL,
  brake_slip_peak REAL,
  lat_slip_peak_offroad  REAL,
  friction_scale  REAL,
  wear_scale      REAL,
  data            TEXT
);

-- ---------------------------------------------------------------------------
-- The three "part facts" tables, imported 2026-09-03 by scripts/db/import_parts_extra.py.
-- Each one was expected to answer a question the lab had been solving empirically. Read the
-- comments before reaching for them: two of the three answer a DIFFERENT question than the
-- one their name suggests, and that is the whole value of importing them.
-- ---------------------------------------------------------------------------

-- List_PartAttribute, verbatim. 546 rows, PartAttributeID dense 1..546.
--
-- It does NOT carry per-part PI. Its only measures are Price, Mass, DragScale and
-- WindInstabilityScale; there is no PI column here or anywhere else per part (the game DB
-- names PI in exactly three places, all whole-car: Data_Car.PerformanceIndex, Data_Car.PI and
-- CarClasses.Max*PerformanceIndex). DragScale and WindInstabilityScale are 1.0 in all 546 rows,
-- so they carry no information at all, and Price takes only two values, 0 and 5000.
--
-- It also cannot be keyed to ref_part: NO column in any of the game DB's 205 tables references
-- PartAttributeID (a full scan for an integer column with >=300 distinct values inside 1..546
-- returns nothing), and the PartAttributeID-ordered ManufacturerID sequence does not appear as a
-- sub-sequence of any manufacturer column in the database. slot/part_id are therefore always
-- NULL and join_status is always 'orphan'; the columns exist so a future key can be filled in
-- place rather than by a migration.
--
-- What it looks like, on evidence: an engine table. Its column set is List_UpgradeEngine's
-- (ManufacturerID, Price, MassDiff, DragScale, WindInstabilityScale) with the mass made
-- ABSOLUTE, and 438 of its 546 masses equal some Data_Engine.[EngineMass-kg] exactly (control:
-- 1 of 546 against List_UpgradeCarBodyWeight.Mass). Its ManufacturerID is a dense 1..53 enum
-- that is NOT List_PartManufacturer (739 rows, sparse, range 1..835) -- 7 of its 52 values do
-- not exist there at all -- so it is a legacy id space. Treat this table as superseded data.
CREATE TABLE IF NOT EXISTS ref_part_attribute (
  attribute_id    INTEGER PRIMARY KEY,   -- List_PartAttribute.PartAttributeID
  manufacturer_id INTEGER,               -- dense 1..53 legacy enum, NOT List_PartManufacturer
  price           INTEGER,               -- 0 or 5000, nothing else
  mass_kg         REAL,                  -- ABSOLUTE mass, not a diff
  drag_scale      REAL,                  -- 1.0 in every row
  wind_scale      REAL,                  -- 1.0 in every row
  mass_is_engine  INTEGER DEFAULT 0,     -- mass_kg equals some Data_Engine.[EngineMass-kg]
  slot            TEXT,                  -- always NULL: nothing references PartAttributeID
  part_id         INTEGER,               -- always NULL
  join_status     TEXT NOT NULL DEFAULT 'orphan',
  FOREIGN KEY (slot, part_id) REFERENCES ref_part(slot, part_id)
);

-- UpgradePresetPackages: the game's OWN finished builds, one row per preset.
-- 448 presets over 258 cars, every Ordinal joining ref_car. Each carries a complete 49-slot
-- part list (ref_preset_part) and a 46-float tuning blob = the 36 ref_slider values in
-- slot_index order followed by 10 gear-ratio slots, -1.0 where the gear does not exist.
-- This is the lab's only source of author-intended reference builds to compare a user build to.
CREATE TABLE IF NOT EXISTS ref_preset (
  preset_id     INTEGER PRIMARY KEY,     -- UpgradePresetPackages.Id
  ordinal       INTEGER REFERENCES ref_car(ordinal),
  title         TEXT,                    -- resolved through ref_string
  description   TEXT,
  kind          TEXT,                    -- forza | offroad | race | drift … read off the thumbnail
  thumbnail     TEXT,
  purchasable   INTEGER,
  release_order INTEGER,
  n_parts       INTEGER,                 -- non-zero slot values on this preset
  n_parts_joined INTEGER,                -- of those, how many hit ref_part
  n_gears       INTEGER,                 -- gear slots that are not -1.0
  tuning_hex    TEXT,                    -- the raw Tuning blob, unmodified
  tuning        TEXT                     -- JSON {"sliders":{name:norm}, "gears":[…]}
);
CREATE INDEX IF NOT EXISTS ix_preset_ordinal ON ref_preset(ordinal);

CREATE TABLE IF NOT EXISTS ref_preset_part (
  preset_id  INTEGER NOT NULL REFERENCES ref_preset(preset_id),
  slot       TEXT NOT NULL REFERENCES ref_slot(slot),
  part_id    INTEGER NOT NULL,
  name       TEXT,                       -- ref_part.name when the pair joins
  joined     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (preset_id, slot)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS ix_preset_part ON ref_preset_part(slot, part_id);

-- CarExceptions, verbatim. 511 cars, every CarID joining ref_car.
--
-- NAME WARNING: these are not upgrade-rule exceptions. All eight flags are LIVERY and GRAPHICS
-- exceptions -- whether a car has mirrors or windows to paint, and whether the stock or
-- aftermarket hood and wing accept paint or decals. NONE of the gating the lab infers is stated
-- here: there is no aspiration->engine-tier gate (ui-spec 9.1) and no body-kit->front-bumper
-- removal (ui-spec 10.7) in this table, nor any column that could express one.
CREATE TABLE IF NOT EXISTS ref_car_exception (
  ordinal                       INTEGER PRIMARY KEY REFERENCES ref_car(ordinal),
  no_mirrors                    INTEGER,
  no_windows                    INTEGER,
  no_hood_stock                 INTEGER,
  no_hood_aftermarket           INTEGER,
  no_paintable_wing_stock       INTEGER,
  no_paintable_wing_aftermarket INTEGER,
  no_decals_wing_stock          INTEGER,
  no_decals_wing_aftermarket    INTEGER,
  n_flags                       INTEGER  -- how many of the eight are set
);

CREATE TABLE IF NOT EXISTS ref_track (
  track_id      INTEGER PRIMARY KEY,
  name          TEXT,
  media_name    TEXT,
  length_m      REAL,
  is_reverse    INTEGER,
  is_real_world INTEGER,
  data          TEXT
);

-- The game's events AS DISPLAYED. Filled by stage `events` (scripts/db/import_events.py) from
-- data/rivals-routes-*.json -- the Rivals > Routes screen transcribed: verbatim name, the screen's
-- "Route Length" (one decimal, miles) and the IDS_Name guids the name sits under. The event
-- definitions themselves (route id, class/PI limit) are NOT in the 205-table game DB (audit
-- 2026-09-03), so route_id/class_limit/pi_limit stay NULL until an event dataset is decoded.
-- length_m is the naming KEY: see the COURSE NAMES block below.
CREATE TABLE IF NOT EXISTS ref_event (
  event_id      TEXT PRIMARY KEY,        -- 'rivals:<slug>' (slug = lowercase name, non-alnum -> '-'); a guid once the event datasets decode
  kind          TEXT,                    -- rivals | career | drift_zone | speed_trap | danger_sign | trailblazer …
  name          TEXT,                    -- verbatim game string; CHECKED against ref_string through ref_event_string, never typed
  track_id      INTEGER REFERENCES ref_track(track_id),
  route_id      TEXT,                    -- the game's own route id, only when an event dataset says so; the DERIVED link lives on ref_route.event_id
  class_limit   TEXT,
  pi_limit      INTEGER,
  region        TEXT,
  data          TEXT,                    -- JSON {order, length_mi, description, frames}
  discipline    TEXT,                    -- 'road' for data/rivals-routes-road.json; NULL = not asserted (never inferred from the name)
  length_m      REAL,                    -- length_mi * 1609.344; precision +/-80 m BY CONSTRUCTION (one decimal on screen); one lap for circuits (4 anchors, not stated by the game)
  is_loop       INTEGER,                 -- 1 '* Circuit' / The Colossus / The Goliath, 0 '* Sprint', NULL otherwise -- the only topology the screen gives
  source        TEXT                     -- 'data/rivals-routes-road.json#<order>'
);
CREATE INDEX IF NOT EXISTS ix_event_kind ON ref_event(kind, name);

-- The 7 IDS_Name guids per Rivals route, as a checked join to the game's own string rows -- the
-- JSON note "names verified verbatim against RivalsEventData" becomes a foreign key re-proven on
-- every rebuild (stage `events` FAILS when a guid is absent or its content differs from name).
CREATE TABLE IF NOT EXISTS ref_event_string (
  event_id    TEXT NOT NULL REFERENCES ref_event(event_id) ON DELETE CASCADE,
  table_name  TEXT NOT NULL,             -- 'RivalsEventData'
  key_hash    INTEGER NOT NULL,          -- ref_string.key_hash of 'IDS_Name_<guid32>'
  key_name    TEXT NOT NULL,             -- 'IDS_Name_367ed32633194085b6c2ed2abb264c71'
  role        TEXT NOT NULL,             -- name | description
  PRIMARY KEY (event_id, table_name, key_hash),
  FOREIGN KEY (table_name, key_hash) REFERENCES ref_string(table_name, key_hash)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS ref_region (
  region_id     INTEGER PRIMARY KEY,
  name          TEXT,
  map_x         REAL,
  map_y         REAL
);

-- ============================================================================
-- SAVE LAYER — one row per container, per slot, per slider. Names already resolved.
-- ============================================================================

CREATE TABLE IF NOT EXISTS tune_container (
  container     TEXT PRIMARY KEY,        -- 'Tuning_0412_20260901181414' — the folder name
  ordinal       INTEGER NOT NULL REFERENCES ref_car(ordinal),
  saved_utc     TEXT NOT NULL,           -- parsed from the folder stamp (UTC)
  tune_name     TEXT,                    -- the UTF-16 name in the header sibling
    description     TEXT,               -- the header's description, when the author wrote one
    creator         TEXT,               -- the author's gamertag (you, for your own saves)
    creator_xuid    INTEGER,
    created_utc     TEXT,               -- own saves: the save moment; downloaded: the author's creation
  locked        INTEGER NOT NULL DEFAULT 0,
  source        TEXT NOT NULL,           -- downloaded | self
  hw_hash       TEXT NOT NULL,           -- ordinal + 100 part slots
  setup_hash    TEXT NOT NULL,           -- hw + sliders + gears
  tune_hash     TEXT,
  parts_hash    TEXT,
  engine_id     INTEGER,                 -- resolved from the engine slot
  drivetrain_id INTEGER,
  carbody_id    INTEGER,
  motor_id      INTEGER,
  body_variant  INTEGER,
  pi            INTEGER,                 -- computed at import from the class map when derivable
  class         TEXT,
  n_parts       INTEGER,                 -- populated slots
  gear_count    INTEGER,
  -- THE MASS LEDGER. The build's weight is not a screenshot: it is
  -- List_UpgradeCarBodyWeight.Mass for the fitted weight-reduction part plus the MassDiff of every
  -- other fitted part plus the engine-swap delta. Reproduced the NSX-R build pane to -1.4% and its
  -- 45% front split exactly. Stored here so no consumer sums 50 rows on every read.
  mass_kg       REAL,
  front_pct     REAL,
  file_path     TEXT,
  file_mtime    REAL,
  imported_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_container_car ON tune_container(ordinal, saved_utc);
CREATE INDEX IF NOT EXISTS ix_container_hw  ON tune_container(hw_hash);

CREATE TABLE IF NOT EXISTS tune_part (
  container     TEXT NOT NULL REFERENCES tune_container(container) ON DELETE CASCADE,
  slot_index    INTEGER NOT NULL,
  slot          TEXT NOT NULL REFERENCES ref_slot(slot),
  part_id       INTEGER,                 -- NULL = empty slot (never 0)
  name          TEXT,                    -- resolved at import — the dashboard prints this column
  level         INTEGER,
  tile          INTEGER,
  tile_count    INTEGER,
  menu_path     TEXT,                    -- 'Upgrade Shop > Tires and Rims > Rim Style'
  is_stock      INTEGER,
  price         INTEGER,
  mass_diff_kg  REAL,
  confidence    TEXT,
  PRIMARY KEY (container, slot_index)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS ix_tunepart_part ON tune_part(slot, part_id);

CREATE TABLE IF NOT EXISTS tune_slider (
  container       TEXT NOT NULL REFERENCES tune_container(container) ON DELETE CASCADE,
  slider          TEXT NOT NULL REFERENCES ref_slider(slider),
  norm            REAL NOT NULL,         -- the raw F32 in the save, 0..1
  value           REAL,                  -- the physical number the Tuning screen shows
  unit            TEXT,
  min_value       REAL,                  -- the band this container's fitted part supplies
  max_value       REAL,
  locked          INTEGER DEFAULT 0,
  is_install_default INTEGER,            -- norm == the part's def_norm within 0.005
  source_slot     TEXT,                  -- which fitted part supplied the band
  source_part_id  INTEGER,
  PRIMARY KEY (container, slider)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS tune_gear (
  container   TEXT NOT NULL REFERENCES tune_container(container) ON DELETE CASCADE,
  gear        INTEGER NOT NULL,          -- 0 = final drive, 1..10 = forward gears
  ratio       REAL NOT NULL,
  PRIMARY KEY (container, gear)
) WITHOUT ROWID;

-- ============================================================================
-- HARDWARE PACKAGE TIER — Car › Hardware package › Tune
-- ============================================================================

CREATE TABLE IF NOT EXISTS hw_package (
  hw_hash       TEXT PRIMARY KEY,
  ordinal       INTEGER NOT NULL REFERENCES ref_car(ordinal),
  label         TEXT,                    -- a name the user gives the package
  pi            INTEGER,
  class         TEXT,
  engine_id     INTEGER,
  drivetrain_id INTEGER,
  carbody_id    INTEGER,
  n_containers  INTEGER,
  first_seen_utc TEXT,
  last_seen_utc  TEXT,
  intent        TEXT                     -- course | general | drift | drag — the tuning lane
);

CREATE TABLE IF NOT EXISTS hw_package_part (
  hw_hash    TEXT NOT NULL REFERENCES hw_package(hw_hash) ON DELETE CASCADE,
  slot_index INTEGER NOT NULL,
  slot       TEXT NOT NULL,
  part_id    INTEGER,
  name       TEXT,
  PRIMARY KEY (hw_hash, slot_index)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS setup (
  setup_hash    TEXT PRIMARY KEY,
  hw_hash       TEXT NOT NULL REFERENCES hw_package(hw_hash),
  ordinal       INTEGER NOT NULL,
  label         TEXT,
  n_containers  INTEGER,
  first_seen_utc TEXT
);

-- ============================================================================
-- TELEMETRY
-- ============================================================================

CREATE TABLE IF NOT EXISTS session (
  session_id   TEXT PRIMARY KEY,         -- fh6_20260902_005318
  started_utc  TEXT,
  duration_s   REAL,
  frames       INTEGER,
  rate_pps     REAL,
  source       TEXT,
  file_path    TEXT,
  imported_at  TEXT,
  summary      TEXT                      -- JSON
);

CREATE TABLE IF NOT EXISTS session_car (
  session_id  TEXT NOT NULL REFERENCES session(session_id) ON DELETE CASCADE,
  cid         TEXT NOT NULL,             -- ordinal|drivetrain|cyl|PI
  ordinal     INTEGER,
  build_id    TEXT,
  hw_hash     TEXT,                      -- bound to a package when the save is identified
  name        TEXT, class TEXT, pi INTEGER, drivetrain TEXT, cyl INTEGER,
  live_s      REAL,
  PRIMARY KEY (session_id, cid)
) WITHOUT ROWID;

-- ANCHORS (2026-09-05): the analyzer's per-session event list (data/sessions/*.json `events`),
-- one row per race / timed run / reference-loop pass, with WHERE it started and ended. The start
-- position is what stage course_match tests against route_anchor. Written by stage telemetry.
CREATE TABLE IF NOT EXISTS session_event (
  session_id  TEXT NOT NULL REFERENCES session(session_id) ON DELETE CASCADE,
  i           INTEGER NOT NULL,         -- position in the session's events list
  t0          REAL, t1 REAL,
  cid         TEXT,                     -- ordinal|drivetrain|cyl|PI
  mode        TEXT,                     -- race | timed solo (Rivals / time trial) | reference loop ...
  solo        INTEGER,
  laps        INTEGER,
  distance_m  REAL,
  duration_s  REAL,
  start_x     REAL, start_z REAL,       -- the start LINE where a lap completed, else the window start (analyzer rule)
  end_x       REAL, end_z REAL,
  route_key   TEXT,                     -- the course the analyzer attributed the event to (not an FK: courses are keyed later)
  start_is_line INTEGER,                -- 1 = start is a detected lap-boundary crossing; 0 = only where the capture window opened; NULL = older session file
  PRIMARY KEY (session_id, i)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS course (
  route_key    TEXT PRIMARY KEY,         -- '-1700_-4450' — the start-cell key
  name         TEXT,                     -- RESOLVED by stage route_names (declared wins; else the derived event's name); see COURSE NAMES below. Never written from a JSON file except as a placeholder by telemetry.
  is_rivals    INTEGER DEFAULT 0,        -- the player's DECLARED game mode (routes.json 'rivals'), not the route's identity
  event_id     TEXT REFERENCES ref_event(event_id),   -- written by route_names; NULL while unresolved or on conflict
  length_m     REAL,
  -- COURSE NAMES (added 2026-09-05): the INPUT a person typed, kept apart from the OUTPUT the rule derives
  declared_name    TEXT,                 -- what data/routes.json (first) or the course model says; written by telemetry; never derived
  declared_source  TEXT,                 -- routes.json 'source' ('dashboard 2026-09-02') | 'course model'
  name_source      TEXT,                 -- declared | derived:game (the catalogue named the identified route, 2026-09-05) | derived:map | derived:map+declared | derived:length | derived:length+declared
  name_confidence  TEXT,                 -- verified | derived | read   (the schema's confidence vocabulary)
  turn_count   INTEGER,
  n_laps       INTEGER,
  n_sessions   INTEGER,
  confidence   REAL,
  updated_utc  TEXT,
  geometry     TEXT,                     -- JSON polyline + turn geometry
  profile      TEXT                      -- JSON shape profile
);

CREATE TABLE IF NOT EXISTS course_turn (
  route_key   TEXT NOT NULL REFERENCES course(route_key) ON DELETE CASCADE,
  turn_id     TEXT NOT NULL,             -- canonical id: T3, T7 … (NOT a positional index)
  seq         INTEGER,                   -- arc order
  arc_m       REAL,
  apex_x      REAL, apex_z REAL,
  radius_m    REAL,
  angle_deg   REAL,
  kind        TEXT,                      -- hairpin | sweeper | kink | chicane
  n_obs       INTEGER,
  PRIMARY KEY (route_key, turn_id)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS lap (
  lap_id      INTEGER PRIMARY KEY,
  route_key   TEXT NOT NULL REFERENCES course(route_key) ON DELETE CASCADE,
  session_id  TEXT REFERENCES session(session_id),
  cid         TEXT,
  container   TEXT,                      -- the setup driven, when known
  hw_hash     TEXT,
  t0          REAL NOT NULL,
  lap_s       REAL,
  arc_m       REAL,
  coverage    REAL,                      -- arc_m / course length — < 0.9 is a fragment, not a lap
  is_partial  INTEGER DEFAULT 0,
  build_id    TEXT, class TEXT, pi INTEGER, drivetrain TEXT, tune_hash TEXT,
  solo        INTEGER DEFAULT 0,       -- session-adjusted: downgraded to 0 if the session also held a race (for voiding); DO NOT use for mode grouping
  is_race     INTEGER,                 -- RAW per-event verdict (2026-09-17): 1 = definite race (RacePosition varied/>1), 0 = solo/timed (Rivals), NULL = unknown. THIS is the mode flag for Rivals-only filtering, not `solo`.
  impacts     INTEGER DEFAULT 0,
  void        INTEGER DEFAULT 0,
  -- THE GAME'S LAP METADATA IS CANON (2026-09-06): a lap is what the game timed. Rows a rewind revoked
  -- are gone from the trace; a menu pause is a marker, not a break; a lap the 192 MB roll cut is stitched.
  lap_dist_m  REAL,                      -- the game's odometer over the lap, beside the point arc
  rewinds     INTEGER DEFAULT 0,
  pauses      INTEGER DEFAULT 0,
  pause_s     REAL DEFAULT 0,
  stitched    INTEGER DEFAULT 0,
  -- OFFICIAL = the game published this lap's time (LastLap), so lap_s IS the game's own number, not our
  -- race-clock span (2026-09-18). A rewind breaks the span but not the published time, so a rewound lap
  -- with official = 1 is a real, comparable lap; one with official = 0 has no trustworthy time at all.
  official    INTEGER DEFAULT 0,
  UNIQUE (route_key, session_id, cid, t0)
);

-- what happened inside a lap that the trace no longer shows: a rewind (rows revoked), a pause (clock stopped)
CREATE TABLE IF NOT EXISTS lap_marker (
  lap_id   INTEGER NOT NULL REFERENCES lap(lap_id) ON DELETE CASCADE,
  i        INTEGER NOT NULL,
  kind     TEXT NOT NULL,                -- rewind | pause | gap
  t        REAL,                         -- seconds from the lap's start (wall clock)
  dur_s    REAL,                         -- pause: how long the clock stood still; rewind: race seconds undone
  race_s   REAL,                         -- the race clock at the marker
  dist_m   REAL,                         -- the odometer at the marker
  over_line INTEGER,                     -- rewind: 1 when it went back across the start/finish line
  detail   TEXT,                         -- JSON: the marker as the analyzer wrote it
  PRIMARY KEY (lap_id, i)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS ix_lap_course ON lap(route_key, class, void, is_partial, lap_s);

-- One row per sample. Storing the trace as rows (not a JSON blob) is what lets the
-- analyzer and the dashboard ask questions of it in SQL instead of parsing 300 arrays.
CREATE TABLE IF NOT EXISTS lap_point (
  lap_id   INTEGER NOT NULL REFERENCES lap(lap_id) ON DELETE CASCADE,
  i        INTEGER NOT NULL,
  arc_m    REAL NOT NULL,
  mph      REAL,
  dist_m   REAL,                         -- the game's odometer from the lap's first point (2026-09-06)
  grip     INTEGER,                      -- 0 calm, 1 front, 2 rear, 3 both, 4 impact
  x        REAL, z REAL,
  elev_m   REAL,
  thr      INTEGER,                      -- throttle 0-100 % at the point (schema 6, 2026-09-11)
  brk      INTEGER,                      -- brake 0-100 % at the point
  lat_g    REAL,                         -- peak |lateral g| surviving the 4 m resample (schema 7, 2026-09-12)
  PRIMARY KEY (lap_id, i)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS corner_obs (
  lap_id     INTEGER NOT NULL REFERENCES lap(lap_id) ON DELETE CASCADE,
  turn_id    TEXT NOT NULL,
  route_key  TEXT NOT NULL,
  entry_mph  REAL, apex_mph REAL, exit_mph REAL,
  min_mph    REAL,
  grip_state INTEGER,
  time_s     REAL,
  score      REAL,
  PRIMARY KEY (lap_id, turn_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS ix_corner_turn ON corner_obs(route_key, turn_id, apex_mph);

-- corner_obs cut finer: what each lap did in each of the 5 WHERE-phases of a turn (braking, turn-in,
-- mid, exit, straight), samples bucketed by projecting each onto the route's segment spans. This is
-- the "where in the corner did it happen" join -- e.g. time lost in braking vs a slow apex.
CREATE TABLE IF NOT EXISTS corner_segment (
  lap_id     INTEGER NOT NULL REFERENCES lap(lap_id) ON DELETE CASCADE,
  turn_id    TEXT NOT NULL,
  route_key  TEXT NOT NULL,
  segment    TEXT NOT NULL,           -- braking | turn_in | mid | exit | straight
  n_samples  INTEGER,
  entry_mph  REAL, exit_mph REAL, min_mph REAL, mean_mph REAL,
  grip_state INTEGER,                 -- TYPICAL (modal) grip state over the phase's samples, not the worst
  grip_hist  TEXT,                    -- JSON [calm,front,rear,both,impact] sample counts -> the true grip mix
  time_s     REAL,
  peak_lat_g REAL,                    -- peak |lateral g| in this phase for this lap (schema 7, 2026-09-12) -> grip-ceiling rating
  PRIMARY KEY (lap_id, turn_id, segment)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS ix_corner_segment ON corner_segment(route_key, turn_id, segment);

-- ============================================================================
-- OBSERVATION LAYER — what a person saw. Every row names its source.
-- ============================================================================

CREATE TABLE IF NOT EXISTS obs_pi (
  obs_id      INTEGER PRIMARY KEY,
  ordinal     INTEGER,
  container   TEXT,
  hw_hash     TEXT,
  slot        TEXT,
  part_id     INTEGER,
  pi_before   INTEGER,
  pi_after    INTEGER,
  delta       INTEGER,
  source      TEXT,                      -- screenshot | telemetry | preview
  observed_utc TEXT,
  note        TEXT
);

CREATE TABLE IF NOT EXISTS obs_menu (
  obs_id      INTEGER PRIMARY KEY,
  ordinal     INTEGER,
  slot        TEXT,
  tile        INTEGER,
  tile_count  INTEGER,
  name        TEXT,
  part_id     INTEGER,
  source      TEXT,                      -- the screenshot filename
  observed_utc TEXT
);

-- Free-form claims with provenance: the successor to the scattered "_note" keys in part-names.json.
CREATE TABLE IF NOT EXISTS obs_evidence (
  obs_id      INTEGER PRIMARY KEY,
  subject     TEXT NOT NULL,             -- 'rim_style' | 'slider:front_camber' | 'course:-1700_-4450'
  claim       TEXT NOT NULL,
  confidence  TEXT NOT NULL,
  source      TEXT,
  observed_utc TEXT,
  superseded_by INTEGER REFERENCES obs_evidence(obs_id)
);
CREATE INDEX IF NOT EXISTS ix_evidence_subject ON obs_evidence(subject, confidence);

-- ============================================================================
-- MATERIALIZED DELIVERABLES
-- ============================================================================

CREATE TABLE IF NOT EXISTS plan_clone (
  plan_id          INTEGER PRIMARY KEY,
  target_container TEXT NOT NULL REFERENCES tune_container(container) ON DELETE CASCADE,
  source_container TEXT,                 -- NULL = the replica is modelled as stock
  generated_utc    TEXT NOT NULL,
  n_steps          INTEGER,
  n_customize      INTEGER,
  n_unknown        INTEGER,
  verdict          TEXT                  -- CLONE EXACT | MATCH (rims differ) | DIFFER
);

CREATE TABLE IF NOT EXISTS plan_clone_step (
  plan_id     INTEGER NOT NULL REFERENCES plan_clone(plan_id) ON DELETE CASCADE,
  step_no     INTEGER NOT NULL,
  phase       TEXT,                      -- shop | customize | conversion
  slot        TEXT,
  menu_path   TEXT,
  part_id     INTEGER,
  name        TEXT,
  tile        INTEGER,
  tile_count  INTEGER,
  confidence  TEXT,
  note        TEXT,
  PRIMARY KEY (plan_id, step_no)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS plan_readiness (
  container   TEXT PRIMARY KEY REFERENCES tune_container(container) ON DELETE CASCADE,
  ready       INTEGER NOT NULL,
  n_unknown   INTEGER,
  n_derived   INTEGER,
  blockers    TEXT,                      -- JSON [{slot, part_id, why}]
  computed_utc TEXT
);

-- ============================================================================
-- VIEWS — the dashboard bundle is generated from these
-- ============================================================================

CREATE VIEW IF NOT EXISTS v_build_sheet AS
SELECT c.container, c.ordinal, r.full_name AS car, c.tune_name, c.locked, c.source,
       c.pi, c.class, c.hw_hash, c.setup_hash, c.saved_utc,
       p.slot, p.slot_index, p.part_id, p.name AS part, p.menu_path, p.confidence
FROM tune_container c
JOIN ref_car r ON r.ordinal = c.ordinal
JOIN tune_part p ON p.container = c.container
WHERE p.part_id IS NOT NULL;

CREATE VIEW IF NOT EXISTS v_tune_sheet AS
SELECT c.container, c.tune_name, s.slider, d.group_name, d.display_name,
       s.norm, s.value, s.unit, s.min_value, s.max_value, s.locked, s.is_install_default
FROM tune_container c
JOIN tune_slider s ON s.container = c.container
JOIN ref_slider  d ON d.slider = s.slider
ORDER BY c.container, d.slot_index;

-- Rims interchangeable with the one a container carries: same mass_level, per slot.
CREATE VIEW IF NOT EXISTS v_rim_equivalent AS
SELECT p.container, p.slot, p.part_id AS installed_id, w0.full_name AS installed,
       w1.wheel_id AS alt_id, w1.full_name AS alt, w1.category_id, w1.display_order
FROM tune_part p
JOIN ref_wheel w0 ON w0.wheel_id = p.part_id
JOIN ref_wheel w1 ON w1.mass_level = w0.mass_level AND w1.is_stock = 0
WHERE p.slot IN ('rim_style','rear_rim_style') AND p.part_id IS NOT NULL;

CREATE VIEW IF NOT EXISTS v_course_best AS
SELECT l.route_key, co.name AS course, l.class, l.cid, l.build_id, l.lap_id, l.lap_s, l.impacts,
       ROW_NUMBER() OVER (PARTITION BY l.route_key, l.class ORDER BY l.lap_s) AS rank
FROM lap l JOIN course co ON co.route_key = l.route_key
WHERE l.void = 0 AND l.is_partial = 0 AND l.lap_s IS NOT NULL;

-- ============================================================================
-- GAME ROUTES  (added 2026-09-02)
--
-- The game defines its routes as centre-lines under media/openworld/brio/aitracks, and those
-- coordinates are the SAME metre frame the telemetry reports -- verified by matching our learned
-- paths onto them at 2-4 m mean deviation, which is road width plus GPS noise. So the game can
-- say exactly where a track is, and our laps say exactly how fast it was driven. A course row
-- carries both: route_id is the game's identity, the lap_ tables are ours.
-- ============================================================================

CREATE TABLE IF NOT EXISTS ref_route (
  route_id    TEXT PRIMARY KEY,        -- '281' from Route281.owt
  name        TEXT,                    -- filled by stage route_names when a DRIVEN course identifies this route (course_route verified/probable) AND the Rivals catalogue length agrees within the screen's rounding; import_routes.py writes NULL and never anything else
  event_id         TEXT REFERENCES ref_event(event_id),   -- COURSE NAMES (2026-09-05): which catalogue row named this centre-line
  name_source      TEXT,                                  -- game:trackinfo (every catalogued route, driven or not) | derived:map | derived:map+declared
  name_confidence  TEXT,                                  -- verified | derived
  length_m    REAL,
  n_points    INTEGER,
  is_loop     INTEGER,
  bbox_x0     REAL, bbox_x1 REAL, bbox_z0 REAL, bbox_z1 REAL,
  source      TEXT,
  -- road surface rolled up over the whole centre-line; see ROAD SURFACE below for the source.
  -- surface is 'paved' / 'loose' when one class holds >= 80% of the points and 'mixed'
  -- otherwise, because a route that is 60% dirt is not a dirt route, it is a mixed one and the
  -- tune has to survive both halves.
  -- NOT A MATERIAL. This is the route's position in the free-roam ROAD NETWORK, collapsed
  -- to on-network (paved) vs off-network (loose). Two adversarial passes confirmed the
  -- layer is spatially sound -- 0.17% contradiction across 49,734 cells shared by two or
  -- more routes -- and refuted the claim that it names a surface. The game's own
  -- vocabulary (media/physics/NatalSurfaceTypes.xml) has 58 named surfaces including
  -- gravel, sand, snow and cobblestone; nothing here distinguishes them. Use it to pick
  -- road versus offroad tyres, never to claim a car is on asphalt.
  road_class    TEXT,                  -- paved | loose | mixed | NULL
  pct_loose     REAL,                  -- fraction of classified points that are dirt or trail
  road_class_known REAL,                  -- fraction of points that got any class at all
  road_class_mix   TEXT,                  -- JSON {road_type: fraction}, ordered by size
  -- ANCHORS (2026-09-05): 1 when the game ships a race-activation sphere for this id (36 of 169);
  -- the other 133 are free-roam ribbons no race starts on. Written by stage anchors.
  is_race       INTEGER
);

CREATE TABLE IF NOT EXISTS ref_route_point (
  route_id    TEXT NOT NULL REFERENCES ref_route(route_id) ON DELETE CASCADE,
  i           INTEGER NOT NULL,
  x           REAL NOT NULL,
  y           REAL,                    -- elevation
  z           REAL NOT NULL,
  PRIMARY KEY (route_id, i)
) WITHOUT ROWID;


-- ============================================================================
-- THE GAME'S EVENT CATALOGUE (added 2026-09-05) -- where a NAME meets a ROUTE ID.
-- Source: media/ObjectModelGame.zip, five BXML documents (stage objectmodel, scripts/db/
-- import_objectmodel.py, reader scripts/telemetry/fh6_bxml.py). The string tables only ever
-- carried GUID -> text; these rows carry GUID -> route. Chain for a Rivals name:
--   ref_rivals_event.collection_key -> ref_career_race.collection_key -> ref_career_race.track_key
--   -> ref_track_info.route_id (= Route<id>.owt = ref_route.route_id)      -- 88/88 unique
-- ref_route.name is set from ref_track_info.display_name by stage route_names (tier game,
-- name_source 'game:trackinfo', confidence verified); the map/length derivations stay as the
-- cross-check that the driven course really is that road.
-- ============================================================================

CREATE TABLE IF NOT EXISTS ref_track_info (
  track_key       INTEGER PRIMARY KEY,     -- TrackInfoDataSet key; CareerRace.Track.Key
  route_id        TEXT,                    -- Route<id>.owt id; not an FK: 11 rows name playground/cut ids we have no file for
  custom_route_id TEXT,
  ribbon          TEXT,                    -- Circuit | P2P | Playground
  display_name    TEXT NOT NULL,           -- CareerTrackInfo.IDS_DisplayName_<guid>, resolved
  short_name      TEXT,
  description     TEXT,
  name_key        TEXT NOT NULL,           -- the IDS_DisplayName key it resolved through (checked join)
  use_cross_country_ai INTEGER,
  blueprint_only  INTEGER,
  activation_zone TEXT,
  media_track     TEXT,                    -- Brio
  pi_sort         INTEGER
);

CREATE TABLE IF NOT EXISTS ref_race_collection (
  collection_key  INTEGER PRIMARY KEY,
  name            TEXT NOT NULL,           -- CareerRaceCollection.IDS_Name_<guid>, resolved
  description     TEXT,
  collection_type TEXT,                    -- Exhibition | Championship | TeamInfected | TeamKing | FlagRush
  restriction_id  TEXT,                    -- ref_car_restriction
  forced_restriction_id TEXT,
  solo INTEGER, coop INTEGER, pvp INTEGER,
  recommended_cars TEXT                    -- JSON list of ordinals
);

CREATE TABLE IF NOT EXISTS ref_career_race (
  race_key        INTEGER PRIMARY KEY,
  name            TEXT NOT NULL,           -- CareerRace.IDS_Name_<guid>, resolved
  event_type      TEXT,                    -- Campaign | Showcase | Street
  track_key       INTEGER NOT NULL REFERENCES ref_track_info(track_key),
  collection_key  INTEGER NOT NULL REFERENCES ref_race_collection(collection_key),
  race_mode       TEXT,                    -- LapsRace | P2P | StreetRace | Scramble | TrailRace | CrossCountry | ... | Drag | Touge
  discipline      TEXT,                    -- road | street | drag | dirt | cross-country | showcase | rush | playground
  num_laps        INTEGER,
  n_ai            INTEGER,
  is_timed INTEGER, has_traffic INTEGER, rivals_enabled INTEGER, teams INTEGER,
  ui_theme        TEXT,
  entity_name     TEXT,
  progression_thread TEXT
);

CREATE TABLE IF NOT EXISTS ref_rivals_event (
  rivals_key      INTEGER PRIMARY KEY,     -- RivalsEventDataMap key
  name            TEXT NOT NULL,           -- RivalsEventData.IDS_Name_<guid>, resolved: 88 names x 7 classes
  description     TEXT,
  leaderboard_id  TEXT,
  collection_key  INTEGER NOT NULL REFERENCES ref_race_collection(collection_key),
  restriction_id  TEXT,                    -- ref_car_restriction: the class bucket of this variant
  class_id        INTEGER,                 -- ref_class.class_id, from the restriction
  is_class_based  INTEGER,
  sort_index      INTEGER,
  name_key        TEXT NOT NULL,
  forced_car      TEXT,
  weather_preset  TEXT
);

CREATE TABLE IF NOT EXISTS ref_car_restriction (
  restriction_id  TEXT PRIMARY KEY,        -- CarRestrictionMap key (guid)
  car_class_id INTEGER, car_bucket_id INTEGER,
  pi_min INTEGER, pi_max INTEGER, power_min INTEGER, power_max INTEGER,
  weight_min INTEGER, weight_max INTEGER, year_min INTEGER, year_max INTEGER,
  tagline TEXT, description TEXT,
  data            TEXT                     -- JSON: every other comparator/id field
);

-- one row per Rivals variant with the route it resolves to (the chain above, flattened)
CREATE VIEW IF NOT EXISTS v_rivals_route AS
  SELECT DISTINCT rv.rivals_key, rv.name, rv.class_id, rv.leaderboard_id, cr.race_key, cr.race_mode,
         cr.discipline, cr.num_laps, ti.track_key, ti.route_id, ti.ribbon, ti.display_name
    FROM ref_rivals_event rv
    JOIN ref_career_race cr ON cr.collection_key = rv.collection_key
    JOIN ref_track_info ti ON ti.track_key = cr.track_key;

-- ANCHORS (2026-09-05): the game's race-activation spheres, from
-- media/tracks/brio/triggerzones/tz_race_activations/race_triggers.tz (plaintext XML, shipped).
-- One sphere per race route, named race_trigger_zone_rt<route_id>, radius 100 m, in the telemetry
-- metre frame. The ONLY populated route-id field in the game data. A session event that STARTS
-- inside a sphere began where that route's race begins -- an observation, not a shape match. It
-- corroborates course_route and breaks its ties (stage course_match); it never names a route.
-- Written by stage anchors (scripts/db/import_anchors.py), read by course_match and the analyzer.
CREATE TABLE IF NOT EXISTS route_anchor (
  route_id    TEXT PRIMARY KEY REFERENCES ref_route(route_id) ON DELETE CASCADE,
  x           REAL NOT NULL,
  y           REAL,
  z           REAL NOT NULL,
  radius_m    REAL NOT NULL,
  name        TEXT,                    -- race_trigger_zone_rt<N>
  source      TEXT                     -- race_triggers.tz
);

-- How a learned course maps onto a game route, WITH the evidence for the claim.
-- match_kind: verified (whole route, clearly best) | probable | partial (on it, drove some of
-- it) | none. 'partial' is a real answer: it says the lap records belong to a stretch of that
-- route, not to the route.
-- Written by stage course_match (DB-only, no game files) after telemetry and routes. It SURVIVES
-- a telemetry rerun because import_telemetry merges course rows (INSERT ... ON CONFLICT DO
-- UPDATE) and deletes only retired route_keys: DELETE FROM course and INSERT OR REPLACE both
-- fire ON DELETE CASCADE immediately (PRAGMA defer_foreign_keys defers checks, not actions) --
-- that is how this table sat at 0 rows from 2026-09-03 23:41 to 2026-09-05.
CREATE TABLE IF NOT EXISTS course_route (
  route_key    TEXT PRIMARY KEY REFERENCES course(route_key) ON DELETE CASCADE,
  route_id     TEXT REFERENCES ref_route(route_id),
  match_kind   TEXT NOT NULL,
  mean_dev_m   REAL,
  p95_dev_m    REAL,
  covered      REAL,                   -- fraction of the game route we have driven
  len_ratio    REAL,
  runner_up    TEXT,
  computed_utc TEXT,
  -- ANCHORS (2026-09-05): what the race-activation spheres say about this course, beside the
  -- geometry verdict. anchor_route_id = the sphere most of the course's session events started
  -- in; anchor_events = how many; anchor_agree = 1/0 whether it is the geometry's route (NULL when
  -- geometry had no verdict). A sphere promotes only with a strict majority of the course's events
  -- (>= 2 and more than half): a 'probable' whose anchor is its route or its runner_up becomes
  -- 'verified' with the anchor's route (the sphere broke the tie); a 'none' becomes 'anchored'
  -- with route_id STILL NULL -- the identity lives in anchor_route_id only, so corners, the
  -- dashboard's centre-line and naming, which all gate on route_id, keep treating it as unidentified.
  anchor_route_id TEXT REFERENCES ref_route(route_id),
  anchor_events   INTEGER,
  anchor_agree    INTEGER
);

-- ============================================================================
-- COURSE NAMES (added 2026-09-05) -- how a course and a centre-line get a NAME, with evidence.
-- Precedence since the catalogue landed the same night: declared > game > map > length (tier 'game'
-- rows carry the identified route and the catalogue's event; see THE GAME'S EVENT CATALOGUE above).
-- ============================================================================
-- The game never says which Rivals route a start cell is. Three sources exist and none is
-- sufficient alone:
--   * data/rivals-routes-road.json -- the Rivals > Routes screen (23 Road Racing routes): the
--     verbatim name and "Route Length" to one decimal in miles -> ref_event.length_m. The
--     screen ROUNDS, so the true length is within +/-0.05 mi (80.47 m) BY CONSTRUCTION. Three
--     pairs share a rounded length (Soni/Irokawa 1.2, Shimanoyama/Edamame 0.7, Venus/Coastline
--     5.0) and 22 of 23 lengths fit several .owt routes, so LENGTH ALONE NEVER NAMES ANYTHING.
--   * course_route -- the map identity (the map is the authority for WHERE).
--   * routes.json -- what a person typed (the final word; shown verbatim, never overwritten).
-- Stage route_names (scripts/db/import_route_names.py) derives a name only where the map
-- identity AND the catalogue length AND our measured lap length agree; a tie is broken only by
-- the typed name; sprints (point-to-point) are never named by length; every candidate it
-- considered is a course_event row, so an ambiguity is a fact, not a silence. Constants:
--   BAND_M      = 0.05 mi = 80.47 m  (half a display step -- the screen rounds: 23.379 -> 23.4)
--   LOOP_GAP_M  = 60                 (fh6_owt's own is_loop rule, reused)
-- Surface is a key too: a Road/Street/Drag event needs a route whose road_class is paved, a
-- Dirt/Cross Country event one that is mixed or loose (the class is network membership, not a
-- material). One event is one place: an event claimed by courses on non-overlapping routes is a
-- tie unless the typed name settles it (event_claims in the route_names run notes).
-- Every candidate the rule considered, with its evidence. chosen=1 on the row that named the
-- course. Two chosen=0 rows of one tier IS a tie; a map-tier row and a length-tier row for
-- different events IS a conflict. Nothing is resolved by guess.
CREATE TABLE IF NOT EXISTS course_event (
  route_key    TEXT NOT NULL REFERENCES course(route_key) ON DELETE CASCADE,
  event_id     TEXT NOT NULL REFERENCES ref_event(event_id) ON DELETE CASCADE,
  tier         TEXT NOT NULL,             -- map | length | declared
  route_id     TEXT REFERENCES ref_route(route_id),  -- the course_route identity used (tier map)
  d_route_m    REAL,                      -- ref_route.length_m - ref_event.length_m
  d_course_m   REAL,                      -- course.length_m   - ref_event.length_m
  loop_ok      INTEGER,                   -- event.is_loop agrees with ref_route.is_loop (map) / our path closure (length); NULL unknown
  road_ok      INTEGER,                   -- ref_route.road_class <> 'loose'; NULL when road_class is NULL
  declared_ok  INTEGER,                   -- course.declared_name == ref_event.name
  chosen       INTEGER NOT NULL DEFAULT 0,
  computed_utc TEXT NOT NULL,
  PRIMARY KEY (route_key, event_id)
) WITHOUT ROWID;

-- Turns derived from the game's centre-line curvature, not from driven laps (added 2026-09-02).
--
-- course_turn holds what the ANALYZER established from telemetry: real, but a property of the
-- driving, so the list grows and shifts as laps accumulate and a corner nobody took is not a
-- corner. This table holds what the ROAD is: the same turns, in the same order, for the same
-- route, whoever drives it and whether they drive it at all.
--
-- radius_m is the sweep radius (arc length / swept angle), not the peak-curvature radius, which
-- a single noisy sample can drive to absurd values. peak_radius_m keeps the tighter reading.
-- width_m and bank_deg come from the centre-line's own lateral vector and surface normal, and
-- are measurements telemetry cannot make at all.
CREATE TABLE IF NOT EXISTS ref_route_turn (
  route_id      TEXT NOT NULL REFERENCES ref_route(route_id) ON DELETE CASCADE,
  turn_id       TEXT NOT NULL,           -- T1.. in arc order along the route
  seq           INTEGER NOT NULL,
  arc_m         REAL,                    -- where the turn starts
  apex_arc_m    REAL,                    -- where curvature peaks
  apex_x        REAL, apex_y REAL, apex_z REAL,
  radius_m      REAL,
  peak_radius_m REAL,
  angle_deg     REAL,
  dir           TEXT,                    -- L or R
  kind          TEXT,                    -- hairpin | tight | medium | fast | sweeper
  length_m      REAL,
  width_m       REAL,                    -- road width at the apex
  bank_deg      REAL,                    -- surface tilt off horizontal at the apex
  segments      TEXT,                    -- JSON: the 5 WHERE-phases {braking,turn_in,mid,exit,straight}, each [arc0,arc1]
  -- what the road AT this turn is made of. Read at the turn's own apex point, which is one of
  -- the .owt centre-line points the turn was derived from, so there is no spatial guess in the
  -- along-route direction. See the ROAD SURFACE block below.
  road_class    TEXT,                    -- paved | loose | NULL
  road_type     TEXT,                    -- a | b | freeway | dirt | trail | hidden | shortcut
  road_profile  TEXT,                    -- authored material, e.g. a_gravel, ld_overpass_tarmac
  offroad       INTEGER,                 -- 0 | 1, NatalSurfaceTypes OffRoadness of the class
  surface_src   TEXT,                    -- nav (named string) | owt_code (per-point code)
  surface_m     REAL,                    -- metres from the apex to the nav node it was read at
  PRIMARY KEY (route_id, turn_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS ix_route_turn ON ref_route_turn(route_id, seq);

-- ============================================================================
-- ROAD SURFACE  (added 2026-09-02)
--
-- Radius, width and banking said what a corner is SHAPED like. This says what it is MADE of,
-- and that is the input that decides which tyre compound is legal and whether a grip-side
-- slider recommendation applies at all: NatalSurfaceTypes.xml gives every surface an
-- OffRoadness of 0 or 1, and all 41 rows of List_TireCompound carry a separate friction bank
-- for each. Advice given without it is advice for a road we have not checked is a road.
--
-- SOURCE (primary), granularity PER SPLINE, i.e. per road segment, ~20 m between nodes:
--   media/openworld/brio/freeroam/Brio_00.nav -- the free-roam road graph, 38,473 nodes over
--   1,532 splines. Every spline carries a `road_type` attribute whose VALUE IS A STRING IN THE
--   FILE'S OWN BLOB: a, b, freeway, dirt, trail, hidden, shortcut, evolving_world. Nothing is
--   inferred to read it. `spline_profile` adds the authored material on 864 splines
--   (a_gravel, ld_a_dirt_road, ld_overpass_tarmac, urban_*, skislope_a1/b1/c1, dragstrip_*).
--   'evolving_world' is a road that changes with the world's weekly state, not a surface; its
--   6 splines carry the real class in evolving_world_road_type and the reader follows that.
--
-- SOURCE (secondary), granularity PER POINT, exact, no spatial match:
--   Route<id>.owt record bytes 44..51 -- four u16, previously logged as unexplained floats
--   [11] and [12]. The low u16 is a world-space road-class code. Cross-tabbed against the nav
--   road_type over 56,838 sampled centre-line points it agrees at 0.993 (0x0110 dirt), 0.997
--   (0x0111 dirt), 0.998 (0x0020 trail), 0.981 (0x00E2 evolving_world), and 0x0000/0x0001 are
--   96%/98% paved. It is used where the free-roam graph does not reach -- closed circuits,
--   airfields, interiors -- which is 389 of 3,811 turns.
--
-- surface is the tuning-decisive two-way split, and it is not a vocabulary judgement: the
-- classes were ordered by three independent measurements that all agree. Median centre-line
-- roughness |y[i-1]-2y[i]+y[i+1]| runs freeway 0.13 mm < shortcut 0.46 < a 1.22 < hidden 1.40
-- < b 1.85 << trail 3.14 < dirt 4.52; median node width runs freeway 14 m > a 12 > b 10 >
-- dirt 9 > trail 5; and the authored profile names say tarmac on the first group and
-- gravel/dirt/skislope on the second.
--   surface  'paved' (a, b, freeway, hidden, shortcut) | 'loose' (dirt, trail) | NULL unknown
--   offroad  0 | 1, the NatalSurfaceTypes OffRoadness of that class, so it joins the
--            compound tables without a lookup
-- ============================================================================

-- Per centre-line point, on exactly the index set of ref_route_point (even i), so the two
-- join 1:1. Consecutive rows are usually identical -- surface comes in long runs -- which is
-- the point: this table is where a route's dirt SECTION becomes queryable.
CREATE TABLE IF NOT EXISTS ref_route_surface (
  route_id     TEXT NOT NULL REFERENCES ref_route(route_id) ON DELETE CASCADE,
  i            INTEGER NOT NULL,
  road_class   TEXT,                    -- paved | loose | NULL
  road_type    TEXT,                    -- the game's own word: a|b|freeway|dirt|trail|...
  road_profile TEXT,                    -- spline_profile, the authored material; NULL on 44%
  offroad      INTEGER,                 -- NatalSurfaceTypes OffRoadness of the class
  code         INTEGER,                 -- .owt bytes 44..45, bit 15 masked off
  nav_m        REAL,                    -- distance to the nav node this was read from
  src          TEXT NOT NULL,           -- nav | owt_code
  PRIMARY KEY (route_id, i)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS ix_route_surface ON ref_route_surface(route_id, road_class);

-- ============================================================================
-- DIAGNOSIS  (added 2026-09-02)
--
-- The failure catalogue and the detectors both already existed; nothing here is new science.
-- The v1 tuning tab carries a symptom -> fix matrix, and the analyzer already emits bottoming,
-- brake deficits and lock, launch slip, yaw pulses, crests and per-sample grip state. This joins
-- them: each detected occurrence is placed on the turn it happened at, so the question stops
-- being "does this car understeer" and becomes "it pushes at T5 and T15, on 9 of 11 laps".
--
-- An occurrence is evidence, not a verdict. Counting them per turn and per setup is what turns
-- a one-lap impression into a statistic, and what lets an A/B say which failures a change fixed.
-- ============================================================================

CREATE TABLE IF NOT EXISTS ref_symptom (
  symptom       TEXT PRIMARY KEY,
  phase         TEXT,                    -- entry | mid | exit | braking | straight | kerbs | any
  primary_fix   TEXT,
  secondary_fix TEXT,
  tertiary_fix  TEXT,
  verify_test   TEXT,
  detector      TEXT,                    -- how this project detects it, in words
  source        TEXT                     -- where the fix came from; provenance is not optional
);

CREATE TABLE IF NOT EXISTS diag_event (
  event_id    INTEGER PRIMARY KEY,
  symptom     TEXT NOT NULL REFERENCES ref_symptom(symptom),
  session_id  TEXT,
  cid         TEXT,
  lap_id      INTEGER REFERENCES lap(lap_id) ON DELETE CASCADE,
  container   TEXT,                      -- the setup that was driving, when known
  hw_hash     TEXT,
  route_key   TEXT,
  turn_id     TEXT,                      -- NULL means it happened away from any turn
  phase       TEXT,
  t           REAL,
  mph         REAL,
  severity    REAL,                      -- 0..1, comparable within one symptom only
  detail      TEXT,
  source      TEXT NOT NULL              -- bottoming | braking | crest | pulse | grip
);
CREATE INDEX IF NOT EXISTS ix_diag_turn ON diag_event(route_key, turn_id, symptom);
CREATE INDEX IF NOT EXISTS ix_diag_setup ON diag_event(container, symptom);

-- Which corners cost you the most, and how often -- the rollup the tuning view reads.
CREATE VIEW IF NOT EXISTS v_diag_by_turn AS
SELECT d.route_key, c.name AS course, d.turn_id, g.kind, g.radius_m, g.width_m, g.bank_deg,
       d.symptom, s.phase, s.primary_fix,
       COUNT(*) AS occurrences,
       COUNT(DISTINCT d.lap_id) AS laps_affected,
       COUNT(DISTINCT d.container) AS setups_affected,
       ROUND(AVG(d.severity), 3) AS mean_severity
FROM diag_event d
JOIN ref_symptom s ON s.symptom = d.symptom
LEFT JOIN course c ON c.route_key = d.route_key
LEFT JOIN course_route cr ON cr.route_key = d.route_key
LEFT JOIN ref_route_turn g ON g.route_id = cr.route_id AND g.turn_id = d.turn_id
WHERE d.turn_id IS NOT NULL
GROUP BY d.route_key, d.turn_id, d.symptom;

-- What a given setup keeps doing wrong, wherever it happens.
CREATE VIEW IF NOT EXISTS v_diag_by_setup AS
SELECT d.container, t.tune_name, t.ordinal, r.full_name AS car, d.symptom, s.phase,
       s.primary_fix, s.secondary_fix,
       COUNT(*) AS occurrences, COUNT(DISTINCT d.lap_id) AS laps_affected,
       COUNT(DISTINCT d.turn_id) AS turns_affected, ROUND(AVG(d.severity), 3) AS mean_severity
FROM diag_event d
JOIN ref_symptom s ON s.symptom = d.symptom
LEFT JOIN tune_container t ON t.container = d.container
LEFT JOIN ref_car r ON r.ordinal = t.ordinal
WHERE d.container IS NOT NULL
GROUP BY d.container, d.symptom;

-- ============================================================================
-- THE CURVES  (added 2026-09-03)
--
-- Two lookup tables the game ships and the lab had never read: the torque curve behind every
-- engine, and the friction curve behind every tyre compound. Both are sampled curves stored one
-- value per column (v0..v245 / v0..v99), which is why they read as noise until the sampling rule
-- is known. Both rules are exact, not fitted.
--
-- TORQUE.  List_TorqueCurve, 1,725 rows, and the ownership is a bijection:
--   1,706 rows of List_UpgradeEngineCamshaft + 19 rows of Data_Motor = 1,725, no id used twice
--   and none left over. So a torque curve is not "an engine's" -- it is a CAMSHAFT PART's (or an
--   electric motor's), which is exactly right: fitting Race Cams is what changes the curve. The
--   engine's own curve is the row with IsStock=1.
--   * sampling: uniform, 100 rpm per step, from 0 rpm. TorqueCurveMaxRPM == 100*(N-1) on all
--     1,706 camshafts, and NumRPMEntriesArray == NumTorqueValues on all of them.
--   * values: normalised, peak == 1.0 (1,718 of 1,725 curves; the other 7 peak at 0.99999).
--     torque_Nm = v * TorqueScale, so TorqueScale IS the peak torque in Nm.
--   * the LAST sample is not a dyno point. It is the past-the-top-of-the-table value and is
--     negative on 1,720 of 1,725 curves (-2.63 typical, down to -25.05): closed-throttle drag
--     beyond the table. v_torque_point flags it limiter=1 rather than dropping it silently.
--   * power: hp = Nm * rpm / 7120.54  (== lb-ft * rpm / 5252). Checked against the game's own
--     Data_Car.SimPeakPower, which is watts/100: on the naturally aspirated cars it comes out at
--     150.0, 300.0, 375.0 hp -- exact, not close.
--   * the boost multiplier the project already used holds: Data_Car.SimPeakTorque*100 equals the
--     stock camshaft curve's TorqueScale on 313 of the 314 naturally aspirated cars, and the
--     ratio on the forced-induction ones runs 1.03..2.87 (turbo median 1.46, twin turbo 1.55,
--     DSC 1.32, CSC 1.36).
--   NOT modelled here: the multipliers the other engine parts apply on top. They are already in
--   ref_part.data -- a CSC row, for instance, carries ZeroRPMScale/RedlineRPMScale (0.88 -> 1.37
--   across the rev range) and TorqueDropOffRPM0/1. This table is the FULL-THROTTLE BASE the game
--   then scales: a dyno for the engine, not yet one for the finished build.
--
-- FRICTION.  List_TireFrictionCurve, 738 rows, and the ownership is a bijection again:
--   List_TireCompound carries 9 FrictionMultiCurve*ID columns (lateral / longitudinal-accel /
--   longitudinal-brake, each for asphalt, offroad and snow). 41 compounds x 9 = 369, which is
--   exactly the row count of List_TireFrictionMultiCurve, with no id shared between two
--   compounds. Each multicurve names two friction curves, 369 x 2 = 738, again all distinct. So
--   every friction curve belongs to exactly one (compound, channel, surface, load band) and the
--   whole chain flattens onto the curve without losing anything:
--     ref_compound.compound_id -> ref_friction_curve.compound_id     (join, no indirection)
--   * a multicurve is a LOAD BLEND, not a shape: curve 0 is authored at 10.1972 kgf (== 100 N
--     exactly) and curve 1 at 1000 kgf, and load is clamped at 3500 kgf (10000 on one compound).
--     That is the load sensitivity -- grip per newton falls as the tyre is loaded.
--   * sampling: uniform over slip, slip = index/(N-1) * MaxSlip, with N = 100 on every row.
--     MaxSlip is 49.5 degrees on the lateral channels and 1.1 (slip ratio) on the longitudinal.
--   * values: normalised, peak == 1.0, so mu = v * FrictionScale and FrictionScale IS peak mu.
--   * ref_compound's lat/long/brake peaks are NOT derived from this table, and are not
--     contradicted by it. Both come from the same authoring row, List_TyreCurveDB: the peaks are
--     its Asph_LatSlipPeak0/1 etc., and this table is those parameters baked onto a 100-point
--     grid. Recovering the peak from the grid (argmax) reproduces the authored value to within
--     one grid step on 682 of 738 curves and within three on all but two -- the curve is flat at
--     the top, so argmax on a 0.5-degree grid cannot do better. The authored value is carried
--     here as authored_peak_slip so the two can be compared without a second table.
--     One unit note, from that same check: List_TyreCurveDB states ALL peaks on a common 0..49.5
--     authoring scale. On the lateral channels that scale is already degrees; on the longitudinal
--     ones the slip ratio is peak/45 (a stated 5.5 is a 0.122 slip ratio, not 5.5%).
-- ============================================================================

-- One row per List_TorqueCurve row, with its owner flattened on.
CREATE TABLE IF NOT EXISTS ref_torque_curve (
  curve_id        INTEGER PRIMARY KEY,   -- List_TorqueCurve.TorqueCurveID
  source          TEXT NOT NULL,         -- 'camshaft' | 'motor'
  engine_id       INTEGER,               -- List_UpgradeEngineCamshaft.EngineID (NULL for motors)
  motor_id        INTEGER,               -- Data_Motor.MotorID (NULL for camshafts)
  part_id         INTEGER,               -- the camshaft part: ref_part(slot='camshaft', part_id)
  level           INTEGER,               -- catalogue level of that camshaft
  is_stock        INTEGER,               -- 1 = the engine's own curve
  n_samples       INTEGER NOT NULL,      -- NumTorqueValues; the last is the limiter, not a point
  rpm_step        REAL NOT NULL,         -- 100.0, always
  max_rpm         REAL,                  -- 100*(n_samples-1) == TorqueCurveMaxRPM
  redline_rpm     REAL,                  -- the camshaft's own redline (below max_rpm)
  stall_rpm       REAL,
  torque_scale    REAL NOT NULL,         -- Nm at v == 1.0, i.e. peak torque
  zero_throttle_scale REAL,              -- closed-throttle (engine braking) scale
  limiter_value   REAL,                  -- the final sample, kept out of the dyno
  peak_torque_nm  REAL, peak_torque_rpm REAL,
  peak_power_hp   REAL, peak_power_rpm  REAL,
  samples         TEXT NOT NULL          -- JSON array of the n_samples normalised values
);
CREATE INDEX IF NOT EXISTS ix_torque_engine ON ref_torque_curve(engine_id, is_stock, level);

-- One row per List_TireFrictionCurve row, with compound / channel / surface / load flattened on.
CREATE TABLE IF NOT EXISTS ref_friction_curve (
  curve_id        INTEGER PRIMARY KEY,   -- List_TireFrictionCurve.FrictionCurveID
  compound_id     INTEGER REFERENCES ref_compound(compound_id),
  multicurve_id   INTEGER,               -- List_TireFrictionMultiCurve.FrictionMultiCurveID
  channel         TEXT,                  -- 'lat' | 'accel' | 'brake'
  surface         TEXT,                  -- 'asphalt' | 'offroad' | 'snow'
  load_band       INTEGER,               -- 0 = the light curve, 1 = the heavy curve
  load_kgf        REAL,                  -- the load this curve is authored at (10.1972 / 1000)
  load_clamp_kgf  REAL,                  -- load above this stops changing the blend
  max_slip        REAL,                  -- full-scale slip: 49.5 deg lateral, 1.1 ratio long
  slip_unit       TEXT,                  -- 'deg' | 'ratio'
  n_samples       INTEGER NOT NULL,      -- 100 on every row
  friction_scale  REAL,                  -- peak mu (the samples peak at 1.0)
  peak_slip       REAL,                  -- slip at the curve's own argmax, in slip_unit
  authored_peak_slip REAL,               -- List_TyreCurveDB's peak, converted to slip_unit
  authored_peak_raw  REAL,               -- ... as stored, on the game's 0..49.5 scale
  samples         TEXT NOT NULL          -- JSON array of the 100 normalised values
);
CREATE INDEX IF NOT EXISTS ix_friction_compound
  ON ref_friction_curve(compound_id, surface, channel, load_band);

-- The dyno. One row per rpm step; filter limiter=0 for the drivable part of the curve.
--   SELECT rpm, torque_nm, power_hp FROM v_torque_point
--    WHERE engine_id=733 AND is_stock=1 AND limiter=0 ORDER BY rpm;
CREATE VIEW IF NOT EXISTS v_torque_point AS
SELECT c.curve_id, c.source, c.engine_id, c.motor_id, c.part_id, c.level, c.is_stock,
       j.key                                                          AS idx,
       j.key * c.rpm_step                                             AS rpm,
       j.value                                                        AS torque_norm,
       j.value * c.torque_scale                                       AS torque_nm,
       j.value * c.torque_scale * 0.73756215                          AS torque_lbft,
       j.value * c.torque_scale * (j.key * c.rpm_step) / 7120.54      AS power_hp,
       CASE WHEN j.key = c.n_samples - 1 THEN 1 ELSE 0 END            AS limiter,
       CASE WHEN c.redline_rpm IS NOT NULL AND j.key * c.rpm_step > c.redline_rpm
            THEN 1 ELSE 0 END                                         AS past_redline
FROM ref_torque_curve c, json_each(c.samples) j;

-- The friction curve, one row per slip step.
--   SELECT slip, mu FROM v_friction_point
--    WHERE compound_id=13 AND surface='asphalt' AND channel='lat' AND load_band=0 ORDER BY slip;
CREATE VIEW IF NOT EXISTS v_friction_point AS
SELECT f.curve_id, f.compound_id, f.channel, f.surface, f.load_band, f.load_kgf, f.slip_unit,
       j.key                                          AS idx,
       j.key * f.max_slip / (f.n_samples - 1.0)       AS slip,
       j.value                                        AS mu_norm,
       j.value * f.friction_scale                     AS mu
FROM ref_friction_curve f, json_each(f.samples) j;

-- ============================================================================
-- FIELD-LEVEL KNOWLEDGE CATALOGUE (2026-09-03). Every field this project has profiled, what
-- gates what, and how much a decoded value can actually be trusted -- as DATA, not as tribal
-- knowledge scattered across code comments, one person's external memory, and a markdown doc no
-- query can reach. Source: docs/data-field-catalog-2026-09-03.md (86 stores) + findings from the
-- 2026-09-03 session (see memory fh6-slider-value-reliability-hierarchy, fh6-catalog-structure-not-hoard).
-- Populated by scripts/db/import_field_catalog.py. Read-and-derived, never hand-edited in place --
-- correct the source (the doc, or this session's findings) and re-run the stage.
-- ============================================================================

-- One row per (store, field) this project has profiled. A "store" is a fh6.db table name or a
-- data/*.json file path; a "field" is one column/key inside it.
CREATE TABLE IF NOT EXISTS ref_field (
  store         TEXT NOT NULL,           -- 'tune_slider', 'data/car-mass.json', etc.
  field         TEXT NOT NULL,           -- the field/column/key's own name in that store
  domain        TEXT,                    -- 'car' | 'world' | 'player_meta' | 'project'
  storage_type  TEXT,                    -- 'int' | 'float' | 'string' | 'enum' | 'json' | 'bool'
  enum_source   TEXT,                    -- where the value set comes from, when storage_type='enum'
  join_target   TEXT,                    -- 'store.field' this value can be looked up against, if any
  notes         TEXT,                    -- confidence caveats, format quirks, anything else worth keeping
  PRIMARY KEY (store, field)
);

-- The dependency graph a comment used to be the only record of: which field, when it changes,
-- changes what ANOTHER field's value even means or whether it's offered at all. Verified 2026-09-03:
-- car_body/Body Kit renumbers weight_reduction and roll_cage's dense-in-variant tiers and removes
-- front_bumper; the engine and aspiration slots change the whole Engine & Power menu's contents.
CREATE TABLE IF NOT EXISTS ref_field_gate (
  gating_store  TEXT NOT NULL,           -- the field whose value determines the gate
  gating_field  TEXT NOT NULL,
  gated_store   TEXT NOT NULL,           -- the field whose meaning or availability the gate controls
  gated_field   TEXT NOT NULL,
  mechanism     TEXT NOT NULL,           -- 'removes tile' | 'changes tier names' | 'changes tile count' | 'changes menu contents'
  evidence      TEXT,                    -- a doc citation or session finding this was verified against
  PRIMARY KEY (gating_store, gating_field, gated_store, gated_field)
);

-- The reliability hierarchy (memory fh6-slider-value-reliability-hierarchy) AS DATA: for a given
-- field, every tier of evidence that CAN produce a value for it, ranked. Tier 0 is ground truth
-- (the game's own physics table); tier 5 is an honest "no absolute value, position only" -- which
-- outranks a confident wrong number from any tier above it, not a gap in the data.
CREATE TABLE IF NOT EXISTS ref_field_reliability (
  store         TEXT NOT NULL,
  field         TEXT NOT NULL,
  tier          INTEGER NOT NULL,        -- 0 database .. 1 two-point solve .. 2 global band (field-proven only)
                                          -- .. 3 mass-derived formula .. 4 single anchor .. 5 position-only
  tier_name     TEXT NOT NULL,
  why           TEXT,                    -- why this field can reach this tier, and what makes the tier itself trustworthy or not
  source_fn     TEXT,                    -- the function/branch that actually produces a value at this tier
  PRIMARY KEY (store, field, tier)
);
