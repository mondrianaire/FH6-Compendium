#!/usr/bin/env python3
"""LAP TRACE STORE — every lap you drive, kept.

Why a database and not the course model: the model JSON is read-modify-written on EVERY analysis (every
20-90 s). Growing an unbounded lap history inside it would rewrite a multi-MB document continuously — the same
shape of problem as the 600 MB capture re-read. This store is append-only, indexed, and stdlib-only (sqlite3
ships with Python; no server, no dependency, one file at data/laps.db).

What it keeps: every lap that COVERS the course (a real lap, not an aborted stub). Competitiveness is judged
at READ time, never at write time — the 107% rule (motorsport's own: a lap within 107% of the reference is a
competitive lap) against the best time that build has ever set here. Storing everything and filtering on read
means a later, faster lap re-rates history instead of destroying it: your improvement stays visible.

Idempotent: re-analysis of the same session replaces its own rows (UNIQUE on route_key+session+cid+t0), so the
20-second cadence cannot duplicate a lap.

VOID laps: in a timed run contact invalidates the time — the lap is not slower, it is VOID. A void lap must
never define a build's reference best, or one lucky "fast" impacted lap silently mis-rates every other lap on
the course through the 107% rule. But a void lap's TIME is the only invalid part: its grip, cornering and
racing-line data are as real as any other lap's. So voidness is filtered out of TIMING and kept for TRACES —
void rows are still returned, carrying `void` and their `impacts` count, for the UI to strike through.
"""
import json, os, sqlite3, threading

_LOCK = threading.Lock()
COMPETITIVE = 1.07   # the 107% rule


def db_path(root):
    return os.path.join(root, "data", "laps.db")


def connect(root):
    p = db_path(root)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    cx = sqlite3.connect(p, timeout=10)
    cx.execute("PRAGMA journal_mode=WAL")          # the analyzer writes while the daemon reads
    cx.execute("PRAGMA synchronous=NORMAL")
    cx.execute("""CREATE TABLE IF NOT EXISTS lap_traces (
        id INTEGER PRIMARY KEY,
        route_key TEXT NOT NULL, session TEXT NOT NULL, cid TEXT NOT NULL,
        t0 REAL NOT NULL, lap_s REAL, arc_m REAL,
        build_id TEXT, class TEXT, pi INTEGER, drivetrain TEXT,
        solo INTEGER DEFAULT 0,                     -- a Rivals/time-trial lap: no traffic, no contact
        pts TEXT NOT NULL,                          -- [[arc_m, mph, grip, x, z], ...]
        impacts INTEGER DEFAULT 0,                  -- grip-code-4 points in this lap: contact / jolt
        void INTEGER DEFAULT 0,                     -- 1 = time invalidated by contact (timed run only)
        UNIQUE (route_key, session, cid, t0))""")
    cx.execute("CREATE INDEX IF NOT EXISTS ix_lap_route ON lap_traces(route_key, cid, lap_s)")
    _migrate(cx)
    return cx


def _migrate(cx):
    """Bring an existing lap_traces up to the current column set. CREATE TABLE IF NOT EXISTS is a no-op on a
    file that already has the table, so new columns must be ALTERed in. Capability check, not a version
    counter: we ask the table what it has and add only what is missing, so a half-applied migration self-heals
    on the next open and running the old code against a migrated file still works (the defaults fill in).
    ALTER TABLE ADD COLUMN with a constant DEFAULT is metadata-only in SQLite — no row rewrite, no data touched."""
    have = {r[1] for r in cx.execute("PRAGMA table_info(lap_traces)")}
    for col, ddl in (("impacts", "impacts INTEGER DEFAULT 0"), ("void", "void INTEGER DEFAULT 0")):
        if col not in have:
            cx.execute("ALTER TABLE lap_traces ADD COLUMN " + ddl)
            cx.commit()


def put_laps(root, rows):
    """rows: dicts with route_key, session, cid, t0, lap_s, arc_m, build_id, class, pi, drivetrain, solo, pts,
    and optionally impacts + void (both default to 0 — an older caller that does not know about contact still
    writes a valid row). The named-parameter bind raises on a missing key, so the defaults are applied here in
    Python rather than left to the column DEFAULT."""
    if not rows:
        return 0
    with _LOCK:
        cx = connect(root)
        try:
            cx.executemany(
                """INSERT INTO lap_traces (route_key, session, cid, t0, lap_s, arc_m, build_id, class, pi, drivetrain, solo, pts, impacts, void)
                   VALUES (:route_key,:session,:cid,:t0,:lap_s,:arc_m,:build_id,:class,:pi,:drivetrain,:solo,:pts,:impacts,:void)
                   ON CONFLICT(route_key, session, cid, t0) DO UPDATE SET
                     lap_s=excluded.lap_s, arc_m=excluded.arc_m, pts=excluded.pts, solo=excluded.solo,
                     build_id=excluded.build_id, class=excluded.class, pi=excluded.pi, drivetrain=excluded.drivetrain,
                     impacts=excluded.impacts, void=excluded.void""",
                # re-analysis runs every 20-90 s: a lap re-scored as clean must be able to un-void itself, so
                # impacts/void are overwritten on conflict like every other re-derived field.
                [dict(r, pts=json.dumps(r["pts"], separators=(",", ":")),
                      impacts=int(r.get("impacts") or 0), void=1 if r.get("void") else 0) for r in rows])
            cx.commit()
            return len(rows)
        finally:
            cx.close()


def get_laps(root, route_key, cls=None, competitive_only=True, limit=400):
    """Competitive laps for a course, newest-fastest first. Reference = each build's own best here, so a slower
    car's good laps still qualify; `competitive` is also returned per row so callers can show the rest greyed.

    competitive_only=True now means "laps worth comparing times against, PLUS every void lap" — a void lap is
    never competitive, but dropping it would hide contact from the UI and lose a perfectly good grip trace.
    Callers distinguish them by the returned `void` flag: strike the time, keep the line on the map."""
    if not os.path.exists(db_path(root)):
        return []
    with _LOCK:
        cx = connect(root)
        try:
            cx.row_factory = sqlite3.Row
            q = "SELECT * FROM lap_traces WHERE route_key=?"
            args = [route_key]
            if cls:
                q += " AND class=?"
                args.append(cls)
            q += " ORDER BY lap_s IS NULL, lap_s LIMIT ?"
            args.append(int(limit) * 3)
            rows = [dict(r) for r in cx.execute(q, args).fetchall()]
        finally:
            cx.close()
    for r in rows:                                  # legacy rows predate the columns; normalise once, up front
        r["impacts"] = int(r.get("impacts") or 0)
        r["void"] = bool(r.get("void"))
    # A PARTIAL LAP IS NOT A FAST LAP. Coverage must be judged against the COURSE, not against whatever this
    # session happened to drive: a 492 m window on a 1030 m circuit is correctly timed at 15.09 s and 72.9 mph,
    # but as a reference best it makes every real 30 s lap 200% off, and one route dropped to a single
    # "competitive" lap out of 84. The route's own median arc IS the course length -- no caller has to say so.
    _arcs = sorted(r["arc_m"] for r in rows if r.get("arc_m"))
    full = (_arcs[len(_arcs) // 2] * 0.9) if _arcs else 0
    best = {}
    for r in rows:
        t = r.get("lap_s")
        r["partial"] = bool(full and (r.get("arc_m") or 0) < full)
        # a void time can never define the reference: it was set with contact, and the 107% rule measured
        # against it would mis-rate every clean lap the build has ever set here. Nor can a partial lap.
        if t and not r["void"] and not r["partial"] and (r["cid"] not in best or t < best[r["cid"]]):
            best[r["cid"]] = t
    out = []
    for r in rows:
        ref = best.get(r["cid"])
        r["competitive"] = bool(r.get("lap_s") and ref and not r["void"] and not r["partial"] and r["lap_s"] <= ref * COMPETITIVE)
        r["pct_off"] = round((r["lap_s"] / ref - 1) * 100, 1) if (r.get("lap_s") and ref) else None
        try:
            r["pts"] = json.loads(r["pts"])
        except Exception:
            r["pts"] = []
        # void laps survive the filter: their TIME is invalid, their grip/cornering trace is not.
        if competitive_only and not r["competitive"] and not r["void"]:
            continue
        out.append(r)
    return out[:limit]


def stats(root):
    if not os.path.exists(db_path(root)):
        return {"laps": 0, "courses": 0, "bytes": 0}
    with _LOCK:
        cx = connect(root)
        try:
            n = cx.execute("SELECT COUNT(*) FROM lap_traces").fetchone()[0]
            c = cx.execute("SELECT COUNT(DISTINCT route_key) FROM lap_traces").fetchone()[0]
        finally:
            cx.close()
    return {"laps": n, "courses": c, "bytes": os.path.getsize(db_path(root))}
