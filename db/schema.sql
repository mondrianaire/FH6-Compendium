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
  kind         TEXT NOT NULL,           -- gamedb | strings | containers | sessions | courses | derive
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

CREATE TABLE IF NOT EXISTS ref_track (
  track_id      INTEGER PRIMARY KEY,
  name          TEXT,
  media_name    TEXT,
  length_m      REAL,
  is_reverse    INTEGER,
  is_real_world INTEGER,
  data          TEXT
);

CREATE TABLE IF NOT EXISTS ref_event (
  event_id      TEXT PRIMARY KEY,        -- guid or synthetic key
  kind          TEXT,                    -- rivals | career | drift_zone | speed_trap | danger_sign | trailblazer …
  name          TEXT,
  track_id      INTEGER REFERENCES ref_track(track_id),
  route_id      TEXT,
  class_limit   TEXT,
  pi_limit      INTEGER,
  region        TEXT,
  data          TEXT
);
CREATE INDEX IF NOT EXISTS ix_event_kind ON ref_event(kind, name);

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

CREATE TABLE IF NOT EXISTS course (
  route_key    TEXT PRIMARY KEY,         -- '-1700_-4450' — the start-cell key
  name         TEXT,                     -- 'Highway Circuit'
  is_rivals    INTEGER DEFAULT 0,
  event_id     TEXT REFERENCES ref_event(event_id),   -- when matched to a game event
  length_m     REAL,
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
  solo        INTEGER DEFAULT 0,
  impacts     INTEGER DEFAULT 0,
  void        INTEGER DEFAULT 0,
  UNIQUE (route_key, session_id, cid, t0)
);
CREATE INDEX IF NOT EXISTS ix_lap_course ON lap(route_key, class, void, is_partial, lap_s);

-- One row per sample. Storing the trace as rows (not a JSON blob) is what lets the
-- analyzer and the dashboard ask questions of it in SQL instead of parsing 300 arrays.
CREATE TABLE IF NOT EXISTS lap_point (
  lap_id   INTEGER NOT NULL REFERENCES lap(lap_id) ON DELETE CASCADE,
  i        INTEGER NOT NULL,
  arc_m    REAL NOT NULL,
  mph      REAL,
  grip     INTEGER,                      -- 0 calm, 1 front, 2 rear, 3 both, 4 impact
  x        REAL, z REAL,
  elev_m   REAL,
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
  name        TEXT,                    -- filled once the event datasets are decoded
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
  road_class_mix   TEXT                   -- JSON {road_type: fraction}, ordered by size
);

CREATE TABLE IF NOT EXISTS ref_route_point (
  route_id    TEXT NOT NULL REFERENCES ref_route(route_id) ON DELETE CASCADE,
  i           INTEGER NOT NULL,
  x           REAL NOT NULL,
  y           REAL,                    -- elevation
  z           REAL NOT NULL,
  PRIMARY KEY (route_id, i)
) WITHOUT ROWID;

-- How a learned course maps onto a game route, WITH the evidence for the claim.
-- match_kind: verified (whole route, clearly best) | probable | partial (on it, drove some of
-- it) | none. 'partial' is a real answer: it says the lap records belong to a stretch of that
-- route, not to the route.
CREATE TABLE IF NOT EXISTS course_route (
  route_key    TEXT PRIMARY KEY REFERENCES course(route_key) ON DELETE CASCADE,
  route_id     TEXT REFERENCES ref_route(route_id),
  match_kind   TEXT NOT NULL,
  mean_dev_m   REAL,
  p95_dev_m    REAL,
  covered      REAL,                   -- fraction of the game route we have driven
  len_ratio    REAL,
  runner_up    TEXT,
  computed_utc TEXT
);

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
CREATE INDEX IF NOT EXISTS ix_route_surface ON ref_route_surface(route_id, surface);

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
