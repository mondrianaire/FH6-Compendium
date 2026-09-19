#!/usr/bin/env python3
"""Multi-attribute WORKFLOW VERIFICATION checklist — probes the LIVE system end-to-end and reports PASS/WARN/FAIL
per attribute. READ-ONLY everywhere (game saves, data stores, HTTP GETs). Run after any change:

    python scripts/telemetry/verify_workflow.py            # full checklist
    python scripts/telemetry/verify_workflow.py --json     # machine-readable results

Groups: A services · B save-decode · C identification (builds/matcher/PI/liveries) · D union invariants ·
E events · F client artifacts · G data stores.
"""
import sys, os, io, json, glob, hashlib, re, subprocess, urllib.request

try: sys.stdout.reconfigure(encoding="utf-8", errors="replace")   # in place: see merge_courses.py
except Exception: pass
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
MAIN = os.path.abspath(os.path.join(ROOT, "..", "..", ".."))  # worktree -> repo root of main checkout (…/forza-horizon-6-tuning)
sys.path.insert(0, HERE)

RESULTS = []
def check(group, name, fn):
    try:
        ok, detail = fn()
        status = "PASS" if ok is True else ("WARN" if ok == "warn" else "FAIL")
    except Exception as e:
        status, detail = "FAIL", f"exception: {e!r}"
    RESULTS.append({"group": group, "name": name, "status": status, "detail": str(detail)[:220]})

def http_json(path, timeout=6):
    with urllib.request.urlopen(f"http://127.0.0.1:8765{path}", timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))

def http_raw(url, timeout=6):
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return r.read()

# ---------------- A. SERVICES ----------------
def a1():
    d = http_json("/disk-tunes"); n = d.get("count") or 0
    return (n > 0, f"daemon serving {n} tunes")
check("A services", "daemon up + tune roster", a1)

def a2():
    wt = open(os.path.join(ROOT, "dashboard", "index.html"), encoding="utf-8").read()
    import re
    v = re.search(r"app\.js\?v=([a-z0-9]+)", wt).group(1)
    served = http_raw("http://127.0.0.1:8000/").decode("utf-8", "replace")
    return (f"?v={v}" in served, f"worktree v={v}; 8000 serves it: {f'?v={v}' in served}")
check("A services", "dashboard 8000 = worktree version", a2)

def a2b():
    """EVERY local asset must carry the cache-buster, not just app.js. db.js shipped without one, so the
    dashboard rendered a cached DATA bundle indefinitely — new code drawing superseded course geometry, which
    reads exactly like a broken detector. A stale-data bug is invisible unless something asserts this."""
    import re
    wt = open(os.path.join(ROOT, "dashboard", "index.html"), encoding="utf-8").read()
    srcs = re.findall(r'<script[^>]+src="([^"]+)"', wt) + re.findall(r'<link[^>]+href="([^"]+\.css[^"]*)"', wt)
    local = [s for s in srcs if not s.startswith(("http://", "https://", "//"))]
    bare = [s for s in local if "?v=" not in s]
    return (not bare, f"{len(local)} local assets versioned" if not bare else f"NO cache-buster on: {bare}")
check("A services", "every local asset is cache-busted", a2b)

def a3():
    import re
    wt = re.search(r"app\.js\?v=([a-z0-9]+)", open(os.path.join(ROOT, "dashboard", "index.html"), encoding="utf-8").read()).group(1)
    try:
        served = http_raw("http://127.0.0.1:8643/").decode("utf-8", "replace")
    except Exception:
        return ("warn", "8643 not running (desktop-shortcut lane down — start_lab or reboot starts it)")
    return (f"?v={wt}" in served, f"8643 serves v={wt}: {f'?v={wt}' in served}")
check("A services", "dashboard 8643 (main) same version", a3)

def a4():
    b = subprocess.run(["git", "rev-parse", "claude/forza-eliminator-tips-db-c512c3"], cwd=ROOT, capture_output=True, text=True).stdout.strip()
    m = subprocess.run(["git", "rev-parse", "master"], cwd=ROOT, capture_output=True, text=True).stdout.strip()
    return (b == m and len(b) == 40, f"branch {b[:8]} vs master {m[:8]} — {'in sync' if b == m else 'DIVERGED'}")
check("A services", "master == branch tip", a4)

# ---------------- B. SAVE DECODE ----------------
import fh6_tune_decode as T
def b1():
    root = T.find_containers_root()
    paths = glob.glob(os.path.join(root, "Tuning_*", "Data"))
    bad = 0; n = 0
    for p in paths[:60]:
        n += 1
        try:
            t = T.parse_tune(p)
            assert t["ordinal"] > 0 and isinstance(t["parts"], dict)
        except Exception:
            bad += 1
    return (bad == 0, f"{n} sampled saves parse clean ({bad} failures)")
check("B decode", "saves parse (sample 60)", b1)

def b2():
    metas, _ = T.tunes_for_ordinal(2866)
    d = T.tune_to_deliverable(T.parse_tune(metas[0]["path"], ordinal_hint=2866), "")
    sm = d["summary"]; c = d["confidence"]
    need = all(k in sm for k in ("parts_installed", "sliders_relative"))
    return (0 <= c <= 1 and need, f"confidence={c} parts={sm.get('parts_installed')} exact={sm.get('sliders_exact', sm.get('sliders_absolute'))} rel={sm.get('sliders_relative')}")
check("B decode", "deliverable shape + confidence bounds", b2)

def b3():
    metas, _ = T.tunes_for_ordinal(2866)
    d = T.tune_to_deliverable(T.parse_tune(metas[0]["path"], ordinal_hint=2866), "")
    for m in d["menus"]:
        for r in m["rows"]:
            if r["item"] == "engine" and not r.get("stock"):
                ok = r.get("derived_level") and r.get("pi") is None and "not a shop part" in (r.get("note") or "")
                return (bool(ok), f"engine row: '{r['value']}' derived_level={r.get('derived_level')} pi={r.get('pi')}")
    return ("warn", "no non-stock engine row in sample")
check("B decode", "engine slot = derived indicator (no ghost part)", b3)

def b4():
    doc = json.load(open(os.path.join(ROOT, "data", "car-tune-ranges.json"), encoding="utf-8"))
    bad = []
    for k, pts in (doc.get("points") or {}).items():
        norms = [round(float(p[0]), 3) for p in pts]
        if len(norms) != len(set(norms)):
            bad.append(k)
    return (not bad, f"{len((doc.get('points') or {}))} point-sets, duplicate-position sets: {bad or 'none'}")
check("B decode", "calibration points: one value per position", b4)

def b5():
    # DATA INVARIANTS the audits kept finding by hand — now permanent: ranges must be possible (min < max),
    # per-tune speed traces must actually cover their course, and course best_laps must not exceed any event lap.
    probs = []
    doc = json.load(open(os.path.join(ROOT, "data", "car-tune-ranges.json"), encoding="utf-8"))
    for ordn, flds in (doc.get("ranges") or {}).items():
        if not isinstance(flds, dict): continue
        for f, r in flds.items():
            if isinstance(r, dict) and r.get("min") is not None and r.get("max") is not None and r["min"] >= r["max"]:
                probs.append(f"range {ordn}.{f} min>=max")
    for mp in glob.glob(os.path.join(ROOT, "data", "courses", "*.json")):
        try:
            m = json.load(open(mp, encoding="utf-8"))
        except Exception:
            continue
        trs = m.get("speed_traces") or {}
        arcs = [t["pts"][-1][0] for t in trs.values() if t.get("pts")]
        if arcs and min(arcs) < 0.5 * max(arcs):
            probs.append(f"{os.path.basename(mp)} trace covers <50% of the longest ({min(arcs)}/{max(arcs)}m)")
    return (not probs, f"{len(probs)} invariant violations{': ' + '; '.join(probs[:3]) if probs else ' — ranges possible, traces cover their courses'}")
check("B decode", "store invariants: ranges possible, traces cover courses", b5)

# ---------------- C. IDENTIFICATION ----------------
DT = http_json("/disk-tune?ordinal=2866")
def c1():
    m = DT.get("match") or {}
    known = {"signature", "newest", "picked", "no-match", "unsaved-build"}   # gearless: 'gear-matched' retired 2026-09-17
    return (m.get("how") in known and m.get("n_saves", 0) >= 1, f"how={m.get('how')} n_saves={m.get('n_saves')} ties={m.get('n_signature_ties')}")
check("C identify", "match present + known state", c1)

def c2():
    bs = (DT.get("match") or {}).get("builds") or []
    labels = [b["label"] for b in bs]
    sigs = {b["build"] for b in bs}
    # letters are PERMANENT per fingerprint (data/build-letters.json) — unique, stable, NOT positional:
    # a new save must never re-letter the garage.
    return (len(bs) >= 1 and len(sigs) == len(bs) and len(set(labels)) == len(labels), f"{len(bs)} builds, labels={labels}, fingerprints distinct={len(sigs) == len(bs)}, labels unique={len(set(labels)) == len(labels)}")
check("C identify", "builds: distinct fingerprints + permanent unique labels", c2)

def c3():
    bs = (DT.get("match") or {}).get("builds") or []
    base = (bs[0].get("diff_base") if bs else None) or "A"   # permanent letters: the diff base is named, not positional
    bad = [b["label"] for b in bs if b["label"] != base and not b.get("n_diffs")]
    return (not bad, f"non-{base} builds all carry part diffs (empty: {bad or 'none'})")
check("C identify", "non-base builds carry diffs vs the named base", c3)

def c4():
    saves = (DT.get("match") or {}).get("saves") or []
    lbls = [s.get("build") for s in saves]
    return (all(lbls) and len(saves) >= 1, f"saves carry build labels: {lbls}")
check("C identify", "every save mapped to a build", c4)

def c5():
    obs = json.load(open(os.path.join(ROOT, "data", "pi-observations.json"), encoding="utf-8"))
    recs = []
    for v in (obs.values() if isinstance(obs, dict) else []):
        if isinstance(v, list):
            recs = v; break
    r2866 = [r for r in recs if str(r.get("ordinal")) == "2866"]
    hashes = [r.get("parts_hash") for r in r2866]
    return (len(hashes) == len(set(hashes)) and len(r2866) >= 1, f"{len(r2866)} obs for 2866, hashes unique={len(hashes) == len(set(hashes))}, PIs={[r.get('car_pi') for r in r2866]}")
check("C identify", "PI observations deduped per config", c5)

def c6():
    # Capability check, not a data-completeness check: the stamp guard only records PI on
    # VERIFIED identity, so a build the user hasn't gear-verified yet has pi=None by design.
    # fail = separation actually broken (colliding stamps / non-distinct builds);
    # warn = pipeline sound but the second same-PI build still awaits its verification drive.
    bs = (DT.get("match") or {}).get("builds") or []
    if len(bs) < 5:
        return ("warn", f"only {len(bs)} builds visible — roster incomplete")
    sigs = [b.get("build") for b in bs]   # parts-fingerprint slug (sha1[:8])
    if len(sigs) != len(set(sigs)):
        return (False, f"build fingerprints collide: {sigs}")
    pis = [b["pi"] for b in bs if b["pi"] is not None]
    two800 = sum(1 for p in pis if p == 800)
    if two800 >= 2:
        return (True, f"stamped PIs={pis} — both S1-800 builds carry verified stamps")
    return ("warn", f"stamped PIs={pis} — one S1-800 build verified; the other is unresolved — equip + save to identify it (stamp guard holding, as designed)")
check("C identify", "the two S1-800 builds are separated", c6)


def c7():
    """PERSISTED IDENTITY EVIDENCE MUST COME BACK. data/identity-evidence.json was being written faithfully and
    read never: _ident_restore() was called ABOVE the definition of the _ident_load() it calls, so it raised
    NameError on every startup into a bare `except: pass`. Six Exocet builds stayed tied for weeks while the
    driver did full WOT pulls, because each restart threw away the gears they proved and the pick they made.
    Writing evidence you never read is worse than not collecting it — it looks like the system is learning.
    This asserts the round trip: what is on disk has to be visible in what the daemon answers."""
    ev = os.path.join(ROOT, "data", "identity-evidence.json")
    if not os.path.exists(ev):
        return ("warn", "no identity evidence on disk yet — nothing to restore")
    d = json.load(open(ev, encoding="utf-8"))
    gears, picks = (d.get("gears") or {}), (d.get("picked") or {})
    if not gears and not picks:
        return ("warn", "identity evidence file is empty — nothing to restore")
    bad = []
    # GEARLESS IDENTITY (2026-09-17, [[fh6-identity-two-directions]]): persisted GEARS no longer feed identity
    # (max_gear_seen is not returned any more), and a stored PICK is INERT for identity — it never manufactures a
    # 'picked' state, so a tied car honestly reads how in ("signature","newest"). Assert only that the daemon answers
    # a known, non-error identity state for a car that has a stored pick (not a gear round-trip).
    for o_ in list(picks)[:6]:
        try:
            m = http_json(f"/disk-tune?ordinal={o_}").get("match") or {}
        except Exception:
            continue
        if m.get("how") in ("no-match",):
            bad.append(f"{o_}: a pick is stored but the daemon answers how={m.get('how')!r}")
    return (not bad, f"{len(gears)} gear record(s) + {len(picks)} pick(s) on disk; identity resolves gearless"
                     if not bad else "IDENTITY STATE UNEXPECTED — " + "; ".join(bad[:2]))
check("C identify", "persisted identity evidence round-trips", c7)

def c7():
    bs = (DT.get("match") or {}).get("builds") or []
    guesses = [(b["label"], b["livery"].get("dt_h")) for b in bs if b.get("livery") and b["livery"].get("source") == "guess"]
    bad = [g for g in guesses if g[1] is not None and g[1] > 6]
    pins_ok = True
    bp = os.path.join(ROOT, "data", "build-liveries.json")
    if os.path.exists(bp):
        pins_ok = isinstance(json.load(open(bp, encoding="utf-8")).get("assoc"), dict)
    return (not bad and pins_ok, f"livery guesses={guesses or 'none'} (all <=6h: {not bad}) · pins file ok={pins_ok}")
check("C identify", "livery association: guesses bounded, pins valid", c7)

# ---------------- D. UNION ----------------
def d1():
    u = (DT.get("deliverable") or {}).get("union") or {}
    one_sided = [f["name"] for f in u.get("fields", []) if f["status"] == "conflict" and (f["save"] is None or f["telemetry"] is None)]
    return (u and not one_sided, f"fields={len(u.get('fields', []))} agree={u.get('n_agree')} conflict={u.get('n_conflict')} await={u.get('n_await')} · one-sided conflicts: {one_sided or 'none'}")
check("D union", "invariant: conflicts need two values", d1)

def d2():
    u = (DT.get("deliverable") or {}).get("union") or {}
    asks = u.get("asks", [])
    ranks = [a["rank"] for a in asks]; keys = [a["key"] for a in asks]
    return (ranks == sorted(ranks) and len(keys) == len(set(keys)), f"{len(asks)} asks, ranked={ranks == sorted(ranks)}, keys unique={len(keys) == len(set(keys))}: {keys}")
check("D union", "asks ranked + deduplicated", d2)

def d3():
    m = DT.get("match") or {}
    if m.get("how") != "unsaved-build":
        return (True, f"how={m.get('how')} (no distinct-build claim; evidence rule not exercised)")
    return (bool(m.get("evidence")), f"unsaved-build evidence: {m.get('evidence')}")
check("D union", "unsaved-build only with evidence", d3)

# ---------------- E. EVENTS ----------------
def e1():
    import socket
    req = urllib.request.Request("http://127.0.0.1:8765/events")
    with urllib.request.urlopen(req, timeout=5) as r:
        head = r.read(200).decode("utf-8", "replace")
    return ("event:" in head, f"SSE stream opens, first bytes: {head[:60]!r}")
check("E events", "SSE /events streams", e1)

def e2():
    src = open(os.path.join(ROOT, "scripts", "telemetry", "fh6_live_daemon.py"), encoding="utf-8").read()
    ok = '"match": match_m' in src and "_build_union(deliverable, ordn, match=match_m)" in src
    return (ok, "disk-watcher emit carries match + union(match) [static]")
check("E events", "SSE disk emit carries match", e2)

# ---------------- F. CLIENT ----------------
def f1():
    r = subprocess.run(["node", "--check", os.path.join(ROOT, "dashboard", "app.js")], capture_output=True, text=True)
    return (r.returncode == 0, "node --check clean" if r.returncode == 0 else r.stderr[:150])
check("F client", "app.js parses", f1)

def f2():
    served = http_raw("http://127.0.0.1:8000/app.js")
    local = open(os.path.join(ROOT, "dashboard", "app.js"), "rb").read()
    return (hashlib.sha1(served).hexdigest() == hashlib.sha1(local).hexdigest(), "served app.js == worktree file (sha1)")
check("F client", "served JS is current", f2)

def f3():
    src = open(os.path.join(ROOT, "dashboard", "app.js"), encoding="utf-8").read()
    marks = ["const unionStrip", "tuneLibraryCard", "dockDataHtml", "cornerScoreCard", "spdCorners", "buildConfidence", "gatedTuning", "liveryStrip", "idm-chips", "data-cyclelivery",
             "function clsBadge", "function piBadge", "carLblHtml", "pib-img",   # the in-game class-badge design language must exist and stay wired
             "buildThumb", "courseIdentMini", "startOfKey",   # tune identity (livery thumbnail) + course identity (name + start + shape)
             "courseTags", "courseMeasuredChip", "const GRIP", "gripLegend", "turnTable", "bindTraceHover", "data-rivals",   # course tags: type + car-fit from the measured makeup
             "data-live-map", "flashTurnOnMap", "lastCornerSvg", "geoCov", "speedTracesCard", "turnTraceStrip", "confirmRegressReason", "pinSuspended",
             # a PARTIAL lap is kept for its corners and barred from being a time — both halves must stay wired,
             # or the store's partials either vanish again or start looking like records
             "isPartial", "PARTIAL_WHY", "notTimed", "% of the course",
             "dashMapPane", "dashInfoPane", "turnTally",
             # paintSections is a wholesale innerHTML rebuild: it destroys the map SVG and recreates the car dot
             # hidden. Unless the live overlays are re-placed in the SAME task, the dot blinks out on every
             # repaint — and paintAll calls paintFrame BEFORE paintSections, which made that a certainty.
             "updCarDot(live.frame)",
             # a mapped turn must never render as "not driven" again: the trace fallback, the nearest-corner join
             # that replaced last-match, and the verdict that speaks for a corner no grip event can see
             "tracedCorner", "cornerNear", "no lift measured", "traced: t.traced",
             # the colour engine both the map and the trace draw through — one meaning per colour, per screen
             "SEG_MODES", "segScale", "segControls", "showing grip instead", "TUNE RATIFIED", "ratif-req", "fh6Ratif:"]   # live position on the course map + turn-grade rings
    missing = [m for m in marks if m not in src]
    return (not missing, f"feature markers present ({len(marks) - len(missing)}/{len(marks)}){'; missing: ' + str(missing) if missing else ''}")
check("F client", "feature surface complete", f3)

def f4():
    src = open(os.path.join(ROOT, "dashboard", "app.js"), encoding="utf-8").read()
    return ('replace(/&/g, "&amp;")' in src and 'replace(/</g, "&lt;")' in src, "esc() full-escapes & < > \" [XSS guard]")
check("F client", "esc() is a full HTML escape", f4)

def f4b():
    """A SHARED HELPER MUST BE DEFINED BEFORE ITS FIRST USE IN SOURCE ORDER. esc() lived inside buildLab() while
    gripLegend() — defined 1800 lines earlier, outside it — called esc(). `node --check` passes that happily:
    it is a scope error, not a syntax error. At runtime it threw inside gripLegend -> mapCardHtml -> courseParts
    and took the entire COURSE MAP down. Definition-after-first-use is the exact signature of that scope split."""
    src = open(os.path.join(ROOT, "dashboard", "app.js"), encoding="utf-8").read().split("\n")
    bad = []
    for name in ("esc", "gripOf", "gripCol", "gripLegend", "gripChip", "piBadge"):
        d = next((i for i, l in enumerate(src) if re.search(rf"^\s*(?:const|function)\s+{name}\b", l)), None)
        u = next((i for i, l in enumerate(src) if re.search(rf"[^\w.]{name}\(", l)
                  and not re.search(rf"^\s*(?:const|function)\s+{name}\b", l)), None)
        if d is not None and u is not None and u < d:
            bad.append(f"{name}: used at line {u+1}, defined at line {d+1}")
    return (not bad, "shared helpers defined before first use" if not bad else "USED BEFORE DEFINED — " + " · ".join(bad))
check("F client", "shared helpers are in scope where used", f4b)

def f5():
    src = open(os.path.join(ROOT, "dashboard", "app.js"), encoding="utf-8").read()
    bad = []
    if 'class="block fhm" style="border-color:#00d27a"' in src: bad.append("hardcoded green decode frame")
    if "tl-worn" in src and "removed" not in src.split("tl-worn")[0][-200:]: pass   # tolerated only in the removal comment
    if '<div class="tl-worn">' in src: bad.append("tl-worn gallery back")
    if ".dm-chip.on{border-color:#00d27a" in src: bad.append("green selection state back")
    if "really clear the history?" not in src: bad.append("two-step clear missing")
    if "curCar = (f.on && f.cid) || live.courseCar" not in src: bad.append("paused wrong-car fallback back")
    if "OFFLINE — last data" not in src: bad.append("dock offline state missing")
    return (not bad, "UX invariants hold" if not bad else "REGRESSED: " + "; ".join(bad))
check("F client", "UX audit invariants (frame/selection/clear/pause/offline)", f5)

# ---------------- G. DATA STORES ----------------
def g1():
    for fn, req in [("engine-swaps.json", 100), ("parts-pi.json", 0), ("tire-compounds.json", 0)]:
        p = os.path.join(ROOT, "data", fn)
        json.load(open(p, encoding="utf-8"))
    sw = json.load(open(os.path.join(ROOT, "data", "engine-swaps.json"), encoding="utf-8"))
    fams = len(sw.get("families") or sw)
    return (fams >= 100, f"engine catalog {fams} families; parts-pi + tire-compounds valid JSON")
check("G data", "core stores valid", g1)

def g2():
    liv = http_json("/liveries?ordinal=2866").get("liveries", [])
    th = [l for l in liv if l.get("thumb")]
    if not th:
        return ("warn", f"{len(liv)} liveries, none with thumbs to stream-test")
    img = http_raw("http://127.0.0.1:8765/livery-thumb?d=" + urllib.request.quote(th[0]["dir"]))
    trav = 404
    try:
        urllib.request.urlopen("http://127.0.0.1:8765/livery-thumb?d=..%2F..%2Fx", timeout=4)
        trav = 200
    except urllib.error.HTTPError as e:
        trav = e.code
    return (len(img) > 1000 and trav == 404, f"{len(liv)} liveries · thumb streams {len(img)}B · traversal -> {trav}")
check("G data", "livery endpoints (stream + traversal guard)", g2)

def g3():
    # COURSE FRAGMENTATION: one physical road must be ONE model. (Naming a course used to wipe its registry
    # geometry, making it unmatchable, so every later run minted a duplicate — both faults are fixed, and
    # scripts/telemetry/merge_courses.py repairs any that slip through. This keeps it from recurring silently.)
    paths, names = {}, {}
    for mp in glob.glob(os.path.join(ROOT, "data", "courses", "*.json")):
        try:
            m = json.load(open(mp, encoding="utf-8"))
        except Exception:
            continue
        k = m.get("route_key") or os.path.basename(mp)[:-5]
        if str(k).startswith("loop:"): continue
        g = m.get("geometry") or {}
        p = g.get("path") or (g.get("paths") or [[]])[0] or []
        if p: paths[k] = p
        nm = (m.get("name") or "").strip().lower()
        if nm: names.setdefault(nm, []).append(k)
    def cov(a, b):
        cb = {(int(x // 30), int(z // 30)) for x, z in b}
        hit = sum(1 for x, z in a if any((int(x // 30) + dx, int(z // 30) + dz) in cb for dx in (-1, 0, 1) for dz in (-1, 0, 1)))
        return hit / max(1, len(a))
    dups = []
    ks = sorted(paths)
    for i, a in enumerate(ks):
        for b in ks[i + 1:]:
            ab, ba = cov(paths[a], paths[b]), cov(paths[b], paths[a])
            if min(ab, ba) >= 0.70: dups.append(f"{a}~{b} ({ab:.2f}/{ba:.2f})")
    for nm, ks2 in names.items():
        if len(ks2) > 1: dups.append(f"'{nm}' split across {len(ks2)} models")
    # registry entries must keep their geometry — a start-less route is invisible to the route matcher
    try:
        R = json.load(open(os.path.join(ROOT, "data", "routes.json"), encoding="utf-8")).get("routes") or {}
    except Exception:
        R = {}
    blind = [k for k, v in R.items() if not str(k).startswith("loop:") and isinstance(v, dict) and not v.get("start")]
    if blind: dups.append(f"{len(blind)} route(s) with no start (unmatchable): {', '.join(blind[:3])}")
    return (not dups, f"{len(paths)} course models{' — ' + '; '.join(dups[:3]) if dups else ', no duplicates, every route matchable'}")
check("G data", "courses: one road = one model (no fragmentation)", g3)


def g4():
    # THE MODEL AUDIT MUST ACTUALLY RUN. audit_models.py was written precisely to catch faults in persisted
    # course state, it exits non-zero on FAIL, and nothing ever invoked it — not this harness, not a hook. So
    # when 221 turns across 18 courses were established under a superseded rule, the checker that existed to
    # notice sat on disk unrun. A check nobody runs is not a check; wiring it here is most of its value.
    import subprocess
    # PROOF OF EXECUTION, not proof of silence. `r.stdout or "[]"` meant a crashed audit parsed to zero rows, zero
    # FAILs, and a green tick — the same result as a clean run. That is the very shape of fault this check exists
    # to catch, reproduced in the check itself. So: count the models FIRST, then require the audit to have
    # actually looked at all of them. >= not ==, because the analyzer can mint a model mid-run.
    n_before = len(glob.glob(os.path.join(ROOT, "data", "courses", "*.json")))
    try:
        r = subprocess.run([sys.executable, os.path.join(HERE, "audit_models.py"), "--json"],
                           capture_output=True, text=True, timeout=120)
        rows = json.loads(r.stdout)                      # no "[]" fallback: empty stdout is a failure, not a pass
    except Exception as e:
        return (False, f"audit_models.py did not run: {e}")
    if r.returncode not in (0, 1):
        return (False, f"audit_models.py crashed (rc={r.returncode}): {(r.stderr or '').strip()[:160]}")
    n_courses = sum(1 for c in rows if not str(c["course"]).startswith("data/"))
    if n_courses < n_before:
        return (False, f"audit only examined {n_courses} of {n_before} course models — it did not run to completion")
    fails = [(c["course"], f) for c in rows for f in c["findings"] if f["severity"] == "FAIL"]
    warns = sum(1 for c in rows for f in c["findings"] if f["severity"] == "WARN")
    # KNOWN, TRACKED FAULTS. Two predate this wiring and are real but separate work: a ratcheted registry entry
    # on Hakone from a superseded map, and one route whose reference "lap" is 6.7x the median recorded lap.
    # They are allowed so the harness can go green on everything else — but only BY CODE AND COURSE, so a NEW
    # instance of either, on any other course, still fails. Delete an entry here when its fault is fixed.
    # EMPTY, and it should stay that way. Both entries left by fixing the fault, not by being tolerated:
    # 1900_6100's map-too-long was a point-to-point judged by a circuit's rule (check retired), and
    # -2350_-7550's phantom-turn was a superseded registry apex that rebind_map_turns.py cleared when it rebuilt
    # the registry from the map. An allowlist should only ever shrink; a new entry needs a reason in writing.
    KNOWN = set()
    fresh = [(k, f) for k, f in fails if (k, f["code"]) not in KNOWN]
    msg = f"{len(rows)} models audited · {len(fails)} FAIL ({len(fails) - len(fresh)} known) · {warns} WARN"
    if fresh:
        msg += " — NEW: " + "; ".join(f"{k}: {f['code']}" for k, f in fresh[:3])
    return (not fresh, msg)
check("G data", "course-model audit (persisted-state invariants)", g4)

# ---------------- report ----------------
if "--json" in sys.argv:
    print(json.dumps(RESULTS, indent=1)); sys.exit(0)
W = {"PASS": "✅", "WARN": "🟡", "FAIL": "❌"}
cur = None
for r in RESULTS:
    if r["group"] != cur:
        cur = r["group"]; print(f"\n=== {cur} ===")
    print(f" {W[r['status']]} {r['name']:46} {r['detail']}")
n = {"PASS": 0, "WARN": 0, "FAIL": 0}
for r in RESULTS: n[r["status"]] += 1
print(f"\nTOTAL: {n['PASS']} pass · {n['WARN']} warn · {n['FAIL']} fail  ({len(RESULTS)} attributes)")
sys.exit(1 if n["FAIL"] else 0)
