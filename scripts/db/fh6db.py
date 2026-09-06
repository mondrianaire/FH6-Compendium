#!/usr/bin/env python3
"""fh6db.py -- the one accessor for data/fh6.db. Every importer and consumer imports this.

WHY THIS FILE EXISTS
--------------------
Before the central database the project resolved part names, slider units, PI and clone
routes at call time, from a dozen JSON files, with the resolver duplicated in
clone_parts.py, fh6_tune_decode.py, app.js and the daemon. This module holds the *rules*
that those four copies disagreed about -- the string hash, the display-PI curve, the
slider band conversion -- exactly once, so a fix lands everywhere at once.

Nothing here reads the game files or writes a ref_/tune_ table. It opens the database,
applies the pragmas, keeps import_run bookkeeping, and implements the four arithmetic
rules the importers share. Keep it small; five other modules depend on its stability.

THE RULES IMPLEMENTED HERE (established by adversarial verification 2026-09-02;
do not re-derive, do not contradict)
------------------------------------------------------------------------------
1. String refs.  Every '_&<u64>' cell in the game DB is (H(table) << 32) | H(key), with
   H(s) = { h = 0xFFFFFFFF; for each UTF-8 byte c: h = rotl32(h ^ c, 7) }.
   Verified on 58,722 keys and 35 table names.  lo32 is NOT unique across tables
   (1,035 of 6,105 collide) -- resolution MUST go through the table named by hi32.
   -> strhash(), split_ref(), make_ref(), parse_ref()

4. Display PI = max(100, ceil(P0 + (norm - X0) * (P1 - P0) / (X1 - X0))) where (X1,P1) are
   the car's class MaxPerformanceIndex / MaxDisplayPerformanceIndex and (X0,P0) the previous
   class's; class D's lower anchor is (0.0, 99).  Ceil, not round.
   -> display_pi(), class_of(), build_class_anchors()

   Measured against the game's own Data_Car.PI on all 660 cars: 643 exact, 17 off by one.
   All 17 are explained by Data_Car.PerformanceIndex being STORED TO 4 DECIMALS -- for each
   of the 17 there is a norm inside the +/-0.00005 rounding window that yields the stored PI
   (see --selftest, which asserts exactly that).  The formula is right; the stored input is
   coarse.  Consequence for importers: when the game's own PI column is available, COPY IT.
   display_pi() is for norms we compute ourselves (a build's PI), not for restating the
   catalogue.

5. Sliders.  v = Min + s*(Max-Min) in the physics row's unit; a fresh install writes
   s = clamp((Def-Min)/(Max-Min), 0, 1).  When Max == Min the slider is LOCKED: the install
   writes s = 0.5 and v = Min for any s (0 exceptions in 575 containers).  Adjustability is
   decided by Max > Min, not by IsStock.
   -> slider_value(), install_norm(), is_locked()

CLI
---
    python scripts/db/fh6db.py --init [--db PATH]     create/upgrade the database
    python scripts/db/fh6db.py --info [--db PATH]     table row counts + import_run history
    python scripts/db/fh6db.py --check [--db PATH]    integrity, foreign keys, empty ref_ tables
    python scripts/db/fh6db.py --selftest [--db PATH] the arithmetic rules, against the game DB
"""

import argparse
import math
import os
import sqlite3
import struct
import sys
import tempfile
import time

# ---------------------------------------------------------------------------
# Paths and constants
# ---------------------------------------------------------------------------

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DEFAULT_DB = os.path.join(REPO_ROOT, "data", "fh6.db")
SCHEMA_PATH = os.path.join(REPO_ROOT, "db", "schema.sql")
GAMEDB_PATH = r"C:\Users\mondr\Downloads\forza raw data files\FH6_Database.sqlite"

SCHEMA_VERSION = "4"   # 2 = COURSE NAMES; 3 = ANCHORS (route_anchor, session_event, ref_route.is_race, course_route.anchor_*); 4 = the game's EVENT CATALOGUE (ref_track_info, ref_race_collection, ref_career_race, ref_rivals_event, ref_car_restriction, v_rivals_route) -- all 2026-09-05, applied by migrate()

#: The confidence vocabulary. Every `confidence` column in the schema uses exactly these.
CONFIDENCE = ("proven", "verified", "derived", "read", "unknown")

#: 0xFFFFFFFF in a container part slot means EMPTY. Stored as NULL part_id, never 0.
EMPTY_PART = 0xFFFFFFFF

M32 = 0xFFFFFFFF
BUSY_TIMEOUT_MS = 10000


def utcnow():
    """ISO-8601 UTC, the only time format any column holds."""
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


# ---------------------------------------------------------------------------
# 1. Connection
# ---------------------------------------------------------------------------


def db_path(path=None):
    """Resolve the database path: explicit arg > $FH6_DB > <repo>/data/fh6.db."""
    return os.path.abspath(path or os.environ.get("FH6_DB") or DEFAULT_DB)


def connect(path=None, ro=False):
    """Open the database with the project's pragmas and sqlite3.Row rows.

    ro=True opens it immutable-read-only through a file: URI, for consumers (the dashboard,
    a report) that must never take a write lock on a database an importer is rebuilding.
    """
    p = db_path(path)
    if ro:
        cx = sqlite3.connect("file:%s?mode=ro" % p.replace("\\", "/"), uri=True, timeout=BUSY_TIMEOUT_MS / 1000.0)
    else:
        d = os.path.dirname(p)
        if d and not os.path.isdir(d):
            os.makedirs(d, exist_ok=True)
        cx = sqlite3.connect(p, timeout=BUSY_TIMEOUT_MS / 1000.0)
        # WAL so a reader (dashboard) and a writer (importer) coexist. Read-only handles
        # cannot set it; that is fine, the journal mode is a property of the file.
        try:
            cx.execute("PRAGMA journal_mode=WAL")
        except sqlite3.DatabaseError:
            pass
    cx.execute("PRAGMA foreign_keys=ON")
    cx.execute("PRAGMA busy_timeout=%d" % BUSY_TIMEOUT_MS)
    cx.row_factory = sqlite3.Row
    return cx


# ---------------------------------------------------------------------------
# 2. Schema and meta
# ---------------------------------------------------------------------------


def has_table(cx, name):
    return cx.execute(
        "SELECT 1 FROM sqlite_master WHERE type IN ('table','view') AND name=?", (name,)
    ).fetchone() is not None


def ensure_schema(cx, schema_path=None):
    """Execute db/schema.sql when schema_meta is absent. Idempotent.

    Returns True when it created the schema, False when it was already there.
    """
    if has_table(cx, "schema_meta"):
        _seed_meta(cx)
        return False
    sp = schema_path or SCHEMA_PATH
    with open(sp, "r", encoding="utf-8") as fh:
        sql = fh.read()
    cx.executescript(sql)          # executescript commits first, then runs the whole file
    cx.execute("PRAGMA foreign_keys=ON")
    _seed_meta(cx)
    return True


def _seed_meta(cx):
    if meta_get(cx, "created_utc") is None:
        meta_set(cx, "created_utc", utcnow())
    if meta_get(cx, "schema_version") is None:
        meta_set(cx, "schema_version", SCHEMA_VERSION)
    cx.commit()


def meta_get(cx, key, default=None):
    r = cx.execute("SELECT value FROM schema_meta WHERE key=?", (key,)).fetchone()
    return default if r is None else r[0]


def meta_set(cx, key, value):
    cx.execute("INSERT OR REPLACE INTO schema_meta(key,value) VALUES(?,?)", (key, str(value)))


def schema_version(cx, value=None):
    """Reader with no argument, writer with one."""
    if value is None:
        return meta_get(cx, "schema_version")
    meta_set(cx, "schema_version", value)
    cx.commit()
    return str(value)


# ---------------------------------------------------------------------------
# 3. import_run bookkeeping -- every importer opens and closes one
# ---------------------------------------------------------------------------


def run_begin(cx, kind, source=None):
    """Open an import_run row. Committed immediately so a crashed run leaves ok=0 behind."""
    cur = cx.execute(
        "INSERT INTO import_run(kind, source, started_utc, ok) VALUES(?,?,?,0)",
        (kind, source, utcnow()),
    )
    cx.commit()
    return cur.lastrowid


def run_end(cx, run_id, n_rows=None, ok=1, notes=None):
    """Close an import_run row."""
    cx.execute(
        "UPDATE import_run SET finished_utc=?, n_rows=?, ok=?, notes=? WHERE run_id=?",
        (utcnow(), n_rows, 1 if ok else 0, notes, run_id),
    )
    cx.commit()
    return run_id


# ---------------------------------------------------------------------------
# 4. Bulk write
# ---------------------------------------------------------------------------


def upsert_many(cx, table, cols, rows, chunk=1000):
    """Chunked executemany INSERT OR REPLACE. Rows may be sequences or dicts.

    Returns the number of rows sent. Does NOT commit -- the caller owns the transaction,
    so a failed import leaves the table as it was.
    """
    cols = list(cols)
    sql = "INSERT OR REPLACE INTO %s (%s) VALUES (%s)" % (
        table, ",".join(cols), ",".join("?" * len(cols)))
    n = 0
    buf = []
    for r in rows:
        if isinstance(r, dict):
            r = tuple(r.get(c) for c in cols)
        else:
            r = tuple(r)
        if len(r) != len(cols):
            raise ValueError("%s: row has %d values for %d columns: %r" % (table, len(r), len(cols), r))
        buf.append(r)
        if len(buf) >= chunk:
            cx.executemany(sql, buf)
            n += len(buf)
            buf = []
    if buf:
        cx.executemany(sql, buf)
        n += len(buf)
    return n


def wipe(cx, *tables):
    """DELETE FROM each table, children first as given. Returns rows removed."""
    n = 0
    for t in tables:
        n += cx.execute("DELETE FROM %s" % t).rowcount or 0
    return n


def replace_all(cx, table, cols, rows, chunk=1000):
    """The idempotency pattern every importer needs: empty the table, refill it.

    Caller still owns the transaction and the import_run row.
    """
    cx.execute("DELETE FROM %s" % table)
    return upsert_many(cx, table, cols, rows, chunk=chunk)


def merge_many(cx, table, cols, rows, key, coalesce=(), chunk=1000):
    """Chunked INSERT ... ON CONFLICT(key) DO UPDATE -- an upsert that keeps the parent row.

    upsert_many is INSERT OR REPLACE, which DELETES the existing row first and so fires every
    ON DELETE CASCADE hanging off it (proven 2026-09-05: it emptied course_route on every
    telemetry run). Use this for any table that is a foreign-key parent (course). Columns in
    `coalesce` keep their stored value when the incoming one is NULL. Does NOT commit.
    """
    cols = list(cols)
    key = tuple(key)
    upd = ", ".join(
        ("%s=COALESCE(excluded.%s, %s.%s)" % (c, c, table, c)) if c in coalesce else ("%s=excluded.%s" % (c, c))
        for c in cols if c not in key)
    sql = "INSERT INTO %s (%s) VALUES (%s) ON CONFLICT(%s) DO UPDATE SET %s" % (
        table, ",".join(cols), ",".join("?" * len(cols)), ",".join(key), upd)
    n = 0
    buf = []
    for r in rows:
        if isinstance(r, dict):
            r = tuple(r.get(c) for c in cols)
        else:
            r = tuple(r)
        if len(r) != len(cols):
            raise ValueError("%s: row has %d values for %d columns: %r" % (table, len(r), len(cols), r))
        buf.append(r)
        if len(buf) >= chunk:
            cx.executemany(sql, buf)
            n += len(buf)
            buf = []
    if buf:
        cx.executemany(sql, buf)
        n += len(buf)
    return n


# ---------------------------------------------------------------------------
# 4b. Migration -- schema.sql only runs on a FRESH database (ensure_schema), so every addition
#     is applied here too, ALTER-when-missing. ADD COLUMN with no default is metadata-only.
# ---------------------------------------------------------------------------

#: COURSE NAMES (2026-09-05). Keep in step with db/schema.sql by hand; rebuild --check I11 asserts the
#: live DB has them, and the tests build a fresh DB from schema.sql, so drift fails one or the other.
V2_COLUMNS = {
    "course": [("declared_name", "TEXT"), ("declared_source", "TEXT"),
               ("name_source", "TEXT"), ("name_confidence", "TEXT")],
    "ref_route": [("event_id", "TEXT REFERENCES ref_event(event_id)"),
                  ("name_source", "TEXT"), ("name_confidence", "TEXT")],
    "ref_event": [("discipline", "TEXT"), ("length_m", "REAL"), ("is_loop", "INTEGER"), ("source", "TEXT")],
    # schema 3 -- ANCHORS
    "course_route": [("anchor_route_id", "TEXT REFERENCES ref_route(route_id)"),
                     ("anchor_events", "INTEGER"), ("anchor_agree", "INTEGER")],
}
V2_COLUMNS["ref_route"].append(("is_race", "INTEGER"))
V2_TABLES = {
    "ref_event_string": """CREATE TABLE IF NOT EXISTS ref_event_string (
  event_id    TEXT NOT NULL REFERENCES ref_event(event_id) ON DELETE CASCADE,
  table_name  TEXT NOT NULL,
  key_hash    INTEGER NOT NULL,
  key_name    TEXT NOT NULL,
  role        TEXT NOT NULL,
  PRIMARY KEY (event_id, table_name, key_hash),
  FOREIGN KEY (table_name, key_hash) REFERENCES ref_string(table_name, key_hash)
) WITHOUT ROWID""",
    "course_event": """CREATE TABLE IF NOT EXISTS course_event (
  route_key    TEXT NOT NULL REFERENCES course(route_key) ON DELETE CASCADE,
  event_id     TEXT NOT NULL REFERENCES ref_event(event_id) ON DELETE CASCADE,
  tier         TEXT NOT NULL,
  route_id     TEXT REFERENCES ref_route(route_id),
  d_route_m    REAL,
  d_course_m   REAL,
  loop_ok      INTEGER,
  road_ok      INTEGER,
  declared_ok  INTEGER,
  chosen       INTEGER NOT NULL DEFAULT 0,
  computed_utc TEXT NOT NULL,
  PRIMARY KEY (route_key, event_id)
) WITHOUT ROWID""",
    # schema 3 -- ANCHORS
    "route_anchor": """CREATE TABLE IF NOT EXISTS route_anchor (
  route_id    TEXT PRIMARY KEY REFERENCES ref_route(route_id) ON DELETE CASCADE,
  x           REAL NOT NULL,
  y           REAL,
  z           REAL NOT NULL,
  radius_m    REAL NOT NULL,
  name        TEXT,
  source      TEXT
)""",
    "session_event": """CREATE TABLE IF NOT EXISTS session_event (
  session_id  TEXT NOT NULL REFERENCES session(session_id) ON DELETE CASCADE,
  i           INTEGER NOT NULL,
  t0          REAL, t1 REAL,
  cid         TEXT,
  mode        TEXT,
  solo        INTEGER,
  laps        INTEGER,
  distance_m  REAL,
  duration_s  REAL,
  start_x     REAL, start_z REAL,
  end_x       REAL, end_z REAL,
  route_key   TEXT,
  start_is_line INTEGER,
  PRIMARY KEY (session_id, i)
) WITHOUT ROWID""",
    # schema 4 -- THE GAME'S EVENT CATALOGUE (ObjectModelGame.zip)
    "ref_track_info": """CREATE TABLE IF NOT EXISTS ref_track_info (
  track_key       INTEGER PRIMARY KEY,
  route_id        TEXT,
  custom_route_id TEXT,
  ribbon          TEXT,
  display_name    TEXT NOT NULL,
  short_name      TEXT,
  description     TEXT,
  name_key        TEXT NOT NULL,
  use_cross_country_ai INTEGER,
  blueprint_only  INTEGER,
  activation_zone TEXT,
  media_track     TEXT,
  pi_sort         INTEGER
)""",
    "ref_race_collection": """CREATE TABLE IF NOT EXISTS ref_race_collection (
  collection_key  INTEGER PRIMARY KEY,
  name            TEXT NOT NULL,
  description     TEXT,
  collection_type TEXT,
  restriction_id  TEXT,
  forced_restriction_id TEXT,
  solo INTEGER, coop INTEGER, pvp INTEGER,
  recommended_cars TEXT
)""",
    "ref_career_race": """CREATE TABLE IF NOT EXISTS ref_career_race (
  race_key        INTEGER PRIMARY KEY,
  name            TEXT NOT NULL,
  event_type      TEXT,
  track_key       INTEGER NOT NULL REFERENCES ref_track_info(track_key),
  collection_key  INTEGER NOT NULL REFERENCES ref_race_collection(collection_key),
  race_mode       TEXT,
  discipline      TEXT,
  num_laps        INTEGER,
  n_ai            INTEGER,
  is_timed INTEGER, has_traffic INTEGER, rivals_enabled INTEGER, teams INTEGER,
  ui_theme        TEXT,
  entity_name     TEXT,
  progression_thread TEXT
)""",
    "ref_rivals_event": """CREATE TABLE IF NOT EXISTS ref_rivals_event (
  rivals_key      INTEGER PRIMARY KEY,
  name            TEXT NOT NULL,
  description     TEXT,
  leaderboard_id  TEXT,
  collection_key  INTEGER NOT NULL REFERENCES ref_race_collection(collection_key),
  restriction_id  TEXT,
  class_id        INTEGER,
  is_class_based  INTEGER,
  sort_index      INTEGER,
  name_key        TEXT NOT NULL,
  forced_car      TEXT,
  weather_preset  TEXT
)""",
    "ref_car_restriction": """CREATE TABLE IF NOT EXISTS ref_car_restriction (
  restriction_id  TEXT PRIMARY KEY,
  car_class_id INTEGER, car_bucket_id INTEGER,
  pi_min INTEGER, pi_max INTEGER, power_min INTEGER, power_max INTEGER,
  weight_min INTEGER, weight_max INTEGER, year_min INTEGER, year_max INTEGER,
  tagline TEXT, description TEXT,
  data            TEXT
)""",
}
V2_VIEWS = {
    "v_rivals_route": """CREATE VIEW IF NOT EXISTS v_rivals_route AS
  SELECT DISTINCT rv.rivals_key, rv.name, rv.class_id, rv.leaderboard_id, cr.race_key, cr.race_mode,
         cr.discipline, cr.num_laps, ti.track_key, ti.route_id, ti.ribbon, ti.display_name
    FROM ref_rivals_event rv
    JOIN ref_career_race cr ON cr.collection_key = rv.collection_key
    JOIN ref_track_info ti ON ti.track_key = cr.track_key""",
}
V2_COLUMNS["session_event"] = [("start_is_line", "INTEGER")]


def ensure_columns(cx, table, cols):
    """ALTER TABLE ADD COLUMN for each (name, decl) the table lacks. Returns how many were added."""
    have = {r[1] for r in cx.execute("PRAGMA table_info(%s)" % table)}
    added = 0
    for name, decl in cols:
        if name not in have:
            cx.execute("ALTER TABLE %s ADD COLUMN %s %s" % (table, name, decl))
            added += 1
    return added


def migrate(cx):
    """Bring a live database up to SCHEMA_VERSION. Idempotent; commits. Returns (columns, tables) added."""
    n_cols = 0
    for table, cols in V2_COLUMNS.items():
        if has_table(cx, table):
            n_cols += ensure_columns(cx, table, cols)
    n_tabs = 0
    for name, ddl in V2_TABLES.items():
        if not has_table(cx, name):
            cx.execute(ddl)
            n_tabs += 1
    for name, ddl in V2_VIEWS.items():
        if not cx.execute("SELECT 1 FROM sqlite_master WHERE type='view' AND name=?", (name,)).fetchone():
            cx.execute(ddl)
            n_tabs += 1
    if meta_get(cx, "schema_version") != SCHEMA_VERSION:
        meta_set(cx, "schema_version", SCHEMA_VERSION)
    cx.commit()
    return n_cols, n_tabs


def missing_v2(cx):
    """What migrate() still has to add -- [] when the live DB matches SCHEMA_VERSION 2."""
    out = []
    for table, cols in V2_COLUMNS.items():
        if has_table(cx, table):
            have = {r[1] for r in cx.execute("PRAGMA table_info(%s)" % table)}
            out += ["%s.%s" % (table, c) for c, _ in cols if c not in have]
    out += [t for t in V2_TABLES if not has_table(cx, t)]
    out += [v for v in V2_VIEWS if not cx.execute(
        "SELECT 1 FROM sqlite_master WHERE type='view' AND name=?", (v,)).fetchone()]
    return out


def table_counts(cx):
    """{table_name: row_count} for every real table, in schema order."""
    out = {}
    for (t,) in cx.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY rowid"):
        out[t] = cx.execute("SELECT COUNT(*) FROM %s" % t).fetchone()[0]
    return out


# ---------------------------------------------------------------------------
# 5. Rule 1 -- the string hash
# ---------------------------------------------------------------------------


def rotl32(h, k):
    return ((h << k) | (h >> (32 - k))) & M32


def strhash(s):
    """H(s) = { h = 0xFFFFFFFF; for each UTF-8 byte c: h = rotl32(h ^ c, 7) }.

    The hash behind every '_&<u64>' reference and every .str HashId.
    strhash('IDS_Description_1') == 1767058358.
    """
    h = M32
    for c in s.encode("utf-8"):
        h = rotl32(h ^ c, 7)
    return h


def split_ref(u64):
    """(table_hash, key_hash) -- hi32 names the string table, lo32 the key inside it.

    Resolving by lo32 alone is a bug: 1,035 of 6,105 keys collide across tables.
    """
    u = int(u64)
    if u < 0:                       # a u64 that came back through a signed INTEGER column
        u += 1 << 64
    return (u >> 32) & M32, u & M32


def make_ref(table_name, key_name):
    """The u64 the game DB would store for this (table, key)."""
    return (strhash(table_name) << 32) | strhash(key_name)


def parse_ref(cell):
    """'_&3675260003685615545' -> 3675260003685615545. None/'' -> None; non-refs -> None.

    Accepts an int or a plain numeric string too, so a caller can pass a column value
    through without first knowing how the game encoded it.
    """
    if cell is None:
        return None
    if isinstance(cell, int):
        return cell + (1 << 64) if cell < 0 else cell
    s = str(cell).strip()
    if not s:
        return None
    if s.startswith("_&"):
        s = s[2:]
    try:
        v = int(s)
    except ValueError:
        return None
    return v + (1 << 64) if v < 0 else v


# ---------------------------------------------------------------------------
# 6. Rule 4 -- display PI
# ---------------------------------------------------------------------------


def _anchor(c):
    """Normalize one class row (sqlite3.Row, dict or tuple) to
    (class_id, name, norm_prev, pi_prev, norm_max, pi_max)."""
    if isinstance(c, (tuple, list)):
        return tuple(c)
    get = c.__getitem__
    return (get("class_id"), get("name"), get("norm_prev"), get("pi_prev"),
            get("norm_max"), get("pi_max"))


def load_classes(cx):
    """The ref_class rows, ordered -- the argument display_pi() and class_of() want."""
    return [_anchor(r) for r in cx.execute(
        "SELECT class_id, name, norm_prev, pi_prev, norm_max, pi_max FROM ref_class ORDER BY class_id")]


def build_class_anchors(rows):
    """[(class_id, name, norm_max, pi_max)] ascending -> ref_class rows with the lower anchor
    chained on: class N's (norm_prev, pi_prev) is class N-1's max, and class D's is (0.0, 99)
    -- the anchor below the 100 floor.

    This chaining is the half of rule 4 that is not in the game DB, so it lives here rather
    than in the gamedb importer, where a second copy would drift.
    """
    out = []
    pn, pp = 0.0, 99
    for cid, name, norm_max, pi_max in rows:
        out.append((int(cid), name, float(norm_max), int(pi_max), float(pn), int(pp)))
        pn, pp = norm_max, pi_max
    return out          # (class_id, name, norm_max, pi_max, norm_prev, pi_prev)


def _bracket(norm, classes):
    anchors = [_anchor(c) for c in classes]
    if not anchors:
        raise ValueError("display_pi: no classes -- is ref_class populated?")
    anchors.sort(key=lambda a: a[4])
    for a in anchors:
        if norm <= a[4]:
            return a
    return anchors[-1]              # above X's max: clamp into the top band


def display_pi(norm, classes):
    """max(100, ceil(P0 + (norm - X0) * (P1 - P0) / (X1 - X0))). Ceil, not round.

    `classes` is what load_classes() returns (or any sequence of ref_class-shaped rows).
    Returns None for a None norm.
    """
    if norm is None:
        return None
    cid, name, n0, p0, n1, p1 = _bracket(float(norm), classes)
    span = n1 - n0
    if span == 0:
        return max(100, int(p1))
    return max(100, int(math.ceil(p0 + (float(norm) - n0) * (p1 - p0) / span)))


def class_of(norm, classes):
    """(class_id, name) for a normalized PI -- the same bracketing display_pi() uses."""
    if norm is None:
        return (None, None)
    a = _bracket(float(norm), classes)
    return (a[0], a[1])


# ---------------------------------------------------------------------------
# 7. Rule 5 -- slider bands
# ---------------------------------------------------------------------------


def is_locked(mn, mx):
    """Max == Min: the slider exists on the screen but cannot move. Adjustability is decided
    here, by the band, NOT by the part's IsStock flag."""
    if mn is None or mx is None:
        return False
    return float(mx) == float(mn)


def slider_value(norm, mn, mx):
    """v = Min + s*(Max-Min), in the physics row's own unit. Locked band -> Min for any s."""
    if mn is None or mx is None or norm is None:
        return None
    mn, mx = float(mn), float(mx)
    if mx == mn:
        return mn
    return mn + float(norm) * (mx - mn)


def install_norm(def_, mn, mx):
    """The normalized value a fresh install writes: clamp((Def-Min)/(Max-Min), 0, 1),
    and exactly 0.5 when the band is locked (0 exceptions in 575 containers)."""
    if mn is None or mx is None:
        return None
    mn, mx = float(mn), float(mx)
    if mx == mn:
        return 0.5
    if def_ is None:
        return None
    return min(1.0, max(0.0, (float(def_) - mn) / (mx - mn)))


def f32(x):
    """Round a Python float through IEEE single, the width the save file stores."""
    return None if x is None else struct.unpack("<f", struct.pack("<f", float(x)))[0]


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def cmd_init(args):
    cx = connect(args.db)
    created = ensure_schema(cx, args.schema)
    p = db_path(args.db)
    print("%s %s" % ("created" if created else "already present:", p))
    print("schema_version %s  created_utc %s" % (schema_version(cx), meta_get(cx, "created_utc")))
    n_t = cx.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").fetchone()[0]
    n_v = cx.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='view'").fetchone()[0]
    print("tables %d  views %d" % (n_t, n_v))
    cx.close()
    return 0


def cmd_info(args):
    cx = connect(args.db, ro=True)
    print("db: %s (%.1f MB)" % (db_path(args.db), os.path.getsize(db_path(args.db)) / 1048576.0))
    for k in ("schema_version", "created_utc", "game_build", "gamedb_md5"):
        v = meta_get(cx, k)
        if v is not None:
            print("  %-16s %s" % (k, v))
    counts = table_counts(cx)
    print("\n%-26s %10s" % ("table", "rows"))
    for t, n in counts.items():
        print("%-26s %10d%s" % (t, n, "" if n else "   <empty>"))
    print("\nimport_run:")
    rows = list(cx.execute(
        "SELECT run_id, kind, source, started_utc, finished_utc, n_rows, ok, notes"
        " FROM import_run ORDER BY run_id DESC LIMIT 25"))
    if not rows:
        print("  (none)")
    for r in rows:
        print("  #%-4d %-11s %-21s rows=%-8s ok=%d  %s" % (
            r["run_id"], r["kind"], r["started_utc"], r["n_rows"], r["ok"],
            (r["source"] or "")[:60]))
        if r["notes"]:
            print("        %s" % r["notes"][:100])
    cx.close()
    return 0


def cmd_check(args):
    cx = connect(args.db, ro=True)
    bad = 0
    ic = [r[0] for r in cx.execute("PRAGMA integrity_check")]
    print("integrity_check: %s" % ("ok" if ic == ["ok"] else ic))
    bad += ic != ["ok"]

    fk = list(cx.execute("PRAGMA foreign_key_check"))
    print("foreign_key_check: %d violation(s)" % len(fk))
    for r in fk[:20]:
        print("   %s row %s -> %s" % (r[0], r[1], r[2]))
    bad += len(fk) > 0

    counts = table_counts(cx)
    empty_ref = [t for t, n in counts.items() if t.startswith("ref_") and n == 0]
    filled = [t for t in counts if t.startswith("ref_") and counts[t]]
    print("ref_ tables: %d populated, %d empty" % (len(filled), len(empty_ref)))
    for t in empty_ref:
        print("   EMPTY  %s" % t)
    bad += len(empty_ref) > 0

    open_runs = list(cx.execute("SELECT run_id, kind, started_utc FROM import_run WHERE ok=0"))
    if open_runs:
        print("import_run: %d run(s) not ok" % len(open_runs))
        for r in open_runs[:10]:
            print("   #%d %s %s" % (r["run_id"], r["kind"], r["started_utc"]))
    cx.close()
    print("CHECK %s" % ("FAILED" if bad else "PASSED"))
    return 1 if bad else 0


def cmd_selftest(args):
    """The arithmetic rules, asserted against the game DB. Reproducible; no scratchpad."""
    fails = []

    def check(label, got, want):
        ok = got == want
        print("  %-58s %s" % (label, "ok" if ok else "FAIL got=%r want=%r" % (got, want)))
        if not ok:
            fails.append(label)

    print("rule 1 -- string hash")
    check("strhash('IDS_Description_1')", strhash("IDS_Description_1"), 1767058358)
    check("strhash('List_CarMake') == 0x788FB611", strhash("List_CarMake"), 0x788FB611)
    check("split_ref(make_ref('CarClasses','IDS_DisplayName_0'))",
          split_ref(make_ref("CarClasses", "IDS_DisplayName_0")),
          (strhash("CarClasses"), strhash("IDS_DisplayName_0")))
    check("parse_ref('_&3675260003685615545')", parse_ref("_&3675260003685615545"), 3675260003685615545)
    check("split_ref of that cell hi32", split_ref(parse_ref("_&3675260003685615545"))[0], strhash("CarClasses"))
    check("parse_ref(-1) unsigned", parse_ref(-1), (1 << 64) - 1)

    print("rule 5 -- slider bands")
    check("slider_value(0.5, 10, 20)", slider_value(0.5, 10, 20), 15.0)
    check("slider_value(0.0, -5, 5)  camber min", slider_value(0.0, -5, 5), -5.0)
    check("slider_value(0.73, 4, 4)  LOCKED -> Min", slider_value(0.73, 4.0, 4.0), 4.0)
    check("install_norm(12, 10, 20)", install_norm(12, 10, 20), 0.2)
    check("install_norm(anything, 4, 4) LOCKED -> 0.5", install_norm(99.0, 4.0, 4.0), 0.5)
    check("install_norm(30, 10, 20) clamps to 1.0", install_norm(30, 10, 20), 1.0)
    check("is_locked(4,4) / is_locked(4,5)", (is_locked(4, 4), is_locked(4, 5)), (True, False))

    print("rule 4 -- display PI, against %s" % GAMEDB_PATH)
    gp = args.gamedb or GAMEDB_PATH
    if not os.path.exists(gp):
        print("  SKIPPED: game DB not found")
        fails.append("gamedb missing")
    else:
        g = sqlite3.connect("file:%s?mode=ro" % gp.replace("\\", "/"), uri=True)
        raw = [(r[0], "class%d" % r[0], r[1], r[2]) for r in g.execute(
            "SELECT Id, MaxPerformanceIndex, MaxDisplayPerformanceIndex FROM CarClasses ORDER BY Id")]
        # ref_class column order is (class_id,name,norm_max,pi_max,norm_prev,pi_prev);
        # display_pi wants (class_id,name,norm_prev,pi_prev,norm_max,pi_max).
        classes = [(a[0], a[1], a[4], a[5], a[2], a[3]) for a in build_class_anchors(raw)]
        check("class D lower anchor is (0.0, 99)", (classes[0][2], classes[0][3]), (0.0, 99))
        check("display_pi(0.4762) NSX-R", display_pi(0.4762, classes), 572)
        check("class_of(0.4762) is class 2 (B)", class_of(0.4762, classes)[0], 2)

        cars = list(g.execute(
            "SELECT Id, PerformanceIndex, PI, ClassID FROM Data_Car"
            " WHERE PerformanceIndex IS NOT NULL AND PI IS NOT NULL"))
        exact = [c for c in cars if display_pi(c[1], classes) == c[2]]
        off = [c for c in cars if display_pi(c[1], classes) != c[2]]
        clsbad = [c for c in cars if class_of(c[1], classes)[0] != c[3]]
        print("  Data_Car: %d rows, %d exact, %d off-by-one, %d class mismatches"
              % (len(cars), len(exact), len(off), len(clsbad)))
        check("every off-by-one is +/-1 (never worse)",
              all(abs(display_pi(c[1], classes) - c[2]) == 1 for c in off), True)
        check("ClassID reproduced for every car", len(clsbad), 0)
        # Each miss must be explained by PerformanceIndex being stored to 4 decimals:
        # some norm inside the +/-0.00005 rounding window must yield the stored PI.
        unexplained = []
        for cid, norm, pi, _c in off:
            lo, hi = norm - 5e-5, norm + 5e-5
            if not any(display_pi(lo + (hi - lo) * k / 2000.0, classes) == pi for k in range(2001)):
                unexplained.append((cid, norm, pi))
        check("every off-by-one explained by 4-dp storage of PerformanceIndex", unexplained, [])
        check("exact + explained covers all 660 cars", len(exact) + len(off), len(cars))
        g.close()

    # Round-trip on a throwaway database: schema, bookkeeping, bulk write, and the
    # re-runnability contract every importer must satisfy.
    print("accessor round-trip (throwaway db)")
    tmp = os.path.join(tempfile.gettempdir(), "fh6db_selftest_%d.db" % os.getpid())
    for suffix in ("", "-wal", "-shm"):
        if os.path.exists(tmp + suffix):
            os.remove(tmp + suffix)
    try:
        cx = connect(tmp)
        check("ensure_schema creates", ensure_schema(cx), True)
        check("ensure_schema is idempotent", ensure_schema(cx), False)
        n_tab = cx.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table'"
                           " AND name NOT LIKE 'sqlite_%'").fetchone()[0]
        n_view = cx.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='view'").fetchone()[0]
        check("schema.sql yields 40 tables + 4 views", (n_tab, n_view), (40, 4))
        check("schema_version round-trips", schema_version(cx), SCHEMA_VERSION)

        cols = ("class_id", "name", "norm_max", "pi_max", "norm_prev", "pi_prev")
        raw = [(0, "D", 0.2874, 400), (1, "C", 0.4003, 500), (2, "B", 0.5069, 600),
               (3, "A", 0.6058, 700), (4, "S1", 0.7012, 800), (5, "S2", 0.7931, 900),
               (6, "S3", 0.8862, 998), (7, "X", 1.0, 999)]
        counts = []
        for _ in range(2):                              # twice: row counts must be identical
            rid = run_begin(cx, "derive", "fh6db --selftest")
            n = replace_all(cx, "ref_class", cols, build_class_anchors(raw))
            cx.commit()
            run_end(cx, rid, n_rows=n, ok=1, notes="round-trip")
            counts.append(cx.execute("SELECT COUNT(*) FROM ref_class").fetchone()[0])
        check("replace_all twice -> identical row count", counts, [8, 8])
        check("upsert_many reported 8 rows", n, 8)
        runs = cx.execute("SELECT COUNT(*) FROM import_run WHERE ok=1").fetchone()[0]
        check("import_run recorded both runs closed ok", runs, 2)

        loaded = load_classes(cx)
        check("load_classes returns 8 anchors", len(loaded), 8)
        check("display_pi(0.4762) from the DB's own ref_class", display_pi(0.4762, loaded), 572)
        check("class_of(0.4762) names it B", class_of(0.4762, loaded)[1], "B")
        check("display_pi(0.0) hits the 100 floor", display_pi(0.0, loaded), 100)
        check("display_pi(1.0) is X's 999", display_pi(1.0, loaded), 999)
        check("dict rows accepted by upsert_many",
              upsert_many(cx, "schema_meta", ("key", "value"), [{"key": "t", "value": "1"}]), 1)
        cx.rollback()
        check("integrity_check on the round-trip db",
              [r[0] for r in cx.execute("PRAGMA integrity_check")], ["ok"])
        check("foreign_key_check clean", list(cx.execute("PRAGMA foreign_key_check")), [])
        cx.close()
    finally:
        for suffix in ("", "-wal", "-shm"):
            if os.path.exists(tmp + suffix):
                try:
                    os.remove(tmp + suffix)
                except OSError:
                    pass

    print("\nSELFTEST %s" % ("FAILED: " + ", ".join(fails) if fails else "PASSED"))
    return 1 if fails else 0


def main(argv=None):
    ap = argparse.ArgumentParser(prog="fh6db.py", description=__doc__.split("\n")[0])
    ap.add_argument("--db", help="database path (default $FH6_DB or <repo>/data/fh6.db)")
    ap.add_argument("--schema", help="schema.sql path (default <repo>/db/schema.sql)")
    ap.add_argument("--gamedb", help="FH6_Database.sqlite, for --selftest")
    ap.add_argument("--init", action="store_true", help="create the database from db/schema.sql")
    ap.add_argument("--info", action="store_true", help="table row counts and import_run history")
    ap.add_argument("--check", action="store_true", help="integrity, foreign keys, empty ref_ tables")
    ap.add_argument("--selftest", action="store_true", help="assert the hash / PI / slider rules")
    a = ap.parse_args(argv)
    rc = 0
    ran = False
    if a.init:
        rc |= cmd_init(a); ran = True
    if a.info:
        rc |= cmd_info(a); ran = True
    if a.check:
        rc |= cmd_check(a); ran = True
    if a.selftest:
        rc |= cmd_selftest(a); ran = True
    if not ran:
        ap.print_help()
    return rc


if __name__ == "__main__":
    sys.exit(main())
