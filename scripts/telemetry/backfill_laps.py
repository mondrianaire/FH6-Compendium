#!/usr/bin/env python3
"""LAP-STORE BACKFILL — replay old captures so the lap history is as old as the driving, not as old as the store.

data/laps.db was created after most of the driving happened, so it holds only the sessions analysed since. That
is why the dashboard has no historical traces to show: the store is the ONLY cross-session lap record (course
models keep at most the 10 fastest tunes, one trace each), and it starts empty for every course driven before
the store existed. The captures are still on disk, so the history is recoverable — it just has to be re-derived.

This does NOT reimplement analysis. It runs the real analyze_session.py once per capture, as a subprocess, and
lets it write through its own lap_store.put_laps path. put_laps is idempotent (UNIQUE on route_key+session+cid+t0),
so replaying a capture rewrites its own rows and can never duplicate a lap — a partial run is safe to resume, and
a capture that was already analysed costs time but changes nothing.

    python scripts/telemetry/backfill_laps.py --dry-run        # what WOULD run, with sizes and a runtime estimate
    python scripts/telemetry/backfill_laps.py --limit 5        # the 5 SMALLEST captures — cheap proof it works
    python scripts/telemetry/backfill_laps.py                  # everything

Cost is real and worth stating up front: analysis is parse-bound at ~17.5 MB/s, so the 1.5 GB capture alone is
~86 s and the whole captures/ directory is minutes, not seconds. --dry-run prints the projection before you commit.

TUNE-HASH RE-ATTRIBUTION (--tune-hash) is the cheap second mode: it re-derives ONLY the tune_hash column for the
rows already in the store, from (session, cid, t0) plus the gear ladder in the session JSON, through the same
analyze_session.tune_hash_for the analyzer uses. No capture is replayed, nothing else in the row is touched. It
exists because the attribution used to compare a UTC container stamp against a local session id (~4 h apart),
which left 174 of 306 laps with tune_hash NULL — a rule fix that a full replay would take minutes to apply and
this applies in a second.

    python scripts/telemetry/backfill_laps.py --tune-hash --dry-run   # per-session table of what would change
    python scripts/telemetry/backfill_laps.py --tune-hash             # write the column (only rows that change)
"""
import argparse, glob, gzip, io, json, os, shutil, sqlite3, struct, subprocess, sys, tempfile, time

try: sys.stdout.reconfigure(encoding="utf-8", errors="replace")   # in place: see merge_courses.py
except Exception: pass
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)

import lap_store

ANALYZER = os.path.join(HERE, "analyze_session.py")
# End-to-end analysis throughput, measured on this machine (1.5 GB capture -> ~86 s). Parsing alone runs at
# ~21.5 MB/s, so this constant already carries the ~20% the rest of the analysis adds. A real run reports its
# OWN measured rate as it goes, so the estimate below is only ever the starting guess.
ANALYZE_MB_S = 17.5
DECOMP_MB_S = 400.0     # gzip -> scratch file, measured: 199 MB in 0.42 s
STARTUP_S = 0.8         # python + analyzer import cost, paid once per capture


def uncompressed_mb(path):
    """A .gz stores its uncompressed size in the last 4 bytes (ISIZE). Free, and the only honest basis for an
    ETA — the compressed size understates these captures by 4x."""
    if not path.endswith(".gz"):
        return os.path.getsize(path) / 1048576
    try:
        with open(path, "rb") as f:
            f.seek(-4, 2)
            return struct.unpack("<I", f.read(4))[0] / 1048576   # mod 2^32; no capture is near 4 GB
    except Exception:
        return os.path.getsize(path) * 4 / 1048576               # typical ratio, if the trailer is unreadable


def captures():
    """Every capture, smallest first — so --limit N is the cheapest N, not an arbitrary N."""
    paths = sorted(set(glob.glob(os.path.join(ROOT, "captures", "*.csv")) +
                       glob.glob(os.path.join(ROOT, "captures", "*.csv.gz"))))
    out = []
    for p in paths:
        mb = uncompressed_mb(p)
        if os.path.getsize(p) == 0 or mb <= 0:
            continue                                             # an aborted capture: no header, nothing to analyse
        out.append({"path": p, "name": os.path.basename(p), "mb": mb, "disk_mb": os.path.getsize(p) / 1048576,
                    "gz": p.endswith(".gz")})
    out.sort(key=lambda c: c["mb"])
    return out


def eta_s(c):
    return STARTUP_S + c["mb"] / ANALYZE_MB_S + (c["mb"] / DECOMP_MB_S if c["gz"] else 0.0)


def mmss(s):
    return f"{int(s) // 60}m{int(s) % 60:02d}s"


def sz(x):
    """A header-only capture must not read as '0 MB' — an aborted run is worth seeing in the listing."""
    return f"{x:,.1f}" if x < 10 else f"{x:,.0f}"


def summary():
    """Lap-store shape. Reads only — a missing db reports zeros rather than being created, so --dry-run really
    does write nothing."""
    p = lap_store.db_path(ROOT)
    if not os.path.exists(p):
        return {"laps": 0, "courses": 0, "builds": 0, "sessions": 0, "by_class": {}, "bytes": 0}
    cx = sqlite3.connect(f"file:{p}?mode=ro", uri=True, timeout=10)
    try:
        n, c, b, s = cx.execute("""SELECT COUNT(*), COUNT(DISTINCT route_key), COUNT(DISTINCT build_id),
                                          COUNT(DISTINCT session) FROM lap_traces""").fetchone()
        by = dict(cx.execute("SELECT class, COUNT(*) FROM lap_traces GROUP BY class ORDER BY 2 DESC").fetchall())
    finally:
        cx.close()
    return {"laps": n, "courses": c, "builds": b, "sessions": s, "by_class": by, "bytes": os.path.getsize(p)}


def print_summary(label, st):
    cls = " · ".join(f"{k or '?'}:{v}" for k, v in st["by_class"].items()) or "—"
    print(f"  {label:<7} {st['laps']:>5} laps · {st['courses']:>3} courses · {st['builds']:>3} builds · "
          f"{st['sessions']:>3} sessions · {st['bytes']/1048576:.1f} MB")
    print(f"  {'':<7} classes: {cls}")


def analyse(c, tmpdir):
    """Run the real analyzer on one capture. A .gz is expanded to a scratch file first — the analyzer opens a
    path, and the original must never be touched. Returns (ok, seconds, message)."""
    src = c["path"]
    tmp = None
    if c["gz"]:
        # Strip only the .gz: the analyzer derives the session id from the filename, so the scratch copy must
        # keep the capture's own stem or the backfill would mint a second session id for the same driving.
        tmp = os.path.join(tmpdir, c["name"][:-3])
        with gzip.open(src, "rb") as f, open(tmp, "wb") as g:
            shutil.copyfileobj(f, g, 1 << 20)
        src = tmp
    t0 = time.perf_counter()
    try:
        # Timeout scales with size (5x the projection) so a 1.5 GB capture is not killed for being large, while
        # a wedged analysis still cannot stall the whole backfill.
        r = subprocess.run([sys.executable, ANALYZER, src], cwd=ROOT, capture_output=True,
                           timeout=max(120.0, eta_s(c) * 5))
        dt = time.perf_counter() - t0
        if r.returncode != 0:
            err = (r.stderr or b"").decode("utf-8", "replace").strip().splitlines()
            return False, dt, f"exit {r.returncode}: {err[-1] if err else 'no stderr'}"
        return True, dt, ""
    except subprocess.TimeoutExpired:
        return False, time.perf_counter() - t0, "timed out"
    except Exception as e:
        return False, time.perf_counter() - t0, repr(e)
    finally:
        if tmp and os.path.exists(tmp):
            os.remove(tmp)


def _session_gears(sid, cache):
    """{cid: measured gear count} for a session, from its JSON. sig.gear_count is len(gears) by construction
    (checked equal on all 344 cars in data/sessions on 2026-09-02); the ladder length is the fallback. None when
    the session has no JSON — then its rows are left alone, because the gear check cannot be run without it."""
    if sid in cache:
        return cache[sid]
    p = os.path.join(ROOT, "data", "sessions", sid + ".json")
    out = None
    if os.path.exists(p):
        try:
            with open(p, encoding="utf-8") as f:
                cars = json.load(f).get("cars") or []
            out = {}
            for c in cars:
                sig = c.get("sig") or {}
                g = sig.get("gear_count")
                out[str(c.get("id"))] = int(g) if g else len(c.get("gears") or [])
        except Exception:
            out = None
    cache[sid] = out
    return out


def retune(dry_run):
    """Re-derive tune_hash for every stored lap and report / write the differences. Reads through a read-only
    connection first; the write phase touches only tune_hash on the rows that changed."""
    import analyze_session as A
    p = lap_store.db_path(ROOT)
    if not os.path.exists(p):
        print("no lap store"); return
    cx = sqlite3.connect(f"file:{p}?mode=ro", uri=True, timeout=10)
    try:
        rows = cx.execute("SELECT id, session, cid, t0, tune_hash FROM lap_traces ORDER BY session, cid, t0").fetchall()
    finally:
        cx.close()
    cache = {}; changes = []; per = {}
    skipped = 0
    for rid, sid, cid, t0, old in rows:
        st = per.setdefault(sid, {"rows": 0, "null_before": 0, "null_after": 0, "resolved": 0, "corrected": 0, "dropped": 0, "skipped": 0})
        st["rows"] += 1
        if old is None: st["null_before"] += 1
        gears = _session_gears(sid, cache)
        if gears is None:
            st["skipped"] += 1; skipped += 1
            if old is None: st["null_after"] += 1
            continue
        new = A.tune_hash_for(cid, sid, t0, gears.get(str(cid), 0))
        if new is None: st["null_after"] += 1
        if new != old:
            changes.append((rid, sid, cid, t0, old, new))
            if old is None and new is not None: st["resolved"] += 1
            elif old is not None and new is None: st["dropped"] += 1
            else: st["corrected"] += 1
    tot = {k: sum(v[k] for v in per.values()) for k in ("rows", "null_before", "null_after", "resolved", "corrected", "dropped", "skipped")}
    print(f"\nTUNE-HASH RE-ATTRIBUTION — {tot['rows']} stored laps · {len(per)} sessions · "
          f"{'DRY RUN' if dry_run else 'WRITING'}")
    print(f"\n  {'session':<22}{'rows':>5}{'NULL→':>7}{'→NULL':>7}{'resolved':>10}{'corrected':>11}{'dropped':>9}")
    for sid in sorted(per):
        st = per[sid]
        if not (st["resolved"] or st["corrected"] or st["dropped"] or st["null_before"] or st["skipped"]):
            continue
        flag = f"  (no session JSON: {st['skipped']} left alone)" if st["skipped"] else ""
        print(f"  {sid:<22}{st['rows']:>5}{st['null_before']:>7}{st['null_after']:>7}{st['resolved']:>10}{st['corrected']:>11}{st['dropped']:>9}{flag}")
    print(f"  {'TOTAL':<22}{tot['rows']:>5}{tot['null_before']:>7}{tot['null_after']:>7}{tot['resolved']:>10}{tot['corrected']:>11}{tot['dropped']:>9}")
    print(f"\n  tune_hash NULL: {tot['null_before']} -> {tot['null_after']} of {tot['rows']} · "
          f"{tot['resolved']} resolved · {tot['corrected']} re-attributed to a different save · {tot['dropped']} now rejected"
          + (f" · {skipped} skipped (no session JSON)" if skipped else ""))
    if dry_run:
        print("  DRY RUN — nothing written. Re-run without --dry-run to write the column.\n")
        return
    if not changes:
        print("  nothing to write.\n"); return
    with lap_store._LOCK:
        cx = lap_store.connect(ROOT)
        try:
            cx.executemany("UPDATE lap_traces SET tune_hash=? WHERE id=?", [(new, rid) for rid, *_r, new in changes])
            cx.commit()
        finally:
            cx.close()
    print(f"  wrote tune_hash on {len(changes)} rows.\n")


def main():
    ap = argparse.ArgumentParser(description="Replay captures into the lap store.")
    ap.add_argument("--dry-run", action="store_true", help="list what would run, with sizes and an ETA; write nothing")
    ap.add_argument("--limit", type=int, default=0, metavar="N", help="only the N smallest captures")
    ap.add_argument("--tune-hash", action="store_true",
                    help="re-attribute ONLY tune_hash on stored rows (no replay); honours --dry-run")
    a = ap.parse_args()

    if a.tune_hash:
        retune(a.dry_run)
        return

    caps = captures()
    if a.limit > 0:
        caps = caps[:a.limit]
    if not caps:
        print("no captures to replay")
        return

    tot_mb = sum(c["mb"] for c in caps)
    tot_eta = sum(eta_s(c) for c in caps)
    before = summary()
    print(f"\nLAP-STORE BACKFILL — {len(caps)} captures · {tot_mb/1024:.2f} GB uncompressed")
    print_summary("before", before)

    if a.dry_run:
        print(f"\n  {'capture':<28}{'size':>10}{'on disk':>10}{'est':>8}")
        for c in caps:
            disk = f"{sz(c['disk_mb'])} MB" if c["gz"] else "—"
            print(f"  {c['name']:<28}{sz(c['mb']):>7} MB{disk:>10}{eta_s(c):>7.0f}s")
        print(f"\n  projected total: {mmss(tot_eta)} at {ANALYZE_MB_S} MB/s "
              f"(measured end-to-end; parsing is ~80% of it)")
        print("  DRY RUN — nothing written. Re-run without --dry-run to backfill.\n")
        return

    print(f"\n  estimated {mmss(tot_eta)} · analysing smallest first\n")
    done_mb = 0.0
    t_start = time.perf_counter()
    failed = []
    for i, c in enumerate(caps, 1):
        prev = summary()["laps"]
        ok, dt, msg = analyse(c, tempfile.gettempdir())
        done_mb += c["mb"]
        # The projection is re-derived from what THIS machine actually just did, so the remaining estimate
        # converges on the truth instead of restating the constant.
        rate = done_mb / max(1e-6, time.perf_counter() - t_start)
        left = mmss(sum(cc["mb"] for cc in caps[i:]) / max(1e-6, rate))
        if ok:
            print(f"  [{i:>2}/{len(caps)}] {c['name']:<28}{sz(c['mb']):>6} MB {dt:>6.1f}s  "
                  f"+{summary()['laps'] - prev:>3} laps   ~{left} left")
        else:
            failed.append((c["name"], msg))
            print(f"  [{i:>2}/{len(caps)}] {c['name']:<28}{sz(c['mb']):>6} MB {dt:>6.1f}s  SKIPPED — {msg}")

    after = summary()
    print(f"\n  finished in {mmss(time.perf_counter() - t_start)} · {rate:.1f} MB/s actual")
    print_summary("before", before)
    print_summary("after", after)
    print(f"  {'':<7} delta: +{after['laps'] - before['laps']} laps · "
          f"+{after['courses'] - before['courses']} courses · +{after['builds'] - before['builds']} builds")
    if failed:
        print(f"\n  {len(failed)} capture(s) skipped:")
        for n, m in failed:
            print(f"    {n}: {m}")
    print()


if __name__ == "__main__":
    main()
