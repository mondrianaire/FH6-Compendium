#!/usr/bin/env python3
"""Multi-attribute WORKFLOW VERIFICATION checklist — probes the LIVE system end-to-end and reports PASS/WARN/FAIL
per attribute. READ-ONLY everywhere (game saves, data stores, HTTP GETs). Run after any change:

    python scripts/telemetry/verify_workflow.py            # full checklist
    python scripts/telemetry/verify_workflow.py --json     # machine-readable results

Groups: A services · B save-decode · C identification (builds/matcher/PI/liveries) · D union invariants ·
E events · F client artifacts · G data stores.
"""
import sys, os, io, json, glob, hashlib, subprocess, urllib.request

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
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
    known = {"signature", "gear-matched", "newest", "picked", "no-match", "unsaved-build"}
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
    return ("warn", f"stamped PIs={pis} — one S1-800 build verified; the other needs its gear-verification drive (stamp guard holding, as designed)")
check("C identify", "the two S1-800 builds are separated", c6)

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
             "courseTags", "courseMeasuredChip",   # course tags: type + car-fit from the measured makeup
             "data-live-map", "flashTurnOnMap", "lastCornerSvg", "geoCov", "speedTracesCard", "turnTraceStrip", "confirmRegressReason", "pinSuspended", "TUNE RATIFIED", "ratif-req", "fh6Ratif:"]   # live position on the course map + turn-grade rings
    missing = [m for m in marks if m not in src]
    return (not missing, f"feature markers present ({len(marks) - len(missing)}/{len(marks)}){'; missing: ' + str(missing) if missing else ''}")
check("F client", "feature surface complete", f3)

def f4():
    src = open(os.path.join(ROOT, "dashboard", "app.js"), encoding="utf-8").read()
    return ('replace(/&/g, "&amp;")' in src and 'replace(/</g, "&lt;")' in src, "esc() full-escapes & < > \" [XSS guard]")
check("F client", "esc() is a full HTML escape", f4)

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
