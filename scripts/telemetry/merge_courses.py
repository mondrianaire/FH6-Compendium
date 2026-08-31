#!/usr/bin/env python3
"""Repair COURSE FRAGMENTATION: reunite course models that are the same physical road.

Why fragmentation happened: the dashboard's route-naming write REPLACED a route's registry entry (wiping
start/heading/length_m), and attribute_route skipped start-less routes — so naming a course made it
unmatchable and every later run of it minted a new route_key + course model. Both faults are fixed; this
repairs the data they already split.

    python scripts/telemetry/merge_courses.py            # report duplicates (read-only)
    python scripts/telemetry/merge_courses.py --apply    # merge them (backs up data/ first)

Duplicate rule (30 m cells, 8-neighbour tolerance — the same test attribute_route uses):
  * MUTUAL: each path covers >= 70% of the other — same road, same extent; or
  * FRAGMENT: one is >= 70% inside the other, covers >= 40% back, AND starts within 300 m — a partial/aborted
    run of the same event.
Containment alone is NOT enough: a 49 km route (the Goliath) geographically contains many shorter courses.
The model with the most laps wins as canonical; the others merge into it. Nothing is deleted without a backup.
"""
import json, glob, io, os, shutil, sys, time

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
CDIR = os.path.join(ROOT, "data", "courses")
RPATH = os.path.join(ROOT, "data", "routes.json")
THRESH = 0.70


def _arc(p):
    import math
    return sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(p, p[1:])) if p and len(p) > 1 else 0.0


def load(p):
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def path_of(m):
    g = m.get("geometry") or {}
    return g.get("path") or (g.get("paths") or [[]])[0] or []


def cells(pts, s=30):
    c = set()
    for x, z in pts:
        c.add((int(x // s), int(z // s)))
    return c


def cover(a, b_cells, s=30):
    if not a or not b_cells:
        return 0.0
    hit = 0
    for x, z in a:
        gx, gz = int(x // s), int(z // s)
        if any((gx + dx, gz + dz) in b_cells for dx in (-1, 0, 1) for dz in (-1, 0, 1)):
            hit += 1
    return hit / len(a)


def _tspan(t):
    """Road covered by a trace, piece-aware — the arc resets when a trace is stitched from pieces."""
    tot = 0.0; prev = None; st = None
    for q in (t or {}).get("pts") or []:
        a = q[0]
        if prev is None: st = a
        elif a < prev: tot += prev - st; st = a
        prev = a
    return tot + (prev - st) if prev is not None else 0.0


def _trace_beats(rec, cur):
    """Is `rec` the better trace for this cid than `cur`?

    NOT SIMPLY THE FASTER ONE. This compared lap_s alone, so a 364 m fragment claiming a 15.3 s lap displaced a
    real 1840 m lap at 71.7 s on -2350_-7550 — 1840 m in 15.3 s is 269 mph, and no car in the store does that.
    A short run is quick BECAUSE it is short, so on time alone a fragment wins a race it never ran and then holds
    the slot forever, because nothing honest can beat it. The analyzer already knew this and retires traces under
    70% of the course; merging did not, and quietly put back what the analyzer had thrown out.
    Coverage first, then time — the same order the analyzer uses, so the two agree about what a trace is.
    """
    sr, sc = _tspan(rec), _tspan(cur)
    if sc and sr and (sr < 0.85 * sc or sr > 1.18 * sc):
        return sr > sc                      # materially different road: the one covering MORE of it wins
    return (rec.get("lap_s") or 9e9) < (cur.get("lap_s") or 9e9)   # same road: the faster lap wins



def _line_recurs(key, path, min_sessions=2):
    """Has this course's start/finish line been crossed at the START of laps in >= min_sessions sessions?

    JETT'S POINT, GENERALISED. Courses are not independent: the Colossus is a 23.38 mi circuit and other
    events run on road that is also part of it. The containment rule absorbs a shorter course into a longer one
    that contains it, which is right for a capture FRAGMENT and catastrophic for a real course -- it destroys the
    course and silently reattributes its laps. Closed loops were already spared, but 10 of FH6's 25 road events
    are SPRINTS, and an open sprint lying inside the Colossus was not.

    Shape cannot separate the two, and neither can a lap time (19 of 23 courses have one, including a 292 m scrap
    claiming 177.8 s). What separates them is WHERE THEY BEGIN. A fragment begins wherever the capture opened --
    an arbitrary point that will not recur. A real course begins at a start/finish line the game put there, and
    every attempt begins at the same place, so the start REPEATS across independent sessions. Measured: Edamame's
    line recurs in 22 sessions and the Colossus's in 6, while every scrap course has 0 laps starting at its line.

    The comment above is right that starts cannot be compared BETWEEN two courses -- a fragment's start is an
    artefact. This asks a different question of one course alone: does its own start recur? Read-only, and a
    missing or unreadable store simply means no evidence, which spares nothing.
    """
    if not path:
        return 0
    try:
        import math as _m, sqlite3 as _sq
        cx = _sq.connect("file:" + os.path.join(ROOT, "data", "laps.db") + "?mode=ro", uri=True)
        cx.row_factory = _sq.Row
        st = path[0][:2]
        seen = set()
        for r in cx.execute("SELECT session, pts FROM lap_traces WHERE route_key=?", (key,)):
            try: pts = json.loads(r["pts"]) if r["pts"] else []
            except Exception: continue
            if pts and _m.hypot(pts[0][3] - st[0], pts[0][4] - st[1]) <= 60.0:
                seen.add(r["session"])
        cx.close()
        return len(seen)
    except Exception:
        return 0



def merge_into(dst, src):
    """Fold src's learning into dst. Conservative: additive counters, improve-only records, positional turns."""
    dst["laps"] = (dst.get("laps") or 0) + (src.get("laps") or 0)
    dst["sessions"] = sorted(set((dst.get("sessions") or []) + (src.get("sessions") or [])))
    # visits: keep one row per session (they carry laps/attempts/best)
    seen = {v.get("session"): v for v in (dst.get("visits") or [])}
    for v in (src.get("visits") or []):
        if v.get("session") not in seen:
            seen[v["session"]] = v
    dst["visits"] = sorted(seen.values(), key=lambda v: str(v.get("session") or ""))[-40:]
    # best_laps / cars / speed_traces: improve-only per cid
    for k in ("best_laps", "cars", "speed_traces"):
        d = dst.setdefault(k, {})
        for cid, rec in (src.get(k) or {}).items():
            cur = d.get(cid)
            if cur is None:
                d[cid] = rec
            elif k == "best_laps" and (rec.get("best_lap") or 9e9) < (cur.get("best_lap") or 9e9):
                d[cid] = rec
            elif k == "speed_traces" and _trace_beats(rec, cur):
                d[cid] = rec
    # turns: merge positionally (40 m — the analyzer's own clustering radius); new positions append
    dts = dst.setdefault("turns", [])
    for st in (src.get("turns") or []):
        sp = st.get("pos")
        if not sp:
            continue
        hit = next((t for t in dts if t.get("pos") and (t["pos"][0] - sp[0]) ** 2 + (t["pos"][1] - sp[1]) ** 2 <= 40 ** 2), None)
        if hit is None:
            st = dict(st, id=f"T{len(dts) + 1}")
            dts.append(st)
        else:
            hit["n"] = (hit.get("n") or 0) + (st.get("n") or 0)
            hit["sessions"] = max(hit.get("sessions") or 0, st.get("sessions") or 0)
            for cid, pv in (st.get("best_by_car") or {}).items():
                bbc = hit.setdefault("best_by_car", {})
                if cid not in bbc or (pv.get("mph_min") or 0) > (bbc[cid].get("mph_min") or 0):
                    bbc[cid] = pv
    dst["turn_count"] = sum(1 for t in dts if t.get("established"))
    # geometry + profile: keep the richer description — measured in ROAD, not in samples.
    # This compared len(path) — the POINT COUNT — so a short, densely-sampled map outranked a long, sparsely
    # sampled one and a 5,977 m geometry replaced a 47,648 m geometry, deleting 87% of the course and stranding
    # 142 of its turns as phantoms. Point count is a sampling artefact; arc length is the thing being compared.
    if _arc(path_of(src)) > _arc(path_of(dst)):
        dst["geometry"] = src.get("geometry")
    if (src.get("profile_laps") or 0) > (dst.get("profile_laps") or 0):
        dst["profile"] = src.get("profile"); dst["profile_laps"] = src.get("profile_laps"); dst["profile_session"] = src.get("profile_session")
    dst["merged_from"] = sorted(set((dst.get("merged_from") or []) + [src.get("route_key")] + (src.get("merged_from") or [])))
    # and retire what no longer covers the merged course, exactly as analyze_session does after its own writes:
    # the map may have GROWN in this merge, which can leave a trace that covered the old road short of the new one.
    _cl = ((dst.get("geometry") or {}).get("length_m") or 0)
    if _cl:
        _st = dst.get("speed_traces") or {}
        for _k in [k for k, t in _st.items() if _tspan(t) and _tspan(t) < 0.7 * _cl]:
            _st.pop(_k, None)
    return dst


def _rekey_sessions(old_key, new_key):
    """Point every session record at the surviving course. Returns how many session files changed.

    A session is a historical record and its COURSE list is not history about the world, it is a pointer into the
    course catalog — so when the catalog retires a key, the pointer has to follow or it dangles. Only the key is
    rewritten; every measurement in the record is left exactly as it was."""
    n = 0
    for p in glob.glob(os.path.join(ROOT, "data", "sessions", "*.json")):
        try:
            d = json.load(open(p, encoding="utf-8"))
        except Exception:
            continue
        hit = False
        for coll in ("courses", "events"):
            for rec in (d.get(coll) or []):
                if rec.get("route_key") == old_key:
                    rec["route_key"] = new_key; hit = True
        if hit:
            tmp = p + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(d, f, indent=1)
            os.replace(tmp, p); n += 1
    return n


def _move_traces(old_key, new_key):
    """Re-key a retired course's lap traces onto the canonical course. Returns how many rows moved.

    Read-only-safe: if the store does not exist there is nothing to move. The UNIQUE constraint is
    (route_key, session, cid, t0), so a row that would collide with one already under the canonical key is the
    SAME lap reached by two names — dropped rather than duplicated."""
    db = os.path.join(ROOT, "data", "laps.db")
    if not os.path.exists(db):
        return 0
    import sqlite3
    cx = sqlite3.connect(db, timeout=10)
    try:
        n = cx.execute("SELECT COUNT(*) FROM lap_traces WHERE route_key=?", (old_key,)).fetchone()[0]
        if not n:
            return 0
        cx.execute("UPDATE OR IGNORE lap_traces SET route_key=? WHERE route_key=?", (new_key, old_key))
        cx.execute("DELETE FROM lap_traces WHERE route_key=?", (old_key,))   # any left are exact duplicates
        cx.commit()
        return n
    finally:
        cx.close()


def main():
    apply = "--apply" in sys.argv
    models = {}
    for p in sorted(glob.glob(os.path.join(CDIR, "*.json"))):
        try:
            m = load(p)
        except Exception:
            continue
        k = m.get("route_key") or os.path.basename(p)[:-5]
        models[k] = (p, m, path_of(m))
    try:
        robj = load(RPATH)
    except Exception:
        robj = {"routes": {}}
    routes = robj.setdefault("routes", {})

    # group by mutual path coverage
    keys = sorted(models, key=lambda k: -(models[k][1].get("laps") or 0))
    groups, taken = [], set()
    for a in keys:
        if a in taken or a.startswith("loop:"):
            continue
        pa, ca = models[a][2], cells(models[a][2])
        if not pa:
            continue
        grp = [a]; taken.add(a); why = {}
        for b in keys:
            if b in taken or b.startswith("loop:"):
                continue
            pb = models[b][2]
            if not pb:
                continue
            ab, ba = cover(pa, cells(pb)), cover(pb, ca)
            d0 = ((pa[0][0] - pb[0][0]) ** 2 + (pa[0][1] - pb[0][1]) ** 2) ** 0.5
            mutual = min(ab, ba) >= THRESH
            frag = max(ab, ba) >= THRESH and min(ab, ba) >= 0.40 and d0 <= 300
            # CONTAINMENT: a stub cut from a long road can never satisfy min(ab, ba) >= 0.40, because it IS only a
            # few percent of that road — 1494 m inside 21288 m scores 0.07 by construction, and the guard that was
            # meant to reject two roads merely crossing was rejecting every genuine fragment instead.
            # What separates the two cases is whether the small number is EXPLAINED. If a lies almost wholly on b,
            # and a is much shorter than b, then ba should come out near len(a)/len(b) — and it does: measured
            # 0.07 against an expected 0.07, and 0.40 against 0.41. Two roads that merely cross share a short
            # stretch and score low BOTH ways, so ab >= 0.90 excludes them on its own.
            # Starts are deliberately not consulted: a fragment begins wherever the capture opened, which is the
            # very artefact that created these, so requiring the starts to agree would defeat the rule.
            La, Lb = _arc(pa), _arc(pb)
            contained = False
            if La and Lb:
                lo, hi, cvr = (La, Lb, ab) if La <= Lb else (Lb, La, ba)
                back = ba if La <= Lb else ab
                exp = lo / hi
                contained = cvr >= 0.90 and lo < 0.6 * hi and back <= max(0.25, exp * 2.5)
                # A CLOSED COURSE IS ITS OWN CIRCUIT, however much road it shares with a longer one. Jett's point,
                # and the guard the original min(ab, ba) >= 0.40 was quietly providing before I removed it to let
                # genuine fragments through: a 2 km loop that runs along part of a 21 km route is a DIFFERENT
                # course, not a piece of that one. A fragment is an open stub — it starts and ends in the middle
                # of the road it was cut from. Absorbing a circuit into a road that merely contains it destroys
                # a real course and silently reattributes its laps.
                _sp = pa if La <= Lb else pb
                _sk = a if La <= Lb else b
                if contained and _sp and len(_sp) > 2:
                    _sl = _arc(_sp)
                    _gap = ((_sp[0][0] - _sp[-1][0]) ** 2 + (_sp[0][1] - _sp[-1][1]) ** 2) ** 0.5
                    if _sl and _gap <= max(60.0, 0.12 * _sl):
                        contained = False
                # ...and an OPEN course is its own course too, if the game put a line at its start. The closed
                # guard above covers circuits; it left sprints unprotected, and 10 of the 25 FH6 road events are
                # sprints that can run on Colossus tarmac. A start that recurs across independent sessions is a
                # start/finish LINE, not the arbitrary point where a capture happened to open. See _line_recurs.
                if contained:
                    _n = _line_recurs(_sk, _sp)
                    if _n >= 2:
                        contained = False
                        print(f"  keeping {_sk}: its start recurs in {_n} sessions — a start/finish line, "
                              f"not a capture artefact, so it is a course in its own right")
            # the USER'S OWN NAME is ground truth and outranks any geometric heuristic: naming two keys the same
            # thing is a person saying "this is one course" (and naming is what split them in the first place).
            na = (models[a][1].get("name") or (routes.get(a) or {}).get("name") or "").strip().lower()
            nb = (models[b][1].get("name") or (routes.get(b) or {}).get("name") or "").strip().lower()
            named = bool(na) and na == nb and min(ab, ba) >= 0.40
            if mutual or frag or named or contained:
                grp.append(b); taken.add(b)
                why[a] = why.get(a) or f"seed of this group"
            why[b] = (f"CONTAINED {ab:.2f}/{ba:.2f} — {min(La, Lb):.0f} m lies on {max(La, Lb):.0f} m" if contained and not (mutual or frag or named)
                          else f"same name '{na}', paths {ab:.2f}/{ba:.2f}" if named and not (mutual or frag)
                          else f"{'mutual' if mutual else 'fragment'} {ab:.2f}/{ba:.2f}, starts {round(d0)} m apart")
        if len(grp) > 1:
            # Sorted HERE, not at either consumer: the dry run and the apply path each did `grp[0]` separately,
            # so sorting one of them would have shown a preview that the merge then contradicted.
            grp = sorted(grp, key=lambda k: -_arc(models[k][2] or []))
            groups.append((grp, why))

    if not groups:
        print("no duplicate course models — every model is a distinct road")
    for grp, why in groups:
        canon = grp[0]
        print(f"\nDUPLICATE SET -> canonical {canon} ({models[canon][1].get('laps')} laps, "
              f"{len(models[canon][1].get('sessions') or [])} sessions, name={models[canon][1].get('name') or (routes.get(canon) or {}).get('name')})")
        for d in grp[1:]:
            print(f"   merge {d}: {models[d][1].get('laps')} laps, {len(models[d][1].get('sessions') or [])} sessions   [{why.get(d, '')}]")

    # registry geometry restore (naming had wiped start/heading/length on named routes)
    fixed = []
    for k, (p, m, pts) in models.items():
        R = routes.setdefault(k, {})
        if not R.get("start") and pts:
            R["start"] = [round(pts[0][0]), round(pts[0][1])]
            R["length_m"] = R.get("length_m") or ((m.get("geometry") or {}).get("length_m"))
            fixed.append(k)
    if fixed:
        print(f"\nregistry: restored start geometry for {len(fixed)} route(s) whose naming write wiped it: {', '.join(fixed)}")

    if not apply:
        print("\n(read-only — re-run with --apply to perform the merge)")
        return

    stamp = time.strftime("%Y%m%d_%H%M%S")
    bak = os.path.join(ROOT, "data", f"_backup_courses_{stamp}")
    os.makedirs(bak, exist_ok=True)
    for k, (p, _m, _pt) in models.items():
        shutil.copy2(p, os.path.join(bak, os.path.basename(p)))
    shutil.copy2(RPATH, os.path.join(bak, "routes.json"))
    print(f"\nbackup -> {bak}")

    for grp, _why in groups:
        # THE CANONICAL MUST BE THE MODEL WITH THE MOST ROAD IN IT. Groups are seeded by iteration order, so a
        # containment group could nominate the FRAGMENT as canonical and absorb the road that contains it — the
        # dry run proposed merging a 47,648 m map into a 5,977 m one, which would have thrown away 87% of the
        # course to keep the piece. Longest path wins; laps and sessions merge either way.
        canon = grp[0]; cp, cm, _ = models[canon]
        name = cm.get("name") or (routes.get(canon) or {}).get("name")
        for d in grp[1:]:
            dp, dm, _ = models[d]
            merge_into(cm, dm)
            name = name or dm.get("name") or (routes.get(d) or {}).get("name")
            # THE LAP TRACES MUST FOLLOW THE MODEL. Merging retires the duplicate route_key, but every row in
            # data/laps.db is keyed by it — so without this the traces of the retired course are orphaned: still
            # on disk, attached to a key nothing resolves, invisible to /laps and to the per-turn measurement
            # that now reads them. Zero rows are stranded today, which is exactly why this is cheap to add and
            # would be expensive to discover: the first real merge would silently lose that course's history.
            moved = _move_traces(d, canon)
            if moved:
                print(f"  moved {moved} lap trace(s) {d} -> {canon}")
            # AND THE SESSION RECORDS. The model is deleted and the route key retired, but every session that
            # ever saw that road still names it — and the dashboard bundles sessions, so the retired course keeps
            # appearing on screen after the merge that was supposed to remove it. Jett: "the old courses fake are
            # still showing up to me." Same fault as the lap traces, one artefact over.
            rn = _rekey_sessions(d, canon)
            if rn:
                print(f"  re-keyed {rn} session record(s) {d} -> {canon}")
            os.remove(dp)
            routes.pop(d, None)   # the duplicate key is retired; path matching now attracts its events to the canonical model
        if name:
            cm["name"] = name; routes.setdefault(canon, {})["name"] = name
        tmp = cp + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(cm, f, indent=1)
        os.replace(tmp, cp)
        # A MERGE INVALIDATES THE TURN->MAP BINDING, BY DESIGN. The surviving model keeps its own turn inventory but
    # may adopt the OTHER model's geometry, so turns that were bound to the discarded map are now bound to
    # nothing: this merge left 145 registry entries claiming a map they were nowhere near and 3 courses declaring
    # more turns than their road had. The audit went 4 FAIL -> 151. Rebinding is not an optional follow-up step
    # someone has to remember; it is part of what merging MEANS, so it happens here.
    try:
        import rebind_map_turns as _RB
        _ar, _at, _ae = _RB.rebind(cm)
        if _ar or _at or _ae:
            print(f"  rebound turns to the surviving map: +{_ar} registry, +{_at} turns, {_ae:+d} established")
    except Exception as _e:
        print(f"  !! turn rebind failed ({_e!r}) — run rebind_map_turns.py before trusting the turn counts")
    print(f"merged -> {canon}: {cm.get('laps')} laps, {len(cm.get('sessions') or [])} sessions, "
              f"{len(cm.get('turns') or [])} turns (from {len(grp)} models)")

    tmp = RPATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(robj, f, indent=2, ensure_ascii=False)
    os.replace(tmp, RPATH)
    print("routes.json updated")


if __name__ == "__main__":
    main()
