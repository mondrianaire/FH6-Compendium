#!/usr/bin/env python3
"""Re-bind every stored course model's turn inventory to its own map, without needing to drive it again.

    python scripts/telemetry/rebind_map_turns.py --dry
    python scripts/telemetry/rebind_map_turns.py

WHY. A turn becomes visible through a chain: map turn -> registry entry (model_map) -> merged turn (geo_mapped)
-> established. Three matchers along that chain took the FIRST candidate in dict order rather than the nearest,
and none of them was one-to-one, so on a course with closely-spaced corners several map turns bound the same
record and the rest bound nothing. The analyzer now matches nearest and one-to-one at all three stages — but a
model only re-derives when its course is next DRIVEN, and 110 mapped corners across 13 courses were invisible
in the meantime. Nobody is going to drive fourteen courses to fix bookkeeping.

This walks the chain for models already on disk, with the same rule the analyzer now uses:

  * tolerance from the MAP's own closest turn gap, clamped to 6..18 m, exactly as analyze_session derives it
  * every map turn binds the NEAREST unbound registry entry; if there is none it gets a fresh one
  * every registry entry carrying model_map binds the NEAREST unbound turn; if there is none, a turn is created
    from the map (which is what the analyzer does too — see the `if hit is None` branch)
  * establishment is then re-derived, never inherited

WHAT IT WILL NOT DO. It never invents a turn the map does not contain, never promotes a turn the map has no
record of, and never touches `track`, `by_session`, `best` or any behavioural statistic — those are the
accumulated record and this has nothing to say about them. A turn it creates carries geometry only, and stays
empty of driving evidence until something measures it.

Idempotent: a second run finds nothing to change.
"""
import argparse, glob, io, json, math, os, sys

try: sys.stdout.reconfigure(encoding="utf-8", errors="replace")   # in place: see merge_courses.py
except Exception: pass
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))


def tol_of(mturns):
    """The analyzer's rule, restated: half the map's own closest turn gap, clamped."""
    ms = sorted(t.get("s") for t in mturns if t.get("s") is not None)
    gap = min((b - a for a, b in zip(ms, ms[1:])), default=44)
    return max(6.0, min(18.0, gap / 2.0))


def nearest(pos, items, key, taken, tol):
    """Nearest unbound item within tol, or None. One-to-one is enforced by the caller's `taken` set."""
    best, bd = None, tol * tol
    for it in items:
        i = id(it) if not isinstance(it, str) else it
        if i in taken:
            continue
        p = key(it)
        if not p:
            continue
        d = (p[0] - pos[0]) ** 2 + (p[1] - pos[1]) ** 2
        if d <= bd:
            best, bd = it, d
    return best


def rebind(m):
    """Mutates `m`. Returns (n_registry_added, n_turns_added, n_established_added)."""
    g = (m.get("geometry") or {}).get("turns") or []
    mturns = [t for t in g if t.get("apex")]
    if not mturns:
        return 0, 0, 0
    tol = tol_of(mturns)
    reg = m.setdefault("geo_turns", {})
    turns = m.setdefault("turns", [])

    # --- 1. every map turn owns a registry entry, nearest and one-to-one ---
    for v in reg.values():
        v.pop("model_map", None)                     # rebuilt, never accumulated
    taken, added_r = set(), 0
    for t in mturns:
        ap = t["apex"]
        k = nearest(ap, list(reg.keys()), lambda kk: reg[kk].get("pos"), taken, tol)
        if k is None:
            k = "%d_%d" % (round(ap[0]), round(ap[1]))
            if k in reg:                              # positional key collision: make it unique, do not clobber
                k += "b"
            reg[k] = {"pos": [round(ap[0]), round(ap[1])], "sessions": []}
            added_r += 1
        taken.add(k)
        r = reg[k]
        r["pos"] = [round(ap[0]), round(ap[1])]       # the map moved; the record follows it
        r["model_map"] = True
        for f in ("dir", "radius_m", "deg", "s"):
            if t.get(f) is not None:
                r[f] = t[f]
    # an entry the current map does not contain is a superseded apex — the analyzer's own rule
    for k in [k for k, v in reg.items() if not v.get("model_map")]:
        del reg[k]

    # --- 2. every registry entry owns a turn, nearest and one-to-one ---
    for t in turns:
        t.pop("geo_mapped", None); t.pop("geo_sessions", None)
    bound, added_t = set(), 0
    for k, v in reg.items():
        hit = nearest(v["pos"], turns, lambda t: t.get("pos"), bound, tol)
        if hit is None:
            hit = {"id": "T?", "pos": list(v["pos"]), "dir": v.get("dir"), "type": None,
                   "radius_m": v.get("radius_m"), "n": 0, "best": None, "sessions": 0,
                   "by_session": {}, "track": {}}
            turns.append(hit)
            added_t += 1
        bound.add(id(hit))
        hit["geo_sessions"] = len(v.get("sessions") or [])
        hit["geo_mapped"] = True
        hit["deg"] = v.get("deg")
        hit["s"] = v.get("s")            # the record needs its ARC, or the ordering below sorts on nothing
        if hit.get("radius_m") is None:
            hit["radius_m"] = v.get("radius_m")
        if hit.get("dir") is None:
            hit["dir"] = v.get("dir")

    # --- 3. re-derive establishment from the evidence, exactly as the analyzer does ---
    before = sum(1 for t in turns if t.get("established"))
    for t in turns:
        by = None
        if t.get("geo_mapped") or (t.get("geo_sessions") or 0) >= 2:
            by = "geometry"
        elif (t.get("geo_sessions") or 0) >= 1 and ((t.get("track") or {}).get("passes") or 0) >= 1:
            by = "geometry+driven"
        t["established"] = bool(by); t["est_by"] = by
        t["status"] = "turn" if by else "possible"
    est = [t for t in turns if t["established"]]
    # A SORT KEY THE RECORDS ACTUALLY CARRY, AND AN ID NOBODY ELSE IS USING. This sorted on x.get("s") when no
    # turn record held `s` -- step 2 copied dir/radius_m/deg from the registry entry but not the arc -- so every
    # key was 0, the sort was a no-op, and `i` was a list position rather than a route position. Worse, the id
    # came straight from that index and was assigned without checking: a turn created here could be handed "T7"
    # while an existing turn already answered to "T7", and the dashboard joins on the model's id.
    # `s` is now copied above, so the order is the route's order; ids are drawn from the first numbers not
    # already taken, so a new turn can never collide with one that exists.
    # AND REPAIR THE COLLISIONS ALREADY ON DISK. 65 duplicate ids across 10 courses, up to five on one course:
    # two established turns both answering to "T21" while the dashboard joins live corners on that id, so one
    # corner's evidence is read for the other. Ordered by arc, the FIRST holder of an id keeps it -- churn stays
    # minimal and stable across runs -- and every later claimant is moved to the first free number.
    _ordered = sorted(est, key=lambda x: (x.get("s") if x.get("s") is not None else 0))
    _used, _next, _fixed = set(), 1, 0
    for t in _ordered:
        i = t.get("id")
        if i in (None, "T?") or i in _used:
            while ("T%d" % _next) in _used or any(o.get("id") == ("T%d" % _next) and o is not t for o in _ordered[_ordered.index(t) + 1:]):
                _next += 1
            if i not in (None, "T?"):
                _fixed += 1
            t["id"] = "T%d" % _next
        _used.add(t["id"])
    m["turn_count"] = len(est)
    globals()["_LAST_FIXED_IDS"] = _fixed
    exp = m.get("expected_turns")
    m["turn_count_delta"] = (len(est) - exp) if exp else None
    return added_r, added_t, len(est) - before


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry", action="store_true")
    a = ap.parse_args()
    tot = [0, 0, 0]; n = 0
    for p in sorted(glob.glob(os.path.join(ROOT, "data", "courses", "*.json"))):
        try:
            m = json.load(open(p, encoding="utf-8"))
        except Exception as e:
            print("  !! %s: %s" % (os.path.basename(p), e)); continue
        _before = json.dumps(m, sort_keys=True)
        gt = len((m.get("geometry") or {}).get("turns") or [])
        est0 = sum(1 for t in (m.get("turns") or []) if t.get("established"))
        ar, at, ae = rebind(m)
        est1 = sum(1 for t in (m.get("turns") or []) if t.get("established"))
        if not (ar or at or ae or globals().get("_LAST_FIXED_IDS")):
            # a run that only carried arcs onto records or repaired a duplicate id still has to be SAVED,
            # or the repair happens in memory every time and never reaches disk
            if json.dumps(m, sort_keys=True) == _before:
                continue
        n += 1; tot = [tot[0] + ar, tot[1] + at, tot[2] + ae]
        print("  %-24s map %-4d established %s -> %-4d  (+%d registry, +%d turns)"
              % (os.path.basename(p), gt, est0, est1, ar, at))
        if not a.dry:
            json.dump(m, open(p, "w", encoding="utf-8"), indent=2)
    print("\n%s: %d courses · +%d registry entries · +%d turns · +%d established"
          % ("WOULD CHANGE" if a.dry else "WROTE", n, tot[0], tot[1], tot[2]))
    if not n:
        print("nothing to do — every map turn already owns a registry entry and a turn")


if __name__ == "__main__":
    main()
