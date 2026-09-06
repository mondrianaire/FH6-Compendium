"""One-time corpus migration: re-key capture-less sessions to catalogued route ids, then prune orphaned course files.

The catalogue-seeded analyzer (analyze_session._catalogue_key) collapses fragments to `route:<id>` for every
CAPTURE-BACKED session it re-replays. Sessions whose raw capture is gone cannot be re-replayed, so their events
keep old grid keys and a physical course splits between `route:<id>` (new) and a grid fragment (old). This script
closes that gap WITHOUT raw telemetry: it matches each course's stored geometry to the catalogue exactly the way
the analyzer matches a live drive (nearest catalogued start proposes; path overlap >= 0.6, same direction, decides),
builds a {old_key -> route:<id>} remap, rewrites the capture-less sessions' event route_key/route through it, and
deletes course files no session references any more.

Usage:  python scripts/telemetry/migrate_catalogue_keys.py            # dry run (report only)
        python scripts/telemetry/migrate_catalogue_keys.py --apply    # rewrite sessions + prune course files
"""
import os, re, sys, json, glob, math
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import analyze_session as A                                   # reuse the catalogue loaders
ROOT = A.ROOT
APPLY = "--apply" in sys.argv

def _near(x, z, cells):
    cx0, cz0 = int(x // 30), int(z // 30)
    for dx in (-1, 0, 1):
        for dz in (-1, 0, 1):
            for px, pz in cells.get((cx0 + dx, cz0 + dz), ()):
                if (px - x) ** 2 + (pz - z) ** 2 <= 900: return True
    return False
def _overlap(sample, cp):
    cells = {}
    for x, z in cp: cells.setdefault((int(x // 30), int(z // 30)), []).append((x, z))
    return sum(1 for x, z in sample if _near(x, z, cells)) / len(sample)
def _dir_ok(sample, pts):
    if not pts or len(sample) < 6: return True
    n = len(pts); idx = []
    for x, z in sample[:: max(1, len(sample) // 60)]:
        j = min(range(n), key=lambda i_: (pts[i_][0] - x) ** 2 + (pts[i_][1] - z) ** 2)
        if (pts[j][0] - x) ** 2 + (pts[j][1] - z) ** 2 <= 3600: idx.append(j)
    if len(idx) < 4: return True
    fwd = back = 0
    for a, b in zip(idx, idx[1:]):
        d = ((b - a + n // 2) % n) - n // 2
        if d > 0: fwd += 1
        elif d < 0: back += 1
    return fwd >= 1.5 * back

def match_course(path):
    """Same rule as analyze_session._catalogue_key, applied to a course's stored geometry path."""
    if not path or len(path) < 8: return None
    sx, sz = path[0]
    best = None
    for key, name, cx0, cz0, length_m, is_race, conf in A._catalogue_starts():
        d0 = math.hypot(sx - cx0, sz - cz0)
        if d0 > 500: continue   # match analyze_session._catalogue_key's prefilter; ov + direction decide
        cp = A._catalogue_path(key)
        if not cp: continue
        if _overlap(path, cp) < 0.6: continue
        if not _dir_ok(path, cp): continue
        cand = (-round(_overlap(path, cp), 2), round(d0), key, name)
        if best is None or cand < best: best = cand
    return (best[2], best[3]) if best else None

def course_path(key):
    p = os.path.join(ROOT, "data", "courses", re.sub(r"[^A-Za-z0-9_.-]+", "_", key) + ".json")
    try:
        with open(p, encoding="utf-8") as f:
            return (json.load(f).get("geometry") or {}).get("path") or []
    except Exception:
        return []

def _canonical_ids():
    """Some physical courses carry TWO catalogued route_ids under one name (Edamame 30006/6001, Hokubu
    101/30001, Legend Island Circuit 30004/311 -- each pair is start_sep 0 m, path overlap 1.00). Merge each
    pair to one canonical id so a course does not split across its two ids. Canonical = the id with the most
    events in the current corpus, tie broken by having a course file, then the lower id. Returns
    {route:<stray> -> route:<canonical>}."""
    import sqlite3, collections
    byname = collections.defaultdict(list)
    try:
        cx = sqlite3.connect("file:%s?mode=ro" % os.path.join(ROOT, "data", "fh6.db").replace("\\", "/"), uri=True)
        for rid, name in cx.execute("SELECT route_id, name FROM ref_route WHERE name IS NOT NULL"):
            byname[name].append(str(rid))
        cx.close()
    except Exception:
        return {}
    counts = collections.Counter()
    for sf in glob.glob(os.path.join(ROOT, "data", "sessions", "*.json")):
        if sf.endswith(".tags.json"): continue
        try:
            with open(sf, encoding="utf-8") as f: d = json.load(f)
        except Exception: continue
        for e in d.get("events") or []:
            rk = str(e.get("route_key") or "")
            if rk.startswith("route:"): counts[rk.split(":", 1)[1]] += 1
    def has_file(rid): return os.path.exists(os.path.join(ROOT, "data", "courses", "route_%s.json" % rid))
    canon = {}
    for name, ids in byname.items():
        if len(ids) < 2: continue
        best = max(ids, key=lambda i: (counts[i], has_file(i), -int(i)))
        for i in ids:
            if i != best: canon["route:%s" % i] = "route:%s" % best
    return canon

def main():
    # 1) remap from course geometry (old grid keys -> catalogued route id)
    remap = {}
    for cf in sorted(glob.glob(os.path.join(ROOT, "data", "courses", "*.json"))):
        key = os.path.splitext(os.path.basename(cf))[0]
        if key.startswith("route_"): continue                # already a catalogued route file
        m = match_course(course_path(key))
        if m: remap[key] = m                                  # key here is the sanitised filename stem
    canon = _canonical_ids()                                  # route:<stray> -> route:<canonical> for duplicate-named ids
    # course filenames sanitise route_key; build a route_key->route:id map keyed by the SANITISED form
    def san(k): return re.sub(r"[^A-Za-z0-9_.-]+", "_", k)
    print("=== catalogue remap (%d course files -> a route) ===" % len(remap))
    for k, (rk, nm) in sorted(remap.items()):
        print("  %-18s -> %-12s %s" % (k, rk, nm))
    if canon:
        print("=== duplicate-id canonicalisation (%d) ===" % len(canon))
        for a, b in sorted(canon.items()): print("  %-12s -> %s" % (a, b))
    # 2) rewrite every session's grid-key events through the remap. A route:<id> event is already correct and is
    #    skipped (route:<id> keys are never in the remap). A grid-key event whose COURSE geometry matches the
    #    catalogue is that route wherever it came from -- capture-less, or a capture that could not be re-replayed
    #    (corrupt .gz) -- so it re-keys the same way analyze_session._catalogue_key would have. A genuine wander
    #    whose own course does not match the catalogue has no remap entry and stays put.
    changed_files = 0; changed_events = 0
    for sf in sorted(glob.glob(os.path.join(ROOT, "data", "sessions", "*.json"))):
        if sf.endswith(".tags.json"): continue
        try:
            with open(sf, encoding="utf-8") as f: d = json.load(f)
        except Exception: continue
        dirty = False
        for e in d.get("events") or []:
            rk = e.get("route_key")
            if rk is None: continue
            new_key, new_name = rk, e.get("route")
            hit = remap.get(rk) or remap.get(san(rk))        # grid key -> route:<id>
            if hit: new_key, new_name = hit[0], hit[1]
            if new_key in canon: new_key = canon[new_key]    # duplicate id -> canonical id (name unchanged)
            if new_key != rk:
                e["route_key"] = new_key
                if new_name is not None: e["route"] = new_name
                dirty = True; changed_events += 1
        if dirty:
            changed_files += 1
            if APPLY:
                with open(sf, "w", encoding="utf-8") as f: json.dump(d, f, separators=(",", ":"))
    print("\ncapture-less sessions rewritten: %d files, %d events%s" % (changed_files, changed_events, "" if APPLY else "  (dry run)"))
    # 3) prune course files no session references any more
    referenced = set()
    for sf in glob.glob(os.path.join(ROOT, "data", "sessions", "*.json")):
        if sf.endswith(".tags.json"): continue
        try:
            with open(sf, encoding="utf-8") as f: d = json.load(f)
        except Exception: continue
        for e in d.get("events") or []:
            rk = e.get("route_key")
            if rk: referenced.add(san(rk))
    prune = []
    for cf in glob.glob(os.path.join(ROOT, "data", "courses", "*.json")):
        key = os.path.splitext(os.path.basename(cf))[0]
        if key not in referenced: prune.append(cf)
    print("\n=== prune: %d course files referenced by no session ===" % len(prune))
    for cf in sorted(prune): print("  rm", os.path.basename(cf))
    if APPLY:
        for cf in prune: os.remove(cf)
        print("\npruned %d files." % len(prune))
    else:
        print("\n(dry run — rerun with --apply to rewrite sessions and prune)")

if __name__ == "__main__":
    main()
