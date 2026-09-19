#!/usr/bin/env python3
"""ONE-SHOT: bring persisted state back inside the invariants the audit now enforces.

    python scripts/telemetry/repair_persisted_state.py --dry
    python scripts/telemetry/repair_persisted_state.py

Three repairs, all the same shape: a field that says something impossible, and that says it permanently because
the write path only ever moves it one way. Each repair DELETES the impossible value rather than inventing a
replacement — the next honest measurement fills it in correctly, and a missing field is a state every reader
already handles, while a wrong one is not.

WHY. `best_laps` and `visits[].best_lap` are improve-only, guarded only by "> 0". A single absurd value therefore
latches as the course's headline record and stays there until the SAME car happens to drive the SAME course again
and beat it. Two are live on disk right now: 200_-6000 is showing a track record of 231307.938 s (64.3 HOURS) and
-1850_1550 43840.992 s (12.2 h), both from config 2997|1|8|700. The largest genuine lap anywhere in the data is
208.6 s, so there is no judgement call here -- a 17x margin separates the healthy population from the corruption.

WHAT IT DOES. Removes any best_laps entry, visits[].best_lap or speed_traces[].lap_s outside 5 s .. 1 h. It does
not invent a replacement: the field goes away, and the next real lap that car sets there fills it correctly. A
visit keeps its lap COUNT and its session -- only the impossible time is dropped -- so no history is lost.

The 5 s floor is clean today and is enforced anyway, because the two directions do not heal alike: an absurdly
LARGE time is beaten by the next honest lap, an absurdly SMALL one can never be beaten and so is permanent.

2. MULTI-LAP SPEED TRACES. A speed_traces[cid] is meant to be ONE lap plotted against the course. Four span
   1.56x-2.45x their map (-4750_-1550 has 4800 m of trace on a 1956 m road, and all three of its traces are like
   this). These are actively destructive rather than merely wrong: _clen falls back to max(trace span) when the
   geometry carries no length_m, so one merged trace makes every honest trace measure short and the retirement
   loop deletes the good ones. Dropped whole — a course with no valid single-lap trace should show none.

3. NON-POSITIVE ROUTE LENGTHS. routes.json length_m is minted unclamped, so -3050_1050 carries -21 m and
   -3250_500 carries 0. Both are removed rather than zeroed: the gates that read it (`>= 200` enables the
   reversed-heading rejection, `< 600` marks a stub) already treat a missing value exactly as they treat these,
   so this changes no behaviour — it only stops the file asserting something impossible. The next event through
   that route sets it correctly via the same max().
"""
import argparse
import sqlite3
import math, glob, io, json, os, sys

try: sys.stdout.reconfigure(encoding="utf-8", errors="replace")   # in place: see merge_courses.py
except Exception: pass
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
LO, HI = 5.0, 3600.0


def bad(t):
    return t is not None and (t >= HI or 0 < t < LO)


def _span(pts):
    """Arc span of a trace, PIECE-AWARE: pts[-1][0] under-reads by ~1950 m where the arc resets mid-trace."""
    tot = 0.0; prev = None; st = None
    for q in pts or []:
        a = q[0]
        if prev is None: st = a
        elif a < prev: tot += prev - st; st = a
        prev = a
    return tot + (prev - st) if prev is not None else 0.0


def repair(m):
    """Mutates `m`; returns a list of human-readable descriptions of what was dropped."""
    hits = []
    bl = m.get("best_laps") or {}
    for cid in [c for c, v in bl.items() if bad((v or {}).get("best_lap"))]:
        hits.append("best_laps[%s] = %.3f s" % (cid, bl[cid]["best_lap"]))
        del bl[cid]
    for i, v in enumerate(m.get("visits") or []):
        if bad((v or {}).get("best_lap")):
            hits.append("visits[%d].best_lap = %.3f s" % (i, v["best_lap"]))
            v.pop("best_lap", None)
    st = m.get("speed_traces") or {}
    for cid, v in st.items():
        if bad((v or {}).get("lap_s")):
            hits.append("speed_traces[%s].lap_s = %.3f s" % (cid, v["lap_s"]))
            v.pop("lap_s", None)
    # a trace that covers more road than the map is not a lap of it
    L = (m.get("geometry") or {}).get("length_m") or 0
    # ...and neither is one that covers far too little. A stored trace used to improve on lap TIME alone, in the
    # analyzer AND in the merger, so a fragment was quick because it was short, therefore never beaten, therefore
    # permanent: a 364 m trace claiming a 15.3 s lap held the slot on the 1840 m -2350_-7550 against a real 71.7 s
    # lap. That is 269 mph. The analyzer retires these at 0.7 of the course and the merger now does too; this
    # clears the ones already written, using the same fraction so all three agree on what a trace is.
    # A map made of disconnected scraps cannot judge coverage, so it does not get a vote here.
    _ps = (m.get("geometry") or {}).get("paths") or []
    _gaps = [math.hypot(_ps[i][-1][0] - _ps[i + 1][0][0], _ps[i][-1][1] - _ps[i + 1][0][1])
             for i in range(len(_ps) - 1) if _ps[i] and _ps[i + 1]]
    _fragmented = bool(_gaps) and max(_gaps) > (L or 0)
    if L and not _fragmented:
        for cid in [c for c, v in st.items() if _span((v or {}).get("pts")) / L >= 1.45]:
            hits.append("speed_traces[%s] spans %.0f m on a %.0f m map (%.2fx)"
                        % (cid, _span(st[cid]["pts"]), L, _span(st[cid]["pts"]) / L))
            del st[cid]
    if L and not _fragmented:
        for cid in [c for c, v in st.items() if 0 < _span((v or {}).get("pts")) < 0.7 * L]:
            hits.append("speed_traces[%s] covers only %.0f m of the %.0f m course (%.0f%%) — a fragment holding "
                        "the slot on time" % (cid, _span(st[cid]["pts"]), L, 100 * _span(st[cid]["pts"]) / L))
            del st[cid]
    # A TRACE THAT CONTRADICTS ITS OWN SPEED IS NOT DESCRIBING THIS LAP. A trace holds both the road it
    # covered and the speed it covered it at, so its own mph integrated over its own arc reproduces its own
    # lap time -- 29 of 33 agree to a fraction of a second. The four that do not include Edamame's 21.088 s,
    # which is FASTER than that course's 29.376 s track record and was being shown as the lap to beat.
    # Cleared to null, not to the integrated estimate: null honestly says "not known", where a computed
    # number would be indistinguishable from one the game reported.
    for cid, v in list(st.items()):
        pts = (v or {}).get("pts") or []
        ls = (v or {}).get("lap_s")
        if len(pts) < 30 or not ls or ls <= 0:
            continue
        t = 0.0
        for i in range(1, len(pts)):
            d = pts[i][0] - pts[i - 1][0]
            mph = (pts[i][1] + pts[i - 1][1]) / 2.0
            if d > 0 and mph > 1:
                t += d / (mph * 0.44704)
        if t > 1 and abs(ls - t) / t > 0.25:
            hits.append("speed_traces[%s].lap_s = %.2f s but its own speed gives %.1f s (%.0f%% out)"
                        % (cid, ls, t, 100 * abs(ls - t) / t))
            v["lap_s"] = None
    # A LAP THAT IS NOT ON THIS ROAD IS NOT THIS COURSE'S LAP. geometry.lap_paths is what the audit's
    # lap-off-map check reads, and an imported pre-worktree model carried two paths whose start points sit
    # 2.5 km apart -- one on the model's own road, one on a different one entirely. The audit can only say
    # "two different roads in one model"; this removes the path that is not on the map, which is the half of
    # the model that is actually wrong. Judged against the map, never against the other lap: a course is the
    # accumulated road, not whichever lap happens to be listed first.
    _g = m.get("geometry") or {}
    _gp = [(q[0], q[1]) for q in (_g.get("path") or [])]
    _lps = _g.get("lap_paths") or []
    if _gp and len(_lps) > 1:
        _cel = {}
        for _x, _z in _gp:
            _cel.setdefault((int(_x // 30), int(_z // 30)), []).append((_x, _z))
        def _on(_x, _z):
            _cx, _cz = int(_x // 30), int(_z // 30)
            for _dx in (-1, 0, 1):
                for _dz in (-1, 0, 1):
                    for _q in _cel.get((_cx + _dx, _cz + _dz), []):
                        if (_q[0] - _x) ** 2 + (_q[1] - _z) ** 2 <= 900:
                            return True
            return False
        _scored = []
        for _lp in _lps:
            _pts = [(q[0], q[1]) for q in (_lp.get("pts") or [])]
            _f = (sum(1 for _x, _z in _pts[::3] if _on(_x, _z)) / max(1, len(_pts[::3]))) if _pts else 1.0
            _scored.append((_lp, _f))
        # IF EVERY LAP DISAGREES WITH THE MAP, THE MAP IS THE ODD ONE OUT. Dropping the laps then would delete
        # the evidence and keep the thing the evidence contradicts -- this project's oldest mistake, pointing
        # the other way. Measured: 4250_-5250 scores 40% and 41% on its own map, so BOTH of its laps disagree
        # and neither is the intruder; loop_test_loop scores 7% on its single path. A lap is only an intruder
        # when some other lap on the same model is squarely on the road, which is what makes it the outlier
        # rather than the majority.
        if any(_f >= 0.8 for _, _f in _scored):
            _keep = []
            for _lp, _f in _scored:
                if _f < 0.5:
                    hits.append("geometry.lap_paths[ev=%s lap=%s] lies %.0f%% on this course's own map, while "
                                "another lap here lies %.0f%% on it"
                                % (_lp.get("ev"), _lp.get("lap"), 100 * _f, 100 * max(x for _, x in _scored)))
                else:
                    _keep.append(_lp)
            if len(_keep) != len(_lps):
                _g["lap_paths"] = _keep

    # A MAP TURN THAT IS NOT ON THIS ROAD WAS MEASURED ALONG A DIFFERENT ONE. better_map compared point
    # counts, and down() caps every path at 500 points, so a longer road could lose to a shorter stored one --
    # after which the branch that keeps the stored path adopted the longer drive's turns anyway. The result is
    # apexes and arcs from a road the path does not contain: -1700_-4450 carries 15 of 29 such turns, up to
    # 789 m off, with s running to 6,584 m on a 3,852 m map. geo_near only binds a corner within ~60 m of an
    # apex, so these can never match anything driven -- they are invisible AND they inflate every count taken
    # from the map. Dropped, not relocated: where the turn really belongs is not recoverable from this file.
    _g3 = m.get("geometry") or {}
    _gp3 = [(q[0], q[1]) for q in (_g3.get("path") or [])]
    _mt3 = _g3.get("turns") or []
    if _gp3 and _mt3:
        _keep3, _drop3 = [], []
        for _t in _mt3:
            _ap = _t.get("apex")
            if not _ap:
                _keep3.append(_t); continue
            _d = min(((_q[0] - _ap[0]) ** 2 + (_q[1] - _ap[1]) ** 2) for _q in _gp3) ** 0.5
            (_keep3 if _d <= 100.0 else _drop3).append(_t)
        if _drop3:
            hits.append("geometry.turns: %d of %d map turns sit up to %.0f m off this course's own path"
                        % (len(_drop3), len(_mt3), max(
                            min(((_q[0] - _t["apex"][0]) ** 2 + (_q[1] - _t["apex"][1]) ** 2) for _q in _gp3) ** 0.5
                            for _t in _drop3)))
            _g3["turns"] = _keep3

    return hits


def repair_routes():
    """Remove non-positive length_m from data/routes.json. Returns descriptions of what was dropped."""
    p = os.path.join(ROOT, "data", "routes.json")
    try:
        d = json.load(open(p, encoding="utf-8"))
    except Exception as e:
        return [], "routes.json unreadable: %s" % e
    R = d.get("routes") or {}
    hits = []
    for k, v in R.items():
        if isinstance(v, dict) and "length_m" in v and not ((v.get("length_m") or 0) > 0):
            hits.append("routes[%s].length_m = %s" % (k, v["length_m"]))
            v.pop("length_m", None)
    return hits, (d, p)


def repair_lap_store(dry):
    """Remove lap_traces rows whose session does not exist. Returns descriptions of what was dropped.

    Four rows carry session fh6_99990101_000000 -- a year-9999 sentinel, not a capture. No session file by
    that name exists and no course model claims it, so nothing can ever explain where those laps came from
    or check them against a capture; two of their route_keys have no model at all. A lap whose provenance
    cannot be established is not evidence, and these sit in the same table the 107% rule reads.
    """
    hits = []
    dbp = os.path.join(ROOT, "data", "laps.db")
    if not os.path.exists(dbp):
        return hits
    try:
        cx = sqlite3.connect(dbp)
        cx.row_factory = sqlite3.Row
        known = {os.path.basename(x)[:-5] for x in glob.glob(os.path.join(ROOT, "data", "sessions", "*.json"))
                 if not x.endswith(".tags.json")}
        rows = [dict(r) for r in cx.execute("SELECT id, route_key, session FROM lap_traces")]
        orphan = [r for r in rows if r["session"] and r["session"] not in known]
        # AND CLEAR A STORED LAP TIME ITS OWN TRACE CONTRADICTS. Repairing only the model is cosmetic: the
        # store keeps the value and the next promotion writes it straight back, which is how Edamame's
        # 21.088 s -- faster than that course's own 29.376 s record -- survived two repairs.
        try:
            import promote_traces as _pt
            _bad = []
            for r in cx.execute("SELECT id, route_key, cid, lap_s, pts FROM lap_traces WHERE lap_s IS NOT NULL"):
                try: _p = json.loads(r["pts"]) if r["pts"] else []
                except Exception: continue
                if _pt.time_disagrees(r["lap_s"], _p):
                    _bad.append((r["id"], r["route_key"], r["cid"], r["lap_s"], _pt.implied_s(_p)))
            for _i, _rk, _cid, _ls, _t in _bad:
                hits.append("id=%s %s [%s] lap_s=%.2f s but its own speed gives %.1f s" % (_i, _rk, _cid, _ls, _t))
            if _bad and not dry:
                cx.executemany("UPDATE lap_traces SET lap_s=NULL WHERE id=?", [(b[0],) for b in _bad])
                cx.commit()
        except Exception as _e:
            hits.append("lap-time consistency pass skipped: %r" % (_e,))
        for r in orphan:
            hits.append("id=%s route=%s session=%s (no such session file)" % (r["id"], r["route_key"], r["session"]))
        if orphan and not dry:
            cx.executemany("DELETE FROM lap_traces WHERE id=?", [(r["id"],) for r in orphan])
            cx.commit()
        cx.close()
    except Exception as e:
        hits.append("laps.db unreadable: %r" % (e,))
    return hits



def repair_sessions(dry):
    """A LAP TIME MUST BE A NUMBER. Returns descriptions of what was cleared.

    `best` in analyze_session's course body held the course's best lap time, and a nearest-geometry-turn loop
    added later reused the same name in the same scope -- so course_out["best_lap"] was written out holding a
    turn id. Six of 91 session-courses carry strings like "G3", "G44", "G22", and the dashboard called .toFixed
    on them, which is how it surfaced. The analyzer no longer does it; these are the records already written.

    Cleared to null rather than guessed at: the real time is recoverable only by re-analysing the capture, and
    null honestly means "not known", while any invented number would be indistinguishable from a measured one.
    """
    hits = []
    for p_ in sorted(glob.glob(os.path.join(ROOT, "data", "sessions", "*.json"))):
        try:
            d = json.load(open(p_, encoding="utf-8"))
        except Exception:
            continue
        touched = False
        for c in (d.get("courses") or []):
            if not isinstance(c, dict):
                continue
            bl = c.get("best_lap")
            if bl is not None and not isinstance(bl, (int, float)):
                hits.append("%s[%s].best_lap = %r (a turn id, not a lap time)"
                            % (os.path.basename(p_), c.get("route_key"), bl))
                c["best_lap"] = None
                touched = True
        if touched and not dry:
            json.dump(d, open(p_, "w", encoding="utf-8"), indent=1)
    return hits



def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry", action="store_true")
    a = ap.parse_args()
    n_f = n_v = 0
    for p in sorted(glob.glob(os.path.join(ROOT, "data", "courses", "*.json"))):
        try:
            m = json.load(open(p, encoding="utf-8"))
        except Exception as e:
            print("  !! %s: %s" % (os.path.basename(p), e)); continue
        hits = repair(m)
        if not hits:
            continue
        n_f += 1; n_v += len(hits)
        print("  %-24s %s" % (os.path.basename(p), "; ".join(hits)))
        if not a.dry:
            json.dump(m, open(p, "w", encoding="utf-8"), indent=2)
    lh = repair_lap_store(a.dry)
    for h in lh:
        print("  %-24s %s" % ("laps.db", h))
    sh = repair_sessions(a.dry)
    for h in sh:
        print("  %-24s %s" % ("sessions", h))
    rh, rd = repair_routes()
    for h in rh:
        print("  %-24s %s" % ("routes.json", h))
    if rh and not a.dry and isinstance(rd, tuple):
        json.dump(rd[0], open(rd[1], "w", encoding="utf-8"), indent=2)
    print("\n%s: %d impossible value(s) across %d course file(s)%s"
          % ("WOULD DROP" if a.dry else "DROPPED", n_v, n_f,
             " + %d route length(s)" % len(rh) if rh else "")
          + (" + %d session lap time(s)" % len(sh) if sh else "")
          + (" + %d lap-store row(s)" % len(lh) if lh else ""))   # orphans AND contradicted lap times
    if not n_v and not rh and not sh and not lh:
        print("nothing to do — every persisted value is inside the audit's invariants")


if __name__ == "__main__":
    main()
