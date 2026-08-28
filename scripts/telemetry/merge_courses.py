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
            elif k == "speed_traces" and (rec.get("lap_s") or 9e9) < (cur.get("lap_s") or 9e9):
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
    # geometry + profile: keep the richer description
    if len(path_of(src)) > len(path_of(dst)):
        dst["geometry"] = src.get("geometry")
    if (src.get("profile_laps") or 0) > (dst.get("profile_laps") or 0):
        dst["profile"] = src.get("profile"); dst["profile_laps"] = src.get("profile_laps"); dst["profile_session"] = src.get("profile_session")
    dst["merged_from"] = sorted(set((dst.get("merged_from") or []) + [src.get("route_key")] + (src.get("merged_from") or [])))
    return dst


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
            # the USER'S OWN NAME is ground truth and outranks any geometric heuristic: naming two keys the same
            # thing is a person saying "this is one course" (and naming is what split them in the first place).
            na = (models[a][1].get("name") or (routes.get(a) or {}).get("name") or "").strip().lower()
            nb = (models[b][1].get("name") or (routes.get(b) or {}).get("name") or "").strip().lower()
            named = bool(na) and na == nb and min(ab, ba) >= 0.40
            if mutual or frag or named:
                grp.append(b); taken.add(b)
                why[b] = (f"same name '{na}', paths {ab:.2f}/{ba:.2f}" if named and not (mutual or frag)
                          else f"{'mutual' if mutual else 'fragment'} {ab:.2f}/{ba:.2f}, starts {round(d0)} m apart")
        if len(grp) > 1:
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
        canon = grp[0]; cp, cm, _ = models[canon]
        name = cm.get("name") or (routes.get(canon) or {}).get("name")
        for d in grp[1:]:
            dp, dm, _ = models[d]
            merge_into(cm, dm)
            name = name or dm.get("name") or (routes.get(d) or {}).get("name")
            os.remove(dp)
            routes.pop(d, None)   # the duplicate key is retired; path matching now attracts its events to the canonical model
        if name:
            cm["name"] = name; routes.setdefault(canon, {})["name"] = name
        tmp = cp + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(cm, f, indent=1)
        os.replace(tmp, cp)
        print(f"merged -> {canon}: {cm.get('laps')} laps, {len(cm.get('sessions') or [])} sessions, "
              f"{len(cm.get('turns') or [])} turns (from {len(grp)} models)")

    tmp = RPATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(robj, f, indent=2, ensure_ascii=False)
    os.replace(tmp, RPATH)
    print("routes.json updated")


if __name__ == "__main__":
    main()
