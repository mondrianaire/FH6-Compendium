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
        UNIQUE (route_key, session, cid, t0))""")
    cx.execute("CREATE INDEX IF NOT EXISTS ix_lap_route ON lap_traces(route_key, cid, lap_s)")
    return cx


def put_laps(root, rows):
    """rows: dicts with route_key, session, cid, t0, lap_s, arc_m, build_id, class, pi, drivetrain, solo, pts."""
    if not rows:
        return 0
    with _LOCK:
        cx = connect(root)
        try:
            cx.executemany(
                """INSERT INTO lap_traces (route_key, session, cid, t0, lap_s, arc_m, build_id, class, pi, drivetrain, solo, pts)
                   VALUES (:route_key,:session,:cid,:t0,:lap_s,:arc_m,:build_id,:class,:pi,:drivetrain,:solo,:pts)
                   ON CONFLICT(route_key, session, cid, t0) DO UPDATE SET
                     lap_s=excluded.lap_s, arc_m=excluded.arc_m, pts=excluded.pts, solo=excluded.solo,
                     build_id=excluded.build_id, class=excluded.class, pi=excluded.pi, drivetrain=excluded.drivetrain""",
                [dict(r, pts=json.dumps(r["pts"], separators=(",", ":"))) for r in rows])
            cx.commit()
            return len(rows)
        finally:
            cx.close()


def get_laps(root, route_key, cls=None, competitive_only=True, limit=400):
    """Competitive laps for a course, newest-fastest first. Reference = each build's own best here, so a slower
    car's good laps still qualify; `competitive` is also returned per row so callers can show the rest greyed."""
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
    best = {}
    for r in rows:
        t = r.get("lap_s")
        if t and (r["cid"] not in best or t < best[r["cid"]]):
            best[r["cid"]] = t
    out = []
    for r in rows:
        ref = best.get(r["cid"])
        r["competitive"] = bool(r.get("lap_s") and ref and r["lap_s"] <= ref * COMPETITIVE)
        r["pct_off"] = round((r["lap_s"] / ref - 1) * 100, 1) if (r.get("lap_s") and ref) else None
        try:
            r["pts"] = json.loads(r["pts"])
        except Exception:
            r["pts"] = []
        if competitive_only and not r["competitive"]:
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
