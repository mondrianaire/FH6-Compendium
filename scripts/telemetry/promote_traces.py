#!/usr/bin/env python3
"""Install the best FULL-COVERAGE lap from data/laps.db as each course model's speed trace.

    python scripts/telemetry/promote_traces.py --dry
    python scripts/telemetry/promote_traces.py

WHY. The dashboard draws its speed trace from model["speed_traces"], but every lap the game gives us is written
to data/laps.db, and only the analyzer ever moves one across. That gap is invisible until something empties the
model side: the Colossus was rebuilt from a confirmed 369.2 s lap -- start/finish closing at 3 m, LastLap 369.215
agreeing with the clock, the position arc agreeing with the independent speed channel to 100.0% -- and the course
still showed no trace at all, because the lap sat in the store the model does not read. A lap you drove, that the
game timed and we verified, must not be invisible for a bookkeeping reason.

THE RULE IS THE ONE EVERYTHING ELSE USES. Coverage first, time second. A short run is quick BECAUSE it is short,
so ranking on time alone lets a fragment take a slot it can never lose; analyze_session retires traces under 0.7
of the course, merge_courses judges coverage before time, and repair_persisted_state clears what was written
before either rule existed. This is the fourth place that rule has to hold, so it is stated here the same way.

WHAT IT WILL NOT DO. It never invents a trace, never promotes one covering under 0.7 of the mapped course, and
never overwrites a stored trace that is better by that rule. A map made of disconnected scraps cannot say what
coverage means, so those courses are skipped rather than guessed at. Idempotent: a second run changes nothing.
"""
import argparse, glob, io, json, math, os, sqlite3, sys

try: sys.stdout.reconfigure(encoding="utf-8", errors="replace")   # in place: see merge_courses.py
except Exception: pass
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
COVER = 0.70
WIDE = 1.45


def span(pts):
    """Road covered, piece-aware: a stitched trace resets its arc mid-way and pts[-1][0] under-reads."""
    tot = 0.0; prev = None; st = None
    for q in pts or []:
        a = q[0]
        if prev is None: st = a
        elif a < prev: tot += prev - st; st = a
        prev = a
    return tot + (prev - st) if prev is not None else 0.0


def beats(rec, cur):
    """Coverage first, then time -- identical to merge_courses._trace_beats."""
    if cur is None:
        return True
    sr, sc = span(rec.get("pts")), span(cur.get("pts"))
    if sc and sr and (sr < 0.85 * sc or sr > 1.18 * sc):
        return sr > sc
    return (rec.get("lap_s") or 9e9) < (cur.get("lap_s") or 9e9)


def fragmented(g):
    ps = g.get("paths") or []
    gaps = [math.hypot(ps[i][-1][0] - ps[i + 1][0][0], ps[i][-1][1] - ps[i + 1][0][1])
            for i in range(len(ps) - 1) if ps[i] and ps[i + 1]]
    return bool(gaps) and max(gaps) > (g.get("length_m") or 0)


def promote_into(m, key, cx):
    """Install the best covering laps for `key` into model `m`. Returns a list of one-line descriptions.

    THE ONE PLACE THIS RULE LIVES. The analyzer calls it on the model in memory before its atomic write, and the
    CLI below calls it on each model on disk, so there is no second copy to drift. Coverage first, then time,
    bounded at both ends; a scrap map is skipped because it cannot say what coverage means.
    """
    g = m.get("geometry") or {}
    L = g.get("length_m") or 0
    if not L or fragmented(g):
        return []
    cols = {r[1] for r in cx.execute("PRAGMA table_info(lap_traces)")}
    st = m.setdefault("speed_traces", {})
    done = []
    for r in cx.execute("SELECT * FROM lap_traces WHERE route_key=?", (key,)):
        try:
            pts = json.loads(r["pts"]) if r["pts"] else []
        except Exception:
            continue
        sp = span(pts)
        if sp < COVER * L or sp >= WIDE * L:
            continue
        # A LAP TIME OF ZERO IS NOT A FAST LAP. The store keeps lap_s as reported, and an unfinished or untimed
        # run arrives as 0.0 -- which on a plain `or 9e9` guard is falsy and ranks last by luck rather than by
        # rule. Say it once, here, so the record carries "no time" instead of "0.000 s".
        rec = {"lap_s": (r["lap_s"] if (r["lap_s"] or 0) > 0 else None), "session": r["session"], "pts": pts}
        for f in ("build_id", "class", "pi", "drivetrain", "tune_hash", "solo", "impacts", "void"):
            if f in cols and r[f] is not None:
                rec[f] = r[f]
        if beats(rec, st.get(r["cid"])):
            st[r["cid"]] = rec
            done.append("%s %.1f s (%.2f mi)" % (r["cid"], r["lap_s"] or 0, sp / 1609.344))
    return done



def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry", action="store_true")
    a = ap.parse_args()
    db = os.path.join(ROOT, "data", "laps.db")
    cx = sqlite3.connect(db); cx.row_factory = sqlite3.Row
    cols = {r[1] for r in cx.execute("PRAGMA table_info(lap_traces)")}
    n_c = n_t = 0
    for p in sorted(glob.glob(os.path.join(ROOT, "data", "courses", "*.json"))):
        m = json.load(open(p, encoding="utf-8"))
        g = m.get("geometry") or {}
        L = g.get("length_m") or 0
        key = os.path.basename(p)[:-5]
        if not L or fragmented(g):
            continue
        changed = promote_into(m, key, cx)
        if changed:
            n_c += 1; n_t += len(changed)
            print("  %-22s +%d trace(s): %s" % (key, len(changed), "; ".join(changed[:3])))
            if not a.dry:
                json.dump(m, open(p, "w", encoding="utf-8"), indent=2)
    cx.close()
    print("\n%s: %d course(s) · %d trace(s) promoted" % ("WOULD PROMOTE" if a.dry else "PROMOTED", n_c, n_t))
    if not n_c:
        print("nothing to do — every course already shows the best covering lap the store holds")


if __name__ == "__main__":
    main()
