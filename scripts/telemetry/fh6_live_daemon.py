#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
FH6 live telemetry daemon — receives Data Out UDP, records the CSV, and streams live state to the
dashboard over Server-Sent Events (stdlib only). Auto-runs the session analyzer when driving stops.

  python scripts/telemetry/fh6_live_daemon.py                    # listen UDP 9876, serve http://localhost:8765
  python scripts/telemetry/fh6_live_daemon.py --replay captures/fh6_20260821_122523.csv [--speed 2]
                                                                # replay a recorded capture through the same pipeline

Endpoints:  GET /events  (SSE: status / frame ~20 Hz / strip per second / corner / session)
            GET /session.json  (latest auto-analysis)   GET /health
Dashboard: Telemetry Lab -> Live (EventSource on http://localhost:8765/events)
"""
import argparse, csv, json, math, os, socket, struct, subprocess, sys, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from fh6_dataout_capture import FH_FMT, FIELDS, W, decode  # noqa: E402
try:
    import fh6_tune_decode as TUNE  # on-disk tune reader (stdlib); optional
except Exception:
    TUNE = None

ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
G = 9.80665
CLASS = {0: "D", 1: "C", 2: "B", 3: "A", 4: "S1", 5: "S2", 6: "X", 7: "X"}
DRIVE = {0: "FWD", 1: "RWD", 2: "AWD"}

# Feature B — per-part PI scaffolding: pair the active car's on-disk decoded config with its live CarPI.
PI_OBS_PATH = os.path.join(ROOT, "data", "pi-observations.json")
_PI_LOCK = threading.Lock()
_BL_LOCK = threading.Lock()   # data/build-letters.json — the permanent build-letter registry
_PI_LAST = [None]   # (ordinal, parts_hash, car_pi) of the last write — cheap dedup so the file isn't thrashed

class State:
    def __init__(self):
        self.lock = threading.Lock()
        self.latest = None          # compact frame dict
        self.frames = 0; self.t0 = time.monotonic(); self.last_pkt = 0.0
        self.pps_win = []           # timestamps for pps
        self.strip = []             # per-second entries
        self._sec = None; self._sec_rows = []
        self.corners = []           # closed corners (compact)
        self._corner = None         # open corner accumulator
        self.cars = {}              # ordinal -> info
        self.csv_path = None; self.csv_writer = None; self.csv_file = None
        self.last_on_t = None; self.live_since_analysis = 0.0; self.drive_since_periodic = 0.0; self.analyzing = False; self.replay = False
        self.last_lapnum = None; self._last_lap_analysis = 0.0   # LAP-completion analysis trigger (the granularity the cross-lap limiter changes at)
        self.session_json = None; self.session_path = None; self.analysis = None
        self.stint = 0; self.stint_start = None; self._zero_since = None; self.prev_cfg = None; self.stint_tags = {}
        self.last_pos = None; self.loop = None; self.loop_lap = 0; self._loop_state = "start"; self._loop_away = 0.0; self._loop_prev = None; self._loop_t0 = None; self.loop_last_s = None; self._auto_loop = False; self._auto_suspend = None   # _auto_loop: the current loop was auto-started by a timed event (Rivals), not a manual mark; _auto_suspend: odometer/lap-timer snapshot taken at a mid-event pause (J7)
        self.last_t = 0.0; self.game = "menu"; self.game_kind = None; self._noev_since = None; self.ev_maxpos = 0; self.mode_suggest = None; self.mode_reason = None   # lab-mode auto-detection
        self.lab_mode = None; self._force_split = False; self._ev_edge = False; self.stint_starts = {}; self.last_drive_game = None   # effective lab mode (pushed by the dashboard), manual split request, event edge pending, run boundaries (t_mono)
        self.events = []            # queued one-shot events (strip/corner/session) for SSE clients: list of (seq, name, payload)
        self.seq = 0
        self.clone_lock = None      # ordinal the user pinned as a CLONE TARGET — while set, PI/catalog accrual for it is paused (building the replica must not poison the target)
        self.gears_seen = {}        # ordinal -> set of forward gears USED at speed this session — hard identity evidence (you cannot use gear 8 in a 6-speed box)
    def emit(self, name, payload):
        with self.lock:
            self.seq += 1; self.events.append((self.seq, name, payload))
            if len(self.events) > 2000: self.events = self.events[-2000:]

ST = State()

def cid(p): return f'{p["CarOrdinal"]}|{p["DrivetrainType"]}|{p["NumCylinders"]}|{p["CarPI"]}'
NAMES_PATH = os.path.join(ROOT, "data", "car-ordinals.json")
def names_load():
    try:
        with open(NAMES_PATH, encoding="utf-8") as f: return json.load(f)
    except Exception: return {"schema_version": "1.0.0", "cars": {}, "builds": {}}
def names_save(obj):
    with open(NAMES_PATH, "w", encoding="utf-8") as f: json.dump(obj, f, indent=2, ensure_ascii=False)

def compact(p, t_mono):
    fl = lambda k: round(p[k], 3)
    return {
        "t": round(t_mono, 2), "on": p["IsRaceOn"], "car": p["CarOrdinal"], "cid": cid(p), "pi": p["CarPI"], "cls": CLASS.get(p["CarClass"], "?"), "drv": DRIVE.get(p["DrivetrainType"], "?"), "cyl": p["NumCylinders"],
        "gear": p["Gear"], "mph": round(p["Speed"] * 2.23694, 1), "rpm": round(p["CurrentEngineRpm"]), "maxrpm": round(p["EngineMaxRpm"]),
        "ev": 1 if p["CurrentLap"] > 0 else 0, "lapn": p["LapNumber"], "rpos": p["RacePosition"], "lapt": round(p["CurrentLap"], 2), "dist": round(p["DistanceTraveled"]), "px": round(p["PosX"], 1), "pz": round(p["PosZ"], 1),   # ev = lap timer running (RacePosition lingers after an event ends)
        "lat": round(p["AccelX"] / G, 2), "lon": round(p["AccelZ"] / G, 2), "yaw": round(math.degrees(p["AngVelY"]), 1),
        "steer": p["Steer"], "thr": p["Accel"], "brk": p["Brake"], "hb": p["HandBrake"], "boost": round(p["Boost"], 1),
        "hp": round(p["Power"] / 745.7), "tq": round(p["Torque"] * 0.7376),
        "slip": {w: [fl("SlipRatio" + w), fl("SlipAngle" + w), fl("CombinedSlip" + w)] for w in W},
        "susp": [round(p["NormSusp" + w], 3) for w in W],
        "temp": [round(p["TireTempF" + w]) for w in W],
        "smash": round(p["SmashableVelDiff"], 2),
    }

def _mode_suggest(t_mono):
    """Lab-mode auto-detection from game state. Timed event (Rivals/race) -> COURSE; free roam -> COURSE if lapping a
    marked reference loop, DECODE if a donor/replica run is flagged, else FREE (whole-session advisor). Emits on change only."""
    if ST.game == "event": sug, why = "course", f"timed event detected ({ST.game_kind or 'timed'})"
    elif ST.game == "freeroam":
        with ST.lock: roles = {v.get("role") for v in list(ST.stint_tags.values()) if isinstance(v, dict)}; loop = ST.loop; lstate = ST._loop_state   # snapshot under the lock: /tag, /role, /clear-loop mutate these from the HTTP thread
        if loop and lstate != "start": sug, why = "course", f"lapping reference loop “{loop['name']}”"
        elif "donor" in roles or "replica" in roles: sug, why = "decode", "donor / replica run flagged this session"
        else: sug, why = "free", "free roam — whole-session advisor"
    else: return   # menus / pause: keep the last suggestion sticky (a pause mid-Rivals must not flap Course -> Free -> Course)
    if sug != ST.mode_suggest or why != ST.mode_reason:
        ST.mode_suggest, ST.mode_reason = sug, why
        ST.emit("mode", {"game": ST.game, "kind": ST.game_kind, "suggest": sug, "reason": why, "t": round(t_mono, 1)})

def _save_tags():
    """Persist run tags/roles AND the authoritative run boundaries (absolute t_mono) so the offline analyzer numbers runs identically."""
    if not ST.csv_path or ST.replay: return   # replay must NEVER touch the source session's tags file (relative clock + would clobber real tags)
    sid = os.path.splitext(os.path.basename(ST.csv_path))[0]; tp = os.path.join(ROOT, "data", "sessions", sid + ".tags.json")
    os.makedirs(os.path.dirname(tp), exist_ok=True)
    with open(tp, "w", encoding="utf-8") as f: json.dump({"session": sid, "stints": ST.stint_tags, "stint_starts": ST.stint_starts}, f, indent=2, ensure_ascii=False)

def _match_route_name(sf):
    """Best-effort LIVE course name: the nearest known route start within ~120 m. The analyzer does the rigorous
    attribution (start + heading + length); this is only for the live 'auto-tracking X' label."""
    try:
        with open(os.path.join(ROOT, "data", "routes.json"), encoding="utf-8") as f:
            routes = json.load(f).get("routes", {})
        best, bd = None, 120.0
        for key, r in routes.items():
            rs = r.get("start")
            if rs and len(rs) >= 2:
                d = math.hypot(sf[0] - rs[0], sf[1] - rs[1])
                if d < bd: bd, best = d, (r.get("name") or key)
        return best
    except Exception:
        return None

def _end_auto_course(t_mono, p, c):
    """A timed event ended (finish, crash, or restart). Complete the OPEN pass so nothing is wasted: this is a
    point-to-point sprint's only pass, a circuit's final lap, OR a partial/crashed practice run — all of which carry
    real cornering data (off-line data maps the grip envelope). Classify topology, then clear the auto-course."""
    lp = ST.loop
    if not lp or not ST._auto_loop:
        ST._auto_loop = False
        return
    # Topology: only a completed lap (LapNumber increment -> "circuit") is provable LIVE. A single run that ends far
    # from the start could equally be a genuine A->B finish OR a crashed circuit lap — indistinguishable here — so it
    # stays "unknown" and the analyzer classifies it authoritatively across runs + the route registry.
    topo = lp.get("topology", "unknown")
    # complete the open pass if a meaningful distance was driven since the last start/lap boundary (skips instant aborts)
    if ST._loop_state == "in" and ST._loop_away > 80:
        ST.loop_lap += 1; ST.loop_last_s = round(t_mono - (ST._loop_t0 or t_mono), 2)
        ST.emit("lap", {"loop": lp["name"], "lap": ST.loop_lap, "time_s": ST.loop_last_s, "final": True, "topology": topo, "dist_m": round(ST._loop_away)})
        maybe_lap_analysis(t_mono, "event end (" + topo + ")")
    with ST.lock:
        ST.loop = None; ST._auto_loop = False; ST._loop_state = "start"; ST._loop_away = 0.0; ST._auto_suspend = None
    ST.emit("loop", {"name": None})

def ingest(p, t_mono):
    """Core pipeline for one decoded packet (live or replay)."""
    c = compact(p, t_mono)
    # game mode FIRST (the run rule depends on it): timed event (Rivals / race) vs free roam vs menus — 1.5 s hysteresis on event exit
    ST.last_t = t_mono
    g = "menu" if not c["on"] else ("event" if c["ev"] else "freeroam")
    if g == "event":
        ST._noev_since = None; ST.ev_maxpos = max(ST.ev_maxpos, int(c["rpos"] or 0))
    elif ST.game == "event" and g == "freeroam":
        ST._noev_since = ST._noev_since or t_mono
        if t_mono - ST._noev_since < 1.5: g = "event"
    if g in ("event", "freeroam"):
        if ST.last_drive_game is not None and g != ST.last_drive_game: ST._ev_edge = True   # event <-> free roam edge = new run (a pause mid-event is NOT an edge)
        ST.last_drive_game = g
    if g != ST.game:
        if ST.game == "event" and ST._auto_loop:
            if g == "menu": ST._auto_suspend = {"dist": c["dist"], "lapt": c["lapt"]}   # J7: a pause is NOT an event exit — suspend, decide on the way back out (ending here fabricated a final pass + re-anchored the course at the pause position)
            else: _end_auto_course(t_mono, p, c)   # event finish / crash -> complete the open pass (P2P, final lap, or partial), then clear the auto-course
        elif ST.game == "menu" and ST._auto_suspend is not None:
            sus = ST._auto_suspend; ST._auto_suspend = None
            resumed = g == "event" and c["dist"] >= sus["dist"] - 50 and c["lapt"] >= sus["lapt"] - 1   # odometer + lap timer CONTINUE across a resume, RESET on a pause-menu restart (analyzer precedent) — a resume keeps the loop untouched
            if not resumed: _end_auto_course(t_mono, p, c)   # quit to free roam, or restart: the suspended run is over (its partial pass still counts); a restart re-anchors at the real grid via last_pos below
        ST.game = g
        if g == "freeroam": ST.ev_maxpos = 0; ST.game_kind = None
        elif g == "event": ST.game_kind = ST.game_kind or ("race" if ST.ev_maxpos > 2 else "rivals / timed")   # kind survives a pause
    elif g == "event" and ST.game_kind != "race" and ST.ev_maxpos > 2: ST.game_kind = "race"
    _mode_suggest(t_mono)
    # run (stint) boundaries — MODE-AWARE. Always: build/config change, event start/finish, or an explicit ➕ new run.
    # Course mode only: driving resumes after >= 2 s off (each attempt = a run). Decode / Free: menus & fast travel do NOT split a run.
    if c["on"]:
        eff = ST.lab_mode or ST.mode_suggest or "free"
        gap = ST._zero_since is not None and t_mono - ST._zero_since >= 2.0
        if ST.prev_cfg is None or c["cid"] != ST.prev_cfg or ST._ev_edge or ST._force_split or (gap and eff == "course"):
            why = "first drive" if ST.prev_cfg is None else "build change" if c["cid"] != ST.prev_cfg else "event start / finish" if ST._ev_edge else "new run (manual)" if ST._force_split else "menu gap (course mode)"
            ST.stint += 1; ST.stint_start = t_mono; ST._force_split = False; ST._ev_edge = False; ST.stint_starts[str(ST.stint)] = round(t_mono, 3)
            ST.emit("stint", {"n": ST.stint, "t0": round(t_mono, 1), "id": c["cid"], "why": why}); _save_tags()
        ST._zero_since = None; ST.prev_cfg = c["cid"]
    elif ST._zero_since is None: ST._zero_since = t_mono
    c["stint"] = ST.stint
    if c["on"] and c["car"] and 1 <= (c["gear"] or 0) <= 10 and c["mph"] > 15:   # gears actually USED at speed — the cheapest exact identity evidence
        ST.gears_seen.setdefault(str(c["car"]), set()).add(int(c["gear"]))
    if c["on"] and (abs(p["PosX"]) > 1 or abs(p["PosZ"]) > 1): ST.last_pos = (p["PosX"], p["PosZ"])   # only real ON-TRACK positions — a menu / pre-race frame reports [0,0] and must NEVER become a loop start (the bug that put every marked loop at the origin)
    # AUTO-COURSE: a timed event (Rivals / race) auto-starts course recording at the S/F line — no manual mark needed.
    # Reuses the loop machinery below for circuit laps; a point-to-point sprint's single pass and any partial/crashed
    # practice run complete at event end (_end_auto_course). Never overrides a manually-marked loop.
    if c["on"] and ST.game == "event" and ST.loop is None and ST.last_pos is not None:
        sf = [round(ST.last_pos[0]), round(ST.last_pos[1])]
        nm = _match_route_name(sf) or "Rivals course"
        with ST.lock:
            ST.loop = {"name": nm, "start": sf, "radius": 60, "min_dist": 250, "auto": True, "topology": "unknown", "sf_fixed": False}
            ST.loop_lap = 0; ST._loop_state = "start"; ST._loop_away = 0.0; ST._loop_prev = None; ST._loop_t0 = t_mono; ST.loop_last_s = None; ST._auto_loop = True
        ST.emit("loop", {"name": nm, "start": sf, "lap": 0, "auto": True})
    # reference-loop live lap counting: each return through the start (after leaving by min_dist) = one lap
    if ST.loop and c["on"]:
        lx, lz = ST.loop["start"]; R = ST.loop.get("radius", 60); MIND = ST.loop.get("min_dist", 250)
        d0 = math.hypot(p["PosX"] - lx, p["PosZ"] - lz)
        if ST._loop_state == "start":
            if d0 <= R: ST._loop_state = "in"; ST._loop_away = 0.0; ST._loop_t0 = t_mono
        else:
            if ST._loop_prev is not None: ST._loop_away += math.hypot(p["PosX"] - ST._loop_prev[0], p["PosZ"] - ST._loop_prev[1])
            if ST._loop_away > MIND and d0 <= R:
                ST.loop_lap += 1; ST.loop_last_s = round(t_mono - (ST._loop_t0 or t_mono), 2)
                ST.emit("lap", {"loop": ST.loop["name"], "lap": ST.loop_lap, "time_s": ST.loop_last_s}); maybe_lap_analysis(t_mono, "loop lap")
                ST._loop_away = 0.0; ST._loop_t0 = t_mono
    if c["on"]: ST._loop_prev = (p["PosX"], p["PosZ"])   # menu frames report (0,0) — tracking them would add phantom kilometres to _loop_away across a pause (J7)
    # CSV row (same layout as capture tool)
    if ST.csv_writer:
        row = [time.time(), t_mono, p["Speed"] * 2.23694, p["AccelX"] / G, p["AccelZ"] / G, math.degrees(p["AngVelY"])]
        row += [(p["TireTempF" + w] - 32.0) * 5.0 / 9.0 for w in W] + [p[k] for k in FIELDS]
        ST.csv_writer.writerow(row)
    with ST.lock:
        ST.latest = c; ST.frames += 1; ST.last_pkt = time.monotonic()
        ST.pps_win.append(ST.last_pkt); ST.pps_win = [x for x in ST.pps_win if ST.last_pkt - x < 2.0]
        if c["on"] and c["cid"] not in ST.cars:
            nm = (names_load().get("cars", {}).get(str(c["car"])) or {}).get("name")
            ST.cars[c["cid"]] = {"id": c["cid"], "ordinal": c["car"], "pi": c["pi"], "class": c["cls"], "drivetrain": c["drv"], "cyl": p["NumCylinders"], "max_rpm": c["maxrpm"], "idle_rpm": round(p["EngineIdleRpm"]), "car_group": p["CarGroup"], "name": nm, "gears": [], "dyno": [], "live_s": 0}
            new_cfg = dict(ST.cars[c["cid"]])
        else: new_cfg = None
    if new_cfg: ST.emit("config", new_cfg)
    # per-second strip
    sec = int(t_mono)
    if ST._sec is None: ST._sec = sec
    if sec != ST._sec:
        rows = ST._sec_rows; ST._sec_rows = []; s_prev = ST._sec; ST._sec = sec
        if rows:
            on = [r for r in rows if r["on"]]
            if len(on) < len(rows) / 2: e = {"t": s_prev, "state": "off"}
            else:
                fr = max(max(abs(r["slip"]["FL"][2]), abs(r["slip"]["FR"][2])) for r in on)
                rr = max(max(abs(r["slip"]["RL"][2]), abs(r["slip"]["RR"][2])) for r in on)
                imp = any(abs(r["lat"]) > 3.0 or r["smash"] > 0 for r in on)
                st = "impact" if imp else ("both" if fr > 1 and rr > 1 else "front" if fr > 1 else "rear" if rr > 1 else "calm")
                e = {"t": s_prev, "state": st, "car": on[-1]["cid"], "mph": round(sum(r["mph"] for r in on) / len(on)), "f": round(fr, 2), "r": round(rr, 2), "g": round(max(abs(r["lat"]) for r in on), 2)}
            with ST.lock: ST.strip.append(e)
            ST.emit("strip", e)
    ST._sec_rows.append(c)
    # live corner detector (same thresholds as analyzer, simplified phases)
    lat = c["lat"]
    if c["on"] and abs(lat) > 0.35 and ST._corner is None:
        ST._corner = {"t0": t_mono, "car": c["cid"], "rows": [c], "pre": [r for r in ST._sec_rows[-60:]]}
    elif ST._corner is not None:
        ST._corner["rows"].append(c)
        if abs(lat) < 0.25 or not c["on"]:
            co = ST._corner; ST._corner = None
            rows = co["rows"]
            if rows[-1]["t"] - rows[0]["t"] >= 0.8 and not any(abs(r["lat"]) > 3 for r in rows):
                peak = max(abs(r["lat"]) for r in rows); sign = 1 if sum(r["lat"] for r in rows) > 0 else -1
                k80 = [i for i, r in enumerate(rows) if abs(r["lat"]) >= 0.8 * peak]; k2, k4 = k80[0], k80[-1]
                def axle(rs):
                    f = max((max(abs(r["slip"]["FL"][2]), abs(r["slip"]["FR"][2])) for r in rs), default=0)
                    b = max((max(abs(r["slip"]["RL"][2]), abs(r["slip"]["RR"][2])) for r in rs), default=0)
                    return round(f, 2), round(b, 2)
                parts = [(1, co["pre"]), (2, rows[:k2 + 1]), (3, rows[k2:k4 + 1]), (4, rows[k4:])]
                phases = []; first = None
                for ph, rs in parts:
                    f, b = axle(rs); who = "both" if f > 1 and b > 1 else "front" if f > 1 else "rear" if b > 1 else "none"
                    if who != "none" and first is None:
                        tf = next((r["t"] for r in rs if max(abs(r["slip"]["FL"][2]), abs(r["slip"]["FR"][2])) > 1), None)
                        tr = next((r["t"] for r in rs if max(abs(r["slip"]["RL"][2]), abs(r["slip"]["RR"][2])) > 1), None)
                        first = {"phase": ph, "axle": "front" if (tf is not None and (tr is None or tf <= tr)) else "rear"}
                    phases.append({"phase": ph, "front": f, "rear": b, "red": who, "dur": round((rs[-1]["t"] - rs[0]["t"]) if rs else 0, 2)})
                mid = rows[k2:k4 + 1]
                usi = sum((abs(r["slip"]["FL"][1]) + abs(r["slip"]["FR"][1])) / 2 - (abs(r["slip"]["RL"][1]) + abs(r["slip"]["RR"][1])) / 2 for r in mid) / max(len(mid), 1)
                drift = sum(max(abs(r["slip"]["RL"][2]), abs(r["slip"]["RR"][2])) for r in rows) / len(rows) > 2.5
                v_min = min(r["mph"] for r in rows); ipk = max(range(len(rows)), key=lambda i: abs(rows[i]["lat"])); apx = rows[ipk]
                # braking point: metres of odometer before the apex where the brakes first came on hard; throttle-on: metres after apex
                brk_r = next((r for r in co["pre"] + rows[:ipk + 1] if r["brk"] > 40), None); imin = min(range(len(rows)), key=lambda i: rows[i]["mph"]); thr_r = next((r for r in rows[imin:] if r["thr"] > 100), None)
                cc = {"t0": round(rows[0]["t"], 1), "t1": round(rows[-1]["t"], 1), "car": co["car"], "stint": ST.stint,
                      "lapn": (((apx.get("lapn") or 0) + 1) if apx.get("ev") else None),   # J11: 1-based in events, None outside — telemetry's 0-based lap read as falsy everywhere downstream
                      "ev": 1 if apx.get("ev") else 0,   # J14: on-course truth stamped at the source — free-roam corners must never share a canonical-turn key with course corners
                      "dir": "R" if sign > 0 else "L",
                      "mph_in": round(rows[0]["mph"]), "mph_min": round(v_min), "mph_out": round(rows[-1]["mph"]), "mph_apex": round(apx["mph"]), "apex": [apx.get("px"), apx.get("pz")], "loop_lap": (ST.loop_lap if ST.loop else None),
                      "lat_g_peak": round(peak, 2), "phases": phases, "first_red": first, "usi": round(usi, 3), "drift": drift, "kink": v_min > 85 and peak < 0.9,
                      "brake_on_m": (round(apx.get("dist", 0) - brk_r["dist"]) if brk_r else None), "throttle_on_m": (round(thr_r["dist"] - apx.get("dist", 0)) if thr_r else None),
                      "brake_max": max([r["brk"] for r in co["pre"] + rows] or [0]), "hb": any(r["hb"] > 0 for r in rows)}
                with ST.lock: ST.corners.append(cc)
                ST.emit("corner", cc)
    # LAP-COMPLETION trigger: a finished lap adds a fresh pass of every turn, so the cross-lap read can update NOW
    if c["on"] and c["ev"]:
        _ln = c.get("lapn", 0)
        if ST.last_lapnum is not None and _ln > ST.last_lapnum:
            if ST._auto_loop and ST.loop and not ST.loop.get("sf_fixed"):   # the first LapNumber increment IS the exact S/F crossing (a real on-track position) — pin the loop there, and a lap counter proves it's a circuit
                with ST.lock:
                    ST.loop["start"] = [round(p["PosX"]), round(p["PosZ"])]; ST.loop["sf_fixed"] = True; ST.loop["topology"] = "circuit"
                    ST._loop_state = "in"; ST._loop_away = 0.0; ST._loop_t0 = t_mono
                ST.emit("loop", {"name": ST.loop["name"], "start": ST.loop["start"], "lap": ST.loop_lap, "auto": True, "topology": "circuit"})
            maybe_lap_analysis(t_mono, "event lap")
        ST.last_lapnum = _ln
    else:
        ST.last_lapnum = None
    # auto-analysis triggers: (a) every ~20 s of driving (live suggestions), (b) driving stopped > 5 s after >= 15 s of driving (session close)
    if c["on"]:
        ST.last_on_t = t_mono; ST.live_since_analysis += 1 / 100.0; ST.drive_since_periodic += 1 / 100.0
        try: sz = os.path.getsize(ST.csv_path) if ST.csv_path and not ST.replay else 0
        except Exception: sz = 0
        period = 20 if sz < 60e6 else 45 if sz < 150e6 else 90 if sz < 350e6 else 300   # re-analysis cadence scales with file size (use ↺ reset to start a fresh, fast session). Past ~350MB an analysis takes ~as long as the old 90s ceiling — back-to-back analyzer runs saturated a core + disk and lagged the GAME; 300s keeps a huge session usable until the reset
        if ST.drive_since_periodic > period and not ST.analyzing and ST.csv_path:
            ST.drive_since_periodic = 0; threading.Thread(target=run_analysis, args=(t_mono, False), daemon=True).start()
    elif ST.last_on_t is not None and t_mono - ST.last_on_t > 5 and ST.live_since_analysis > 15 and not ST.analyzing and ST.csv_path:
        ST.live_since_analysis = 0; threading.Thread(target=run_analysis, args=(t_mono, True), daemon=True).start()

def maybe_lap_analysis(t_mono, why):
    """Re-run the cross-lap analysis the instant a LAP completes — a finished lap adds one fresh pass of every turn,
    which is exactly when the tune-vs-driver limiter can change. Debounced (6 s) so short laps can't thrash the
    analyze_session subprocess; the periodic timer stays as the fallback for long laps / free roam."""
    if ST.analyzing or not ST.csv_path or (t_mono - ST._last_lap_analysis) < 6:
        return
    ST._last_lap_analysis = t_mono; ST.drive_since_periodic = 0.0
    threading.Thread(target=run_analysis, args=(t_mono, False), daemon=True).start()


def run_analysis(until=None, final=True):
    ST.analyzing = True
    try:
        if ST.csv_file: ST.csv_file.flush()
        # replay analyses go to a scratch dir so they never overwrite the canonical session JSON
        outdir = os.path.join(ROOT, "data", "sessions") if not ST.replay else os.path.join(ROOT, "captures", "_replay_analysis")
        os.makedirs(outdir, exist_ok=True)
        cmd = [sys.executable, os.path.join(HERE, "analyze_session.py"), ST.csv_path, "--out", outdir]
        if ST.replay and until is not None: cmd += ["--until", str(until)]
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
        sid = os.path.splitext(os.path.basename(ST.csv_path))[0]
        path = os.path.join(outdir, sid + ".json")
        if os.path.exists(path):
            with open(path) as f: js = json.load(f)
            an = {"id": js["id"], "summary": js["summary"], "final": final, "cars": [{k: c.get(k) for k in ("id", "ordinal", "name", "class", "pi", "drivetrain", "cyl", "build_id", "coverage", "advice", "general", "decode", "clone_sheet", "temps_med_f", "live_s")} for c in js["cars"]],
                  "courses": [{k: v for k, v in co.items() if k != "geometry"} for co in js.get("courses", [])[:4]],   # geometry (maps, layouts) is heavy and lives in /session.json, which the dashboard fetches after every analysis
                  "stints": [{k: st.get(k) for k in ("n", "id", "label", "role", "t0", "t1")} for st in js.get("stints", [])][-20:]}
            with ST.lock: ST.session_json = js; ST.session_path = path; ST.analysis = an
            ST.emit("analysis", an)
            if final: ST.emit("session", {"id": js["id"], "summary": js["summary"], "path": os.path.relpath(path, ROOT)})
            print(f"[analysis{' final' if final else ''}] {js['id']} -> {js['summary']}")
        else:
            print("[analysis] failed:", r.stdout[-300:], r.stderr[-300:])
    finally:
        ST.analyzing = False

# ---------------- HTTP / SSE ----------------
def _enrich_gears(deliverable, ordn):
    """Upgrade decoded gears from band-DERIVED to telemetry-MEASURED: the analyzer's fd_gear is the exact FD*gear
    product per gear (from WheelRotSpeed, wheelspin-immune), so gear = fd_gear / final_drive is a measured ratio
    (drops the gear-band assumption; final drive stays band-derived). Best-effort: only when this car was driven
    through its gears this session."""
    try:
        import re as _re
        with ST.lock:
            sj = ST.session_json
        if not sj:
            return
        fdg = None
        for c in sj.get("cars", []):
            if str(c.get("ordinal")) == str(ordn):
                gl = {g["gear"]: g["fd_gear"] for g in (c.get("gears") or []) if g.get("fd_gear")}
                if gl:
                    fdg = gl; break
        # STABILITY: cache the measured ladder so gears don't pop out of 'measured' when a fresh analysis briefly
        # lacks them (sparse WOT frames in the last window) — the ladder is a physical property of the build. Keyed by
        # BUILD identity (ordinal + gear count + decoded cyl), never bare ordinal: a stale ladder from a DIFFERENT
        # build of the same car isn't data for this one, and serving it manufactured phantom gear conflicts.
        if not hasattr(ST, "fdg_cache"):
            ST.fdg_cache = {}
        ckey = f"{ordn}|{deliverable.get('gear_count')}|{_deliverable_cyl(deliverable)}"
        now_t = time.time()
        for k in [k for k, v in ST.fdg_cache.items() if now_t - v["t"] > 3600]:   # evict, don't just ignore — the dict must not grow for the daemon's lifetime
            ST.fdg_cache.pop(k, None)
        if fdg:
            if max(fdg) <= (deliverable.get("gear_count") or 99):   # a ladder with more gears than this save's box belongs to another build — don't cache it against this one
                prev = ST.fdg_cache.get(ckey)
                if prev and now_t - prev["t"] < 1800:   # MERGE: a sparse fresh sample must not clobber a fuller recent ladder (fresh gears win per-gear)
                    merged = dict(prev["fdg"]); merged.update(fdg); fdg = merged
                ST.fdg_cache[ckey] = {"fdg": fdg, "t": now_t}
            else:
                fdg = {}
        if not fdg:
            cached = ST.fdg_cache.get(ckey)
            if cached and now_t - cached["t"] < 1800:
                fdg = cached["fdg"]
        if not fdg:
            return
        fd = None
        for t in deliverable.get("tabs", []):
            for r in t.get("rows", []):
                if r.get("field") == "final_drive" and r.get("value"):
                    fd = r["value"]
        if not fd:
            return
        ratios = []   # val/sv per reconciled gear — a CONSTANT factor across gears means the shared DIVISOR (final drive) is off, not the gears
        for t in deliverable.get("tabs", []):
            if t.get("tab") != "Gearing":
                continue
            for r in t["rows"]:
                m = _re.match(r"gear_(\d+)$", str(r.get("field", "")))
                if m and int(m.group(1)) in fdg:
                    val = round(fdg[int(m.group(1))] / fd, 3)
                    # RECONCILE, don't silently overwrite: keep the save's band-derived value alongside the telemetry
                    # measurement. Agreement (within 4%) CORROBORATES (conf 0.97); disagreement is a CONFLICT — surfaced
                    # to the union strip with BOTH numbers, confidence dropped, telemetry shown (it's the direct read).
                    sv = r.get("value")
                    r["save_value"] = sv
                    r["value"] = val; r["display"] = f"{val}:1"; r["telemetry"] = True; r["derived"] = False
                    if sv is not None and sv > 0:
                        ratios.append(val / sv)
                    # HYSTERESIS: verdicts were flapping — each ~20s analysis re-measures the ladder with a little
                    # jitter, and a single 4% cutoff flipped agree<->conflict constantly. Now: clearly out (>=7%) ->
                    # conflict; clearly in (<=3.5%) -> agree; the band between KEEPS the previous verdict (per
                    # ordinal+gear+save-value, so a new save/tune naturally resets it).
                    if not hasattr(ST, "gear_verdicts"):
                        ST.gear_verdicts = {}
                    if sv is not None and sv > 0:
                        dev = abs(val - sv) / sv
                        vkey = f"{ordn}|{m.group(1)}|{round(sv, 3)}"
                        # first-seen inside the dead band is NEAR — measured but neither corroborated nor conflicting.
                        # It resolves to agree/conflict only when the evidence clearly crosses a line; a persistent
                        # 4-7% mismatch must not masquerade as 'agree 0.97' forever.
                        verdict = "conflict" if dev >= 0.07 else ("agree" if dev <= 0.035 else ST.gear_verdicts.get(vkey, "near"))
                        ST.gear_verdicts[vkey] = verdict
                        if verdict == "conflict":
                            r["conflict"] = {"save": sv, "telemetry": val}; r["confidence"] = 0.5
                        elif verdict == "agree":
                            r["agree"] = True; r["confidence"] = 0.97
                        else:
                            r["confidence"] = 0.85   # near: shown as measured, no corroborated/conflict flag
                    else:
                        r["confidence"] = 0.97
        # DIAGNOSE a systematic gear conflict. Both sides are derived through bands (save: gear band; telemetry:
        # exact fd_gear / band-derived FD), so when they disagree the question is WHICH band is off. If every gear is
        # off by the SAME factor k, the shared divisor — the final drive — is the culprit (a per-gear problem would
        # scatter). fd_implied = fd * k is what the FD would have to be for the two sources to agree.
        if len(ratios) >= 3:
            mean_k = sum(ratios) / len(ratios)
            spread = max(ratios) - min(ratios)
            if abs(mean_k - 1.0) > 0.04 and spread / mean_k < 0.03:
                deliverable["gear_diag"] = {"kind": "fd", "factor": round(mean_k, 4), "fd_used": fd,
                                            "fd_implied": round(fd * mean_k, 3), "n": len(ratios)}
            elif abs(mean_k - 1.0) > 0.04 or spread / mean_k > 0.06:
                deliverable["gear_diag"] = {"kind": "scattered", "n": len(ratios), "spread": round(spread, 3)}
    except Exception:
        return


_ENG_CAT_LOCK = threading.Lock()
def _learn_engine_catalog(family, cyl=None, redline=None, peak_hp=None, drivetrain=None, pi=None, displacement_l=None):
    """Accrue a driven engine's MEASURED signature into data/engine-swaps.json, keyed by engine family — the
    per-part signature the decode then reuses to describe OTHER cars that share this engine but were never driven
    (cross-car transfer). This is the 'track the signature/PI per part' accrual. Only fills gaps / improves samples;
    never invents a family. Atomic write, lock-guarded."""
    if family is None:
        return
    try:
        path = os.path.join(ROOT, "data", "engine-swaps.json")
        with _ENG_CAT_LOCK:
            try:
                with open(path, encoding="utf-8") as fh:
                    doc = json.load(fh)
            except Exception:
                return
            rec = (doc.get("families") or {}).get(str(family))
            if rec is None:
                return
            changed = False
            for k, v in (("cyl", int(cyl) if cyl else None), ("redline", int(redline) if redline else None),
                         ("displacement_l", displacement_l), ("resulting_drivetrain", drivetrain)):
                if v is not None and rec.get(k) is None:
                    rec[k] = v; changed = True
            if peak_hp and peak_hp > (rec.get("sample_hp") or 0):
                rec["sample_hp"] = int(peak_hp); changed = True
            if pi and rec.get("sample_pi") is None:
                rec["sample_pi"] = int(pi); changed = True
            if changed:
                if rec.get("source") == "save-mined":
                    rec["source"] = "save-mined+telemetry"
                tmp = path + ".tmp"
                with open(tmp, "w", encoding="utf-8") as fh:
                    json.dump(doc, fh, indent=1, ensure_ascii=False)
                os.replace(tmp, path)
    except Exception:
        return


def _gear_log(ordn, ts):
    """Identity TIMELINE: intervals of which save was verified-equipped, so a livery can be attributed to the build
    equipped AT ITS SAVE MOMENT — a plain 'recent livery -> current build' rule mis-pins across a car swap."""
    if not hasattr(ST, "gear_id_log"):
        ST.gear_id_log = {}
    lg = ST.gear_id_log.setdefault(str(ordn), [])
    now = time.time()
    if lg and lg[-1]["ts"] == str(ts) and lg[-1]["t1"] is None:
        return
    if lg and lg[-1]["t1"] is None:
        lg[-1]["t1"] = now
    lg.append({"ts": str(ts), "t0": now, "t1": None})


def _auto_assoc_livery(ordn, window_s=14400):
    """TRUE AUTO-ASSOCIATION: a livery saved while build X was verified-equipped belongs to build X — you paint the
    car you're sitting in. Each unassociated recent livery is matched to the identity-timeline interval covering its
    save mtime (±2 min slack). A livery saved when NO identity was verified is left alone (manual pin / guess).
    Never overwrites an existing pin; never re-assigns an associated livery. Throttled; source='auto'."""
    try:
        if not hasattr(ST, "_aa_last"):
            ST._aa_last = {}
        if time.time() - ST._aa_last.get(str(ordn), 0) < 30:
            return
        ST._aa_last[str(ordn)] = time.time()
        log = getattr(ST, "gear_id_log", {}).get(str(ordn)) or []
        if not log:
            return
        root_lv = TUNE.find_containers_root(); tag_lv = f"{int(ordn):04d}"
        now = time.time()
        bp2 = os.path.join(ROOT, "data", "build-liveries.json")
        try:
            with open(bp2, encoding="utf-8") as f2:
                bobj2 = json.load(f2)
        except Exception:
            bobj2 = {"schema_version": "1.0.0", "assoc": {}}
        a2 = bobj2.setdefault("assoc", {}).setdefault(str(ordn), {})
        assigned = {(v.get("dir") if isinstance(v, dict) else v) for v in a2.values()}
        metas2, _ = TUNE.tunes_for_ordinal(int(ordn))
        import hashlib as _h2
        changed = False
        for d_ in os.listdir(root_lv):
            if not d_.startswith((f"Livery_{tag_lv}_", f"SoulBoundLivery_{tag_lv}_", f"BaseLivery_{tag_lv}_")) or d_ in assigned:
                continue
            try:
                mt = os.path.getmtime(os.path.join(root_lv, d_, "C_livery"))
            except Exception:
                continue
            if now - mt > window_s:
                continue
            iv = next((e for e in log if e["t0"] - 120 <= mt <= (e["t1"] or now) + 120), None)
            if iv is None:
                continue   # saved while no identity was verified — not ours to claim
            idm = next((mm2 for mm2 in metas2 if str(mm2["ts"]) == str(iv["ts"])), None)
            if idm is None:
                continue
            t_id = TUNE.parse_tune(idm["path"], ordinal_hint=int(ordn))
            items2 = tuple(sorted((k, v) for k, v in (t_id["parts"] or {}).items() if v is not None))
            sig2 = _h2.sha1(repr(items2).encode()).hexdigest()[:8]
            if sig2 in a2:
                continue   # that build already has a pin — keep it
            a2[sig2] = {"dir": d_, "source": "auto"}
            assigned.add(d_); changed = True
            print(f"auto-associated livery {d_} -> build {sig2} of {ordn} (saved while that build was verified equipped)", file=sys.stderr)
        if changed:
            tmpb = bp2 + ".tmp"
            with open(tmpb, "w", encoding="utf-8") as f2:
                json.dump(bobj2, f2, indent=1)
            os.replace(tmpb, bp2)
            ST._disk_dirty = True   # force the next disk emit so the dashboard shows it immediately
    except Exception:
        pass


def _pick_meta(metas, ordn, ts_want=None):
    """A car can have MANY saved tunes on disk (different engines / PIs). Picking the newest file shows the WRONG
    build when you switch around. Instead match each save's decoded signature (cylinders from the engine-family
    catalog, exact PI from recorded observations) to the LIVE car you're in. Returns (meta, match_info). ts_want
    forces a specific save (manual override). Also builds the roster of all saves so the dashboard can offer a picker."""
    if TUNE is None or not metas:
        return (metas[0] if metas else None), {"how": "newest", "live": False, "saves": []}
    cat = TUNE.load_engine_catalog()
    fr = ST.latest
    live = bool(fr and fr.get("on") and int(fr.get("car") or 0) == int(ordn))
    # J20: parking must not evaporate the laps just driven — remember the last live signature per ordinal and hold
    # it for 2h (same window + idiom as the sticky gear identity), so the confirm gate doesn't demand "drive once"
    # for a car verified minutes ago. A fresh live frame always overrides; reset_session clears the memory.
    if live:
        if not hasattr(ST, "live_seen"): ST.live_seen = {}
        ST.live_seen[str(ordn)] = {"t": time.time(), "cyl": fr.get("cyl"), "pi": fr.get("pi")}
    seen = getattr(ST, "live_seen", {}).get(str(ordn))
    live_recent = bool(not live and seen and time.time() - seen["t"] < 7200)
    live_cyl = fr.get("cyl") if live else (seen.get("cyl") if live_recent else None)
    live_pi = fr.get("pi") if live else (seen.get("pi") if live_recent else None)
    roster = []
    for m in metas:
        try:
            t = TUNE.parse_tune(m["path"], ordinal_hint=ordn)
        except Exception:
            continue
        efam = TUNE.engine_family_of(t["parts"])
        cyl = (cat.get(str(efam)) or {}).get("cyl")
        pi = TUNE.observed_car_pi(ordn, t["parts"])   # exact PI if this exact config was ever driven & recorded
        red = (cat.get(str(efam)) or {}).get("redline")   # the family's MEASURED redline — the engine's live fingerprint
        score = m["mtime"] * 1e-13                     # newest as a faint tiebreak
        if ts_want and str(m["ts"]) == str(ts_want):
            score += 1e6                               # explicit user pick wins outright
        if live and live_cyl and cyl:
            score += 100 if int(cyl) == int(live_cyl) else -100   # cyl (4 vs 8 vs 3) is the strong signal
        if live and live_pi and pi:
            score += 60 if int(pi) == int(live_pi) else -min(60, abs(int(pi) - int(live_pi)) * 0.6)
        live_red = (fr.get("maxrpm") if live and fr else None)
        if live_red and red:                           # two same-cyl same-PI builds with DIFFERENT ENGINES separate here: redline is telemetry-exact
            score += 50 if abs(int(red) - int(live_red)) <= 400 else -min(50, abs(int(red) - int(live_red)) * 0.02)
        gseen = getattr(ST, "gears_seen", {}).get(str(ordn)) or set()
        mxg = max(gseen) if gseen else 0
        gc0 = t.get("gear_count")
        if live and mxg and gc0:                       # gears USED are hard evidence: gear 8 in a 6-speed box is impossible; reaching the box's exact top is strong
            if int(gc0) < mxg: score -= 500
            elif int(gc0) == mxg and mxg >= 5: score += 45
        roster.append({"ts": m["ts"], "cyl": cyl, "pi": pi, "red": red, "locked": t["locked"], "_score": score, "_meta": m, "_tune": t})
    if not roster:
        return metas[0], {"how": "newest", "live": live, "saves": []}
    roster.sort(key=lambda r: -r["_score"])
    # DISAMBIGUATE same-signature saves. A clone makes several builds share cyl + PI (sliders don't move PI), so the
    # cyl/PI score alone ties them and we'd fall back to 'newest'. When the leaders tie, use the LIVE-measured gear
    # ladder (telemetry-exact, wheelspin-immune) to pick the build actually EQUIPPED: gearing is part of the tune, so
    # two builds that differ in gears/final-drive separate cleanly here, while genuinely identical builds stay tied.
    # J2: fingerprint the PARTS of every save FIRST — identity ambiguity exists between distinct BUILDS, not between
    # slider iterations of one build. Two same-fingerprint saves (save → tweak sliders → save again, the natural first
    # hour with a car) are ONE build: no gear-ladder separation is possible or needed, newest wins, and treating them
    # as 'ties' hard-blocked the gate with a physically unsatisfiable 'drive the gears' instruction.
    try:
        import hashlib as _hl0
        for r in roster:
            items0 = tuple(sorted((k, v) for k, v in ((r["_tune"] or {}).get("parts") or {}).items() if v is not None))
            r["_bsig"] = _hl0.sha1(repr(items0).encode()).hexdigest()[:8]
    except Exception:
        pass
    n_ties = 1; gear_used = False
    if live and len(roster) >= 2:
        # candidates = every same-cylinder save. NOT the score-tie window: the PI-observation bonus is self-
        # reinforcing (stamped builds outscore unstamped ones, so unstamped builds never got their ladder compared and
        # never got stamped). An unstamped PI is UNKNOWN — it may equally sit at the class cap — so PI cannot rule a
        # same-cyl save out. The measured gear ladder OUTRANKS the PI bonus whenever it's available.
        ties = [r for r in roster if not live_cyl or not r.get("cyl") or int(r["cyl"]) == int(live_cyl)]
        n_ties = len({r.get("_bsig") for r in ties}) if all(r.get("_bsig") for r in ties) else len(ties)   # distinct BUILDS, not saves
        if n_ties >= 2:
            live_gl = None
            with ST.lock: sj = ST.session_json
            for c in (sj.get("cars", []) if sj else []):
                if str(c.get("ordinal")) == str(ordn):
                    gl = {int(g["gear"]): g["fd_gear"] for g in (c.get("gears") or []) if g.get("fd_gear")}
                    if len(gl) >= 3: live_gl = gl   # need a gear-ladder pass (several gears measured) to fingerprint
                    break
            if live_gl:
                import re as _re
                def _gear_err(r):
                    dl = TUNE.tune_to_deliverable(r["_tune"], "")
                    fd = None; ratios = {}
                    for tab in dl.get("tabs", []):
                        for row in tab.get("rows", []):
                            if row.get("field") == "final_drive" and row.get("value"): fd = row["value"]
                            mm = _re.match(r"gear_(\d+)$", str(row.get("field", "")))
                            if mm and row.get("value"): ratios[int(mm.group(1))] = row["value"]
                    common = [g for g in ratios if g in live_gl] if fd else []
                    if not common: return 9.9
                    return sum(abs(fd * ratios[g] - live_gl[g]) / live_gl[g] for g in common) / len(common)
                errs = sorted(((_gear_err(r), i, r) for i, r in enumerate(ties)), key=lambda x: (x[0], x[1]))
                # accept only a CLEAR winner: good absolute match AND clearly ahead of the runner-up (else stay ambiguous)
                if errs[0][0] < 0.06 and (len(errs) < 2 or errs[1][0] - errs[0][0] > 0.02):
                    winner = errs[0][2]; roster = [winner] + [r for r in roster if r is not winner]; gear_used = True
                    if not hasattr(ST, "gear_id"):
                        ST.gear_id = {}
                    ST.gear_id[str(ordn)] = {"ts": str(winner["ts"]), "t": time.time()}   # PERSIST the verified identity — it must survive a pause
                    _gear_log(ordn, winner["ts"]); _auto_assoc_livery(ordn)   # timeline entry + attribute any livery saved during a verified interval
    # STICKY IDENTITY: when the ladder can't run RIGHT NOW (menus drop the live frame; a short window lacks gears),
    # reuse the last gear-VERIFIED identity instead of reverting to 'newest' — the user's WOT run must not evaporate
    # the moment they pause to read the dashboard. Held for 2h; a new in-game save re-anchors it (below); an explicit
    # pick still overrides.
    held_id = False
    if not gear_used and not ts_want:
        gid = getattr(ST, "gear_id", {}).get(str(ordn))
        if gid and time.time() - gid["t"] < 7200:
            held = next((r for r in roster if str(r["ts"]) == str(gid["ts"])), None)
            # the hold must YIELD to contradicting live evidence: switching garage instances writes NO save file,
            # so a stale hold was the only voice — but the live engine (cyl, redline) is telemetry-exact. When it
            # contradicts the held build, drop the hold and let the scoring/ladder re-disambiguate NOW.
            if held is not None and live:
                _lr = fr.get("maxrpm") if fr else None
                if (held.get("cyl") and live_cyl and int(held["cyl"]) != int(live_cyl)) or (held.get("red") and _lr and abs(int(held["red"]) - int(_lr)) > 700):
                    held = None
                    try: del ST.gear_id[str(ordn)]   # the verified identity belonged to the OTHER build — it no longer describes what's equipped
                    except Exception: pass
            if held is not None:
                roster = [held] + [r for r in roster if r is not held]
                gear_used = True; held_id = True
    best = roster[0]
    # BUILD CATEGORIZATION: group saves by their exact PARTS fingerprint (byte-exact in every save file). Saves
    # sharing a fingerprint are slider iterations of ONE build; different fingerprints are DIFFERENT builds — and at a
    # class cap several builds share cyl+PI, so PARTS (not PI) are the true category. Each non-base build carries the
    # exact part diffs vs Build A (the newest), so the dashboard can say WHAT differs, not just that something does.
    builds = []
    try:
        import hashlib as _hl
        def _build_letters(ordn2, sigs_in_order):
            """Permanent per-ordinal build letters (data/build-letters.json): first sight of a fingerprint assigns
            the next free letter, FOREVER. Newest-first re-lettering renamed every build whenever a save landed —
            an identity must not drift. First migration freezes the letters currently on screen."""
            path2 = os.path.join(ROOT, "data", "build-letters.json")
            with _BL_LOCK:
                try:
                    with open(path2, encoding="utf-8") as f2: doc2 = json.load(f2)
                except Exception:
                    doc2 = {"schema_version": "1.0.0", "letters": {}}
                mm = doc2.setdefault("letters", {}).setdefault(str(ordn2), {})
                changed2 = False
                for h2 in sigs_in_order:
                    if h2 not in mm:
                        used2 = set(mm.values())
                        mm[h2] = next((chr(65 + i2) for i2 in range(26) if chr(65 + i2) not in used2), "Z" + str(len(mm)))
                        changed2 = True
                if changed2:
                    tmp2 = path2 + ".tmp"
                    with open(tmp2, "w", encoding="utf-8") as f2: json.dump(doc2, f2, indent=1)
                    os.replace(tmp2, path2)
                return {h2: mm[h2] for h2 in sigs_in_order}
        sig_groups = {}
        for r in roster:
            items = tuple(sorted((k, v) for k, v in ((r["_tune"] or {}).get("parts") or {}).items() if v is not None))
            h = _hl.sha1(repr(items).encode()).hexdigest()[:8]
            r["_bsig"] = h; sig_groups.setdefault(h, []).append(r)
        order = sorted(sig_groups, key=lambda h: -max(float(x["_meta"]["mtime"]) for x in sig_groups[h]))
        labels = _build_letters(ordn, order)   # PERMANENT letters: a build keeps its letter for life — a new save must never re-letter the garage (identity volatility)
        def _tw(v):
            if v is None: return "—"
            ix = v % 1000
            return "Stock" if ix == 0 else (TUNE._tier_word(ix) if ix <= 3 else f"t{ix}")
        base = order[0] if order else None
        for h in order:
            mem = sig_groups[h]
            diffs = []
            if base and h != base:
                pa = (sig_groups[base][0]["_tune"] or {}).get("parts") or {}
                pb = (mem[0]["_tune"] or {}).get("parts") or {}
                for slot in sorted(set(pa) | set(pb)):
                    va, vb = pa.get(slot), pb.get(slot)
                    if va != vb:
                        disp = TUNE.CATEGORY_DISPLAY.get(slot, slot.replace("_", " ").title())
                        diffs.append(f"{disp}: {_tw(va)} → {_tw(vb)}")
            builds.append({"build": h, "label": labels.get(h, "?"), "saves": [x["ts"] for x in mem], "n": len(mem),
                           "cyl": mem[0].get("cyl"), "pi": next((x["pi"] for x in mem if x.get("pi")), None),
                           "gears": (mem[0]["_tune"] or {}).get("gear_count"),
                           "diff_base": labels.get(base, "?"),   # letters are permanent, so the diff base is NOT always 'A' — name it
                           "diff_vs_A": diffs[:12], "n_diffs": len(diffs)})
        # LIVERY ASSOCIATION per build: no tune↔livery link exists on disk, so a manual PIN
        # (data/build-liveries.json) wins; otherwise GUESS by save-time proximity — a build's tune save and its
        # livery save usually come from the same garage session. Guesses are labelled as guesses.
        try:
            root_ = TUNE.find_containers_root(); tag_ = f"{int(ordn):04d}"
            livs = []
            for d_ in os.listdir(root_):
                if d_.startswith((f"Livery_{tag_}_", f"SoulBoundLivery_{tag_}_", f"BaseLivery_{tag_}_")):
                    nm_ = _livery_strings(os.path.join(root_, d_, "header"))
                    livs.append({"dir": d_, "name": (nm_[0] if nm_ else None),
                                 "thumb": os.path.exists(os.path.join(root_, d_, "bigThumb.webp")),
                                 "ts": d_.split("_")[-1]})
            pins = {}
            try:
                with open(os.path.join(ROOT, "data", "build-liveries.json"), encoding="utf-8") as f_:
                    pins = (json.load(f_).get("assoc") or {}).get(str(ordn), {})
            except Exception:
                pins = {}
            def _ep(ts):
                try: return time.mktime(time.strptime(str(ts)[:14], "%Y%m%d%H%M%S"))
                except Exception: return None
            for b in builds:
                pv_ = pins.get(b["build"])
                pin_dir = (pv_.get("dir") if isinstance(pv_, dict) else pv_)
                pin_src = (pv_.get("source") if isinstance(pv_, dict) else None) or "pinned"   # str = user pin; dict may be an auto-association
                pl = next((l for l in livs if l["dir"] == pin_dir), None) if pin_dir else None
                if pl is not None:
                    b["livery"] = {"dir": pl["dir"], "name": pl["name"], "thumb": pl["thumb"], "source": pin_src}
                    continue
                best_l = None; best_dt = None
                for l in livs:
                    le = _ep(l["ts"])
                    if le is None: continue
                    for ts_ in b["saves"]:
                        te = _ep(ts_)
                        if te is None: continue
                        dt_ = abs(le - te)
                        if best_dt is None or dt_ < best_dt: best_dt, best_l = dt_, l
                if best_l is not None and best_dt is not None and best_dt <= 6 * 3600:
                    b["livery"] = {"dir": best_l["dir"], "name": best_l["name"], "thumb": best_l["thumb"],
                                   "source": "guess", "dt_h": round(best_dt / 3600, 1)}
        except Exception:
            pass
    except Exception:
        builds = []
    saves = [dict({k: r[k] for k in ("ts", "cyl", "pi", "locked")}, gears=(r["_tune"] or {}).get("gear_count"),
                  build=next((b["label"] for b in builds if r.get("_bsig") == b["build"]), None)) for r in roster]
    how = "picked" if ts_want else ("signature" if (live or live_recent) and (live_cyl or live_pi) else "newest")   # J20: a 2h-recent signature still identifies
    mism = bool((live or live_recent) and live_cyl and best["cyl"] and int(best["cyl"]) != int(live_cyl))
    final_how = how if ts_want else ("no-match" if mism else ("gear-matched" if gear_used else how))
    # LIVE TRUTH OVERRIDE: while the equipped build is strongly identified and on track, the frame's CarPI IS this
    # build's PI — a stored stamp that disagrees is stale or misattributed and must never outrank the live read
    # (the "identifies as A700 while driving it at S1 800" bug).
    if live_pi and (live or live_recent) and final_how in ("gear-matched", "picked"):
        try:
            eq = next((b for b in builds if any(str(t2) == str(best["ts"]) for t2 in (b.get("saves") or []))), None)
            if eq is not None and eq.get("pi") != int(live_pi):
                eq["pi"] = int(live_pi); eq["pi_src"] = "live"
            for s2 in saves:
                if str(s2.get("ts")) == str(best["ts"]) and s2.get("pi") != int(live_pi): s2["pi"] = int(live_pi)
        except Exception:
            pass
    return best["_meta"], {"how": final_how, "live": live, "live_recent": live_recent, "live_cyl": live_cyl,
                           "live_pi": live_pi, "chosen_cyl": best["cyl"], "chosen_pi": best["pi"],
                           "n_saves": len(roster), "n_signature_ties": n_ties, "gear_disambig": gear_used,
                           "held": held_id, "builds": builds, "saves": saves}


def _deliverable_cyl(deliverable):
    """The decoded tune's cylinder count (from the engine-family catalog) — used to pick the RIGHT build of a
    multi-build car when enriching from telemetry."""
    for m in (deliverable or {}).get("menus", []):
        if m.get("menu") == "Conversions":
            for r in m["rows"]:
                if r.get("item") == "powertrain":
                    return ((r.get("engine_catalog") or {}).get("cyl")) or ((r.get("engine_bits") or {}).get("cat_cyl"))
    return None


def _match_car(ordn, want_cyl=None):
    """Pick the ST.cars entry for this ordinal that matches the build we mean: the exact car you're driving now, else
    the one whose cylinders match the decoded tune, else the first seen. ST.cars holds EVERY build of an ordinal
    (a 4-cyl AWD tune and an 8-cyl RWD tune share the ordinal), so 'first match' showed the wrong drivetrain/engine."""
    with ST.lock:
        fr = ST.latest
        live_cid = fr.get("cid") if (fr and fr.get("on") and int(fr.get("car") or 0) == int(ordn)) else None
        cand = [(str(cid), dict(c)) for cid, c in ST.cars.items() if str(cid).split("|")[0] == str(ordn)]
    if not cand:
        return None
    if live_cid:                                                   # 1. the exact car you're in
        for cid, c in cand:
            if cid == str(live_cid):
                return c
    if want_cyl:                                                   # 2. the build whose cylinders match the decoded tune
        for cid, c in cand:
            if c.get("cyl") and int(c["cyl"]) == int(want_cyl):
                return c
    return cand[0][1]                                              # 3. fallback


def _enrich_engine_desc(deliverable, ordn):
    """Feature A: turn the Conversions 'Engine' row into a specific engine TYPE using live telemetry. The save
    holds no engine specs; this joins the active car's cylinders / redline (ST.cars, keyed by cid whose prefix is
    the ordinal) and peak dyno hp (ST.session_json, the analyzer's measured curve — ST.cars.dyno stays empty).
    Sets an authoritative `engine_type` string + `engine_type_conf`='measured', and also folds a short form into
    value/upgrade so it shows without the dashboard change. Best-effort: a non-driven car keeps its save-only
    descriptor. Never invents a swap donor name."""
    try:
        car = _match_car(ordn, _deliverable_cyl(deliverable))   # the build that matches THIS tune / the car you're in
        with ST.lock:
            sj = ST.session_json
        # peak hp: prefer the analyzer's dyno (session_json); fall back to any ST.cars dyno
        peak_hp = None
        if sj:
            for c in sj.get("cars", []):
                if str(c.get("ordinal")) == str(ordn):
                    dl = [d["hp"] for d in (c.get("dyno") or []) if d.get("hp")]
                    if dl:
                        peak_hp = max(dl)
                    break
        if peak_hp is None and car:
            dl = [d["hp"] for d in (car.get("dyno") or []) if d.get("hp")]
            if dl:
                peak_hp = max(dl)
        for m in deliverable.get("menus", []):
            if m.get("menu") != "Conversions":
                continue
            for r in m["rows"]:
                if r.get("item") != "powertrain":
                    continue
                bits = r.get("engine_bits") or {}
                electric = bool(r.get("electric") or bits.get("electric"))
                if not car and peak_hp is None:
                    if not electric:      # no telemetry at all: keep the save-only engine_type, hint to drive
                        r["value"] = r["upgrade"] = r["value"] + " — drive it to read cylinders, redline & power"
                        r["needs_drive"] = True
                    return
                cyl = car.get("cyl") if car else None
                redline = car.get("max_rpm") if car else None
                if TUNE is not None:
                    r["engine_type"] = TUNE.compose_engine_type(
                        asp_short=bits.get("asp"), displacement_l=bits.get("displacement_l"),
                        cyl=cyl, peak_hp=peak_hp, redline=redline,
                        swapped=bool(bits.get("swapped")), electric=electric,
                        build_level=bits.get("build_level") or 0,
                        disp_from_build=bool(bits.get("disp_from_build")))
                    r["engine_type_conf"] = "measured"
                fold = []
                if not electric:
                    if cyl:
                        fold.append(f"{int(cyl)}-cyl")
                    if redline:
                        fold.append(f"{int(redline)} rpm redline")
                if peak_hp:
                    fold.append(f"~{int(peak_hp)} hp")
                if fold:
                    r["value"] = r["upgrade"] = r["value"] + " · " + " · ".join(fold)
                r["telemetry"] = True
                if not electric and ST.clone_lock != ordn:   # accrue this engine's signature into the family catalog — but not while cloning this car (WIP telemetry could write a wrong signature)
                    _learn_engine_catalog(bits.get("engine_family"), cyl=cyl, redline=redline, peak_hp=peak_hp,
                                          drivetrain=(car.get("drivetrain") if car else None),
                                          pi=(car.get("pi") if car else None), displacement_l=bits.get("displacement_l"))
                return
    except Exception:
        return


def _enrich_drivetrain(deliverable, ordn):
    """Fill the Conversions 'drivetrain' row's RESULTING layout from live telemetry. The save records only
    stock-vs-swapped (the slot has no FWD/RWD/AWD value); DrivetrainType — read every frame and stored on
    ST.cars[cid]['drivetrain'] — is the actual resulting layout. Sets `resulting_drivetrain` ('FWD'/'RWD'/'AWD')
    and folds it into value/upgrade ('Converted / swapped → AWD', or 'Stock layout (RWD)') so it shows without a
    dashboard change. Best-effort: a non-driven car keeps resulting_drivetrain=null (no fabrication)."""
    try:
        car = _match_car(ordn, _deliverable_cyl(deliverable))   # match the build we're decoding, not just any 2866 seen
        drv = car.get("drivetrain") if car else None
        if not drv or drv == "?":
            return
        for m in deliverable.get("menus", []):
            if m.get("menu") != "Conversions":
                continue
            for r in m["rows"]:
                if r.get("item") != "drivetrain":
                    continue
                r["resulting_drivetrain"] = drv
                r["value"] = r["upgrade"] = (f"{r['value']} ({drv})" if r.get("stock")
                                             else f"{r['value']} → {drv}")
                r["telemetry"] = True
                return
    except Exception:
        return


def _build_union(deliverable, ordn, match=None):
    """THE UNION: reconcile the save decode against every telemetry measurement available for this build, so the two
    sources BOLSTER each other instead of living as separate deliverables. Emits deliverable['union']:
      fields[] — each reconcilable field with save+telemetry values and a status:
                 agree (both sources, corroborated) · conflict (competing expected values -> low confidence)
                 tele-fill (telemetry filled a save blind spot) · await (telemetry WOULD raise confidence; not captured)
      asks[]   — the ranked, deduplicated 'drive X to raise confidence' prompts the dashboard shows prominently.
    Best-effort: never raises; an undriven car simply yields awaits."""
    try:
        u = {"fields": [], "asks": []}
        def fld(name, save_v, tele_v, status, note=None):
            # INVARIANT: a conflict needs TWO actual values. When one source has no data, the other is simply the
            # only source of that field — never a conflict. (Measured absence WITH evidence, e.g. 0 psi during a
            # redline pull, is data and must be passed as an explicit value string, not None.)
            if status == "conflict" and (save_v is None or tele_v is None):
                status = "tele-fill" if save_v is None else "await"
                note = None
            u["fields"].append({"name": name, "save": save_v, "telemetry": tele_v, "status": status, "note": note or ""})
        def ask(key, text, gain, rank):
            if not any(a["key"] == key for a in u["asks"]):
                u["asks"].append({"key": key, "text": text, "gain": gain, "rank": rank})
        car = _match_car(ordn, _deliverable_cyl(deliverable))
        # sig (boost_max / hp_peak / rpm_at_peak) lives on the ANALYZER's session cars — NOT on ST.cars (the live
        # config registry _match_car returns). Reading it off the wrong record left aspiration stuck on 'await'
        # forever, even after a full pull to redline.
        sig = {}; sj_car = None
        with ST.lock:
            sj = ST.session_json
        if sj:
            want = _deliverable_cyl(deliverable)
            cands = [c for c in sj.get("cars", []) if str(c.get("ordinal")) == str(ordn)]
            # STRICT build match — never fall back to "any car with this ordinal": another build's boost/hp signature
            # would manufacture aspiration/power conflicts for a perfectly consistent save (multi-build ordinals are
            # exactly the case this machinery exists for). Only take cands[0] when cyl is underivable AND unambiguous.
            sj_car = next((c for c in cands if want and c.get("cyl") == want), None)
            if sj_car is None and not want and len(cands) == 1:
                sj_car = cands[0]
            sig = (sj_car or {}).get("sig") or {}
        conv = next((m for m in deliverable.get("menus", []) if m.get("menu") == "Conversions"), {"rows": []})
        rows = {r.get("item"): r for r in conv.get("rows", [])}
        # -- build identity (from the matcher) is the foundation every other confidence stands on
        if match and match.get("how") == "no-match":
            ask("identity", "capture this build's file — re-apply its tune from Find Tunes (downloaded tunes write their save when applied) or save it if your own; no save matches your live engine, so every decoded value may be another build's", "unblocks everything", 0)
        elif match and (match.get("n_signature_ties") or 1) >= 2 and not match.get("gear_disambig"):
            ask("identity", f"drive up through the gears — {match['n_signature_ties']} builds share this engine + PI; the gear ladder identifies the equipped one", "build identity", 0)
        # -- engine cylinders: save-side catalog vs live NumCylinders
        cat_cyl = _deliverable_cyl(deliverable); live_cyl = (car or {}).get("cyl")
        if cat_cyl and live_cyl:
            fld("Engine cylinders", f"{cat_cyl}-cyl", f"{live_cyl}-cyl", "agree" if int(cat_cyl) == int(live_cyl) else "conflict",
                None if int(cat_cyl) == int(live_cyl) else "the save's engine family disagrees with the engine you're driving — likely decoding the wrong build")
        elif cat_cyl:
            fld("Engine cylinders", f"{cat_cyl}-cyl", None, "await", "one on-track frame confirms it")
            ask("drive-once", "drive this car once — one frame confirms cylinders, redline & drivetrain layout", "engine + drivetrain", 3)
        # -- drivetrain layout: save literally can't know FWD/RWD/AWD
        drv = (car or {}).get("drivetrain")
        dr_row = rows.get("drivetrain") or {}
        if drv and drv != "?":
            fld("Drivetrain layout", "stock/swapped only (save can't know layout)", drv, "tele-fill")
        else:
            fld("Drivetrain layout", "stock/swapped only", None, "await", "the save never records FWD/RWD/AWD")
            ask("drive-once", "drive this car once — one frame confirms cylinders, redline & drivetrain layout", "engine + drivetrain", 3)
        # -- aspiration vs measured boost
        asp_row = rows.get("aspiration") or {}
        asp_lbl = str(asp_row.get("value") or "")
        boost = sig.get("boost_max")
        if asp_lbl:
            na = "Naturally Aspirated" in asp_lbl or "no aspiration" in asp_lbl
            if boost is None:   # no analyzer sig yet for this build — nothing measured to check against
                fld("Aspiration", asp_lbl, None, "await", "a full-throttle pull reads boost and verifies it")
                ask("wot-pull", "one full-throttle pull to redline — measures peak hp, boost & verifies aspiration", "hp + aspiration", 2)
            elif na and boost > 0.5:
                fld("Aspiration", asp_lbl, f"{boost} psi boost seen", "conflict", "the save says NA but the stream shows boost — wrong build or wrong slot read")
            elif (not na) and boost <= 0.5 and sig.get("hp_peak"):
                fld("Aspiration", asp_lbl, "no boost in the stream", "conflict", "the save says forced induction but WOT pulls show no boost")
            elif (not na) and boost <= 0.5:
                # forced induction on the save but no boost seen AND no pull evidence — that's absent data, not agreement
                fld("Aspiration", asp_lbl, None, "await", "no boosted pull measured yet — a full-throttle pull to redline verifies the charger")
                ask("wot-pull", "one full-throttle pull to redline — measures peak hp, boost & verifies aspiration", "hp + aspiration", 2)
            else:
                fld("Aspiration", asp_lbl, (f"{boost} psi" if boost and boost > 0.5 else "NA confirmed"), "agree")
        # -- transmission: the measured gear COUNT is a PART-level cross-check. At a class cap (e.g. S1 800) different
        # part combos converge to the SAME PI, so cyl×PI can't separate them — but driving gear 8 at WOT while the
        # save holds a 6-speed box is definitive: a DIFFERENT build is equipped.
        meas_gears = [g.get("gear") for g in ((sj_car or {}).get("gears") or []) if g.get("gear")]
        gc_save = deliverable.get("gear_count")
        if meas_gears and gc_save:
            mx = max(meas_gears)
            if mx > gc_save:
                fld("Transmission", f"{gc_save}-speed (saved tune)", f"gear {mx} measured at WOT", "conflict",
                    "the live gearbox has MORE gears than the saved tune's transmission — a different build is equipped")
            elif mx == gc_save and len(set(meas_gears)) >= gc_save:
                fld("Transmission", f"{gc_save}-speed", f"all {gc_save} gears seen at WOT", "agree")
        # -- gears: aggregate the per-row reconciliation _enrich_gears recorded
        g_meas = g_agree = g_conf = g_tot = 0
        for t in deliverable.get("tabs", []):
            if t.get("tab") != "Gearing":
                continue
            for r in t["rows"]:
                if str(r.get("field", "")).startswith("gear_"):
                    g_tot += 1
                    if r.get("telemetry"):
                        g_meas += 1
                        if r.get("conflict"): g_conf += 1
                        elif r.get("agree"): g_agree += 1
        if g_tot:
            if g_conf:
                gd = deliverable.get("gear_diag") or {}
                if gd.get("kind") == "fd":
                    note = (f"all {gd['n']} gears disagree by the SAME ×{gd['factor']} factor — the shared divisor is the culprit: "
                            f"the band-derived FINAL DRIVE ({gd['fd_used']}), not the gears. If the sources agreed, FD would be ~{gd['fd_implied']}. "
                            f"Type your exact in-game final drive in the 🎯 calibration card — that arbitrates & fixes every gear at once")
                elif gd.get("kind") == "scattered":
                    note = (f"gear disagreements are SCATTERED (not one factor) — likely decoding a different save than the build you drove, "
                            f"or the drive predates your last gearing change. Re-save the tune, drive the gears again, or check the build picker")
                else:
                    note = f"{g_conf} gear{'s' if g_conf > 1 else ''} disagree with the save — competing values shown on the rows"
                fld("Gear ratios", f"{g_tot} gears (band-derived)", f"{g_meas} measured", "conflict", note)
            elif g_meas:
                fld("Gear ratios", f"{g_tot} gears (band-derived)", f"{g_meas} measured", "agree" if g_meas >= g_tot else "tele-fill",
                    None if g_meas >= g_tot else f"{g_tot - g_meas} gear{'s' if g_tot - g_meas > 1 else ''} not yet driven at full throttle")
            else:
                fld("Gear ratios", f"{g_tot} gears (band-derived ~85%)", None, "await", "a WOT run up through the gears measures every ratio exactly")
            if g_meas < g_tot:
                ask("gear-ladder", "full-throttle up through every gear — measures exact ratios (and identifies the build among same-PI clones)", "gearing exact", 1)
        # -- peak hp (feeds the engine descriptor)
        if not sig.get("hp_peak"):
            ask("wot-pull", "one full-throttle pull to redline — measures peak hp, boost & verifies aspiration", "hp + aspiration", 2)
        else:
            fld("Peak power", "save holds no hp", f"~{int(sig['hp_peak'])} hp @ {sig.get('rpm_at_peak') or '?'} rpm", "tele-fill")
        # -- PI: exact observed CarPI for THIS config vs live
        sm = deliverable.get("summary", {}) or {}
        live_pi = (car or {}).get("pi")
        if sm.get("pi_total") is not None and live_pi:
            same = abs(int(sm["pi_total"]) - int(live_pi)) <= 1
            fld("PI", f"{sm['pi_total']} (observed for this config)", str(live_pi), "agree" if same else "conflict",
                None if same else "live PI differs from the recorded observation — the config on disk may not be what you're driving")
        elif sm.get("pi_total") is None:
            fld("PI", None, (str(live_pi) if live_pi else None), "await", "PI is telemetry-exact but only recorded once THIS exact config is driven")
            ask("drive-build", "drive this exact build once — records its exact PI against the config", "PI exact", 4)
        # -- per-car sliders still relative -> calibration ask (the guided card does the capture)
        rel = sm.get("sliders_relative") or 0
        if rel:
            ask("calibrate", f"{rel} slider{'s' if rel > 1 else ''} still read as % — use the 🎯 calibration card (two saved positions each locks them exact)", "sliders exact", 5)
        u["asks"].sort(key=lambda a: a["rank"])
        u["n_agree"] = sum(1 for f in u["fields"] if f["status"] == "agree")
        u["n_conflict"] = sum(1 for f in u["fields"] if f["status"] == "conflict")
        u["n_fill"] = sum(1 for f in u["fields"] if f["status"] == "tele-fill")
        u["n_await"] = sum(1 for f in u["fields"] if f["status"] == "await")
        deliverable["union"] = u
        # AUTO-IDENTIFY A DISTINCT UNSAVED BUILD: aspiration and transmission are PART-level measurements — they can
        # only disagree with the save if different PARTS are equipped (sliders can't change them). When the matcher
        # said "matched by cyl+PI" but a part-level measurement contradicts the save, the truth is: you're driving a
        # build that exists in the garage but NOT on disk (same cyl, same capped PI, different upgrades). Flip the
        # match to 'unsaved-build' so the client warns, blocks auto-fill, and offers the save-in-game path.
        if match and match.get("how") in ("signature", "gear-matched", "newest"):
            ev = [f["name"] for f in u["fields"] if f["status"] == "conflict" and f["name"] in ("Aspiration", "Transmission")]
            if ev:
                # "contradicts every save" must actually mean EVERY save — a Transmission conflict against the
                # CHOSEN save while ANOTHER roster save matches the gears being used means the tie-pick was wrong,
                # not that the build is unsaved. (Re-applying an already-applied tune writes NO file, so the old
                # advice could never resolve this state — the loop the user reported.)
                _alt = None
                try:
                    _ordk = str(int((deliverable or {}).get("ordinal") or 0))
                    _gs = getattr(ST, "gears_seen", {}).get(_ordk) or set()
                    _mx = max(_gs) if _gs else 0
                    if "Transmission" in ev and _mx:
                        _alt = next((s for s in (match.get("saves") or []) if s.get("gears") and int(s["gears"]) >= _mx and str(s.get("ts")) != str((match.get("saves") or [{}])[0].get("ts"))), None)
                except Exception:
                    _alt = None
                if _alt is not None and ev == ["Transmission"]:
                    ask("identity", f"{match.get('n_signature_ties') or 'several'} saved builds tie on signature and the measured gearbox contradicts the current pick — keep driving up through the gears (Build {_alt.get('build') or '?'} matches the {_alt.get('gears')}-speed box you're using; the ladder confirms it, no re-apply needed)", "auto-resolves", 0)
                    u["asks"].sort(key=lambda a: a["rank"])
                else:
                    match["prev_how"] = match.get("how"); match["how"] = "unsaved-build"; match["evidence"] = ev
                    ask("identity", "capture this build's file — measured " + " + ".join(e.lower() for e in ev)
                        + " contradicts every save on disk: you're driving a distinct build that isn't captured. Change any part (or slider) and SAVE if it's yours, or apply a different tune then re-apply this one — re-applying an already-active tune writes nothing", "unblocks everything", 0)
                    u["asks"].sort(key=lambda a: a["rank"])
    except Exception:
        pass


def _livery_strings(path, max_strings=3):
    """Tolerant scan of a Livery container's `header` for its length-prefixed UTF-16LE strings — observed layout:
    [u32 ver][u32 n]["name" n chars][u32 n]["description"]...["creator"]. Scans forward so unknown binary between
    strings is skipped. READ-ONLY; returns up to max_strings printable strings (name, description, creator)."""
    try:
        b = open(path, "rb").read()
    except Exception:
        return []
    out = []; i = 0
    while i + 4 <= len(b) and len(out) < max_strings:
        n = int.from_bytes(b[i:i + 4], "little")
        # accept 1-char strings too (a 1-2 char name is legal; rejecting it shifted creator into the desc slot);
        # guard against binary noise by requiring at least one alphanumeric character
        if 0 < n <= 96 and i + 4 + 2 * n <= len(b):
            try:
                s = b[i + 4:i + 4 + 2 * n].decode("utf-16-le")
                if s and s.strip() and any(c.isalnum() for c in s) and all(c.isprintable() for c in s):
                    out.append(s); i += 4 + 2 * n; continue
            except Exception:
                pass
        i += 1
    return out


class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Cache-Control", "no-cache")
    def do_GET(self):
        if self.path.startswith("/events"):
            self.send_response(200); self._cors(); self.send_header("Content-Type", "text/event-stream"); self.end_headers()
            last_seq = ST.seq; last_frame_t = 0.0; last_status = 0.0
            try:
                # initial snapshot: strip + corners + cars
                with ST.lock: snap = {"strip": ST.strip[-1800:], "corners": ST.corners[-60:], "cars": list(ST.cars.values()), "analysis": ST.analysis, "stint": ST.stint, "tags": ST.stint_tags, "loop": ST.loop and {"name": ST.loop["name"], "start": ST.loop["start"], "lap": ST.loop_lap, "last_s": ST.loop_last_s}, "game": ST.game, "mode": {"suggest": ST.mode_suggest, "reason": ST.mode_reason, "kind": ST.game_kind, "game": ST.game}, "session": ST.session_json and {"id": ST.session_json["id"], "summary": ST.session_json["summary"]}}
                self.wfile.write(f"event: snapshot\ndata: {json.dumps(snap)}\n\n".encode()); self.wfile.flush()
                while True:
                    now = time.monotonic()
                    with ST.lock:
                        ev = [e for e in ST.events if e[0] > last_seq]; fr = ST.latest; pps = len(ST.pps_win) / 2.0; frames = ST.frames; lp = ST.last_pkt
                    for seq, name, payload in ev:
                        self.wfile.write(f"event: {name}\ndata: {json.dumps(payload)}\n\n".encode()); last_seq = seq
                    if fr and now - last_frame_t >= 0.05 and now - lp < 1.0:
                        self.wfile.write(f"event: frame\ndata: {json.dumps(fr)}\n\n".encode()); last_frame_t = now
                    if now - last_status >= 1.0:
                        self.wfile.write(f"event: status\ndata: {json.dumps({'pps': round(pps, 1), 'frames': frames, 'receiving': now - lp < 1.0, 'cars': list(ST.cars.values()), 'stint': ST.stint, 'loop': ST.loop and {'name': ST.loop['name'], 'lap': ST.loop_lap, 'last_s': ST.loop_last_s}, 'game': ST.game, 'mode': {'suggest': ST.mode_suggest, 'reason': ST.mode_reason, 'kind': ST.game_kind, 'game': ST.game}, 'csv': ST.csv_path and os.path.relpath(ST.csv_path, ROOT)})}\n\n".encode()); last_status = now
                    self.wfile.flush(); time.sleep(0.02)
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                return
        elif self.path.startswith("/analysis"):
            body = json.dumps(ST.analysis or {}).encode()
            self.send_response(200); self._cors(); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)
        elif self.path.startswith("/cars-map"):
            body = json.dumps(names_load()).encode()
            self.send_response(200); self._cors(); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)
        elif self.path.startswith("/session.json"):
            body = json.dumps(ST.session_json or {}).encode()
            self.send_response(200); self._cors(); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)
        elif self.path.startswith("/health"):
            with ST.lock: body = json.dumps({"pps": round(len(ST.pps_win) / 2.0, 1), "frames": ST.frames, "receiving": time.monotonic() - ST.last_pkt < 1.0, "cars": list(ST.cars.keys()), "shots": bool(getattr(ST, "shots_dirs", None))}).encode()
            self.send_response(200); self._cors(); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)
        elif self.path.startswith("/shots"):   # recent in-game screenshots from the watched folder(s), newest first
            import urllib.parse as _up; q = _up.parse_qs(_up.urlparse(self.path).query); n = int((q.get("n") or ["24"])[0])
            imgs = []
            for d in getattr(ST, "shots_dirs", []) or []:
                try:
                    for fn in os.listdir(d):
                        if fn.lower().rsplit(".", 1)[-1] in ("png", "jpg", "jpeg", "bmp", "webp"):
                            p = os.path.join(d, fn); st_ = os.stat(p); imgs.append({"id": fn, "dir": d, "mtime": round(st_.st_mtime, 1), "size": st_.st_size, "url": "/shot?f=" + _up.quote(fn)})
                except Exception: pass
            imgs.sort(key=lambda x: -x["mtime"]); body = json.dumps({"dirs": getattr(ST, "shots_dirs", []), "shots": imgs[:n]}).encode()
            self.send_response(200); self._cors(); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)
        elif self.path.startswith("/shot"):   # serve one screenshot by filename (from the watched dirs only — no traversal)
            import urllib.parse as _up; q = _up.parse_qs(_up.urlparse(self.path).query); fn = os.path.basename((q.get("f") or [""])[0])
            path = next((os.path.join(d, fn) for d in getattr(ST, "shots_dirs", []) or [] if os.path.isfile(os.path.join(d, fn))), None)
            if not path: self.send_response(404); self._cors(); self.end_headers(); return
            ct = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "bmp": "image/bmp", "webp": "image/webp"}.get(fn.lower().rsplit(".", 1)[-1], "application/octet-stream")
            data = open(path, "rb").read()
            self.send_response(200); self._cors(); self.send_header("Content-Type", ct); self.send_header("Content-Length", str(len(data))); self.send_header("Cache-Control", "no-cache"); self.end_headers(); self.wfile.write(data)
        elif self.path.startswith("/disk-tunes"):   # every car with an on-disk tune (Data file) — the decode library index
            payload = {"available": False, "cars": []}
            if TUNE is not None:
                try:
                    names = names_load().get("cars", {}); by_ord, root = TUNE.scan_tunes(newest_only=False)
                    cars = []
                    for ordn, metas in by_ord.items():
                        nm = names.get(str(ordn)); nm = (nm.get("name") if isinstance(nm, dict) else nm)
                        t = TUNE.parse_tune(metas[0]["path"], ordinal_hint=ordn)
                        cars.append({"ordinal": ordn, "name": nm, "tunes": len(metas), "locked": t["locked"], "gears": t["gear_count"]})
                    cars.sort(key=lambda c: (c["name"] or "zzz"))
                    payload = {"available": True, "root": root, "count": len(cars), "cars": cars}
                except Exception as e:
                    payload = {"available": False, "error": str(e)}
            body = json.dumps(payload).encode()
            self.send_response(200); self._cors(); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)
        elif self.path.startswith("/disk-tune"):   # decoded tune + decode-section deliverable for one car (?ordinal=N, or active car)
            import urllib.parse as _up; q = _up.parse_qs(_up.urlparse(self.path).query)
            ordn = q.get("ordinal", [None])[0]
            if ordn is None:
                fr = ST.latest; ordn = fr and fr.get("car")   # fall back to the live/active car
            payload = {"available": False}
            if TUNE is not None and ordn is not None:
                try:
                    ordn = int(ordn); metas, _ = TUNE.tunes_for_ordinal(ordn)
                    if metas:
                        names = names_load().get("cars", {}); nm = names.get(str(ordn)); nm = (nm.get("name") if isinstance(nm, dict) else nm)
                        ts_want = q.get("ts", [None])[0]   # optional manual pick — decode a specific saved tune
                        meta, match = _pick_meta(metas, ordn, ts_want=ts_want)   # match the save to the car you're in, not just the newest
                        tune = TUNE.parse_tune(meta["path"], ordinal_hint=ordn)
                        deliverable = TUNE.tune_to_deliverable(tune, nm)
                        _enrich_engine_desc(deliverable, ordn)
                        _enrich_drivetrain(deliverable, ordn)
                        _enrich_gears(deliverable, ordn)
                        _build_union(deliverable, ordn, match=match)   # reconcile save vs telemetry: agreements, conflicts, ranked drive-asks
                        payload = {"available": True, "ordinal": ordn, "name": nm, "ts": meta["ts"],
                                   "tune": tune, "deliverable": deliverable, "match": match}
                    else:
                        payload = {"available": False, "ordinal": ordn, "reason": "no on-disk tune for this car"}
                except Exception as e:
                    payload = {"available": False, "error": str(e)}
            body = json.dumps(payload).encode()
            self.send_response(200); self._cors(); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)
        elif self.path.startswith("/liveries"):   # livery designs saved for one car — THE visual identity players use to tell builds apart. READ-ONLY.
            import urllib.parse as _up; q = _up.parse_qs(_up.urlparse(self.path).query)
            ordn = q.get("ordinal", [None])[0]
            out = {"liveries": []}
            if TUNE is not None and ordn is not None:
                try:
                    root = TUNE.find_containers_root(); tag = f"{int(ordn):04d}"
                    for d in sorted(os.listdir(root), reverse=True):
                        if not (d.startswith(f"Livery_{tag}_") or d.startswith(f"SoulBoundLivery_{tag}_") or d.startswith(f"BaseLivery_{tag}_")):
                            continue
                        full = os.path.join(root, d)
                        names = _livery_strings(os.path.join(full, "header"))
                        out["liveries"].append({"dir": d, "kind": d.split("_")[0], "ts": d.split("_")[-1],
                                                "name": (names[0] if names else None), "desc": (names[1] if len(names) > 1 else None),
                                                "creator": (names[2] if len(names) > 2 else None),
                                                "thumb": os.path.exists(os.path.join(full, "bigThumb.webp"))})
                except Exception as e_:
                    out["error"] = str(e_)
            body = json.dumps(out).encode()
            self.send_response(200); self._cors(); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)
        elif self.path.startswith("/livery-thumb"):   # the livery's thumbnail image (bigThumb.webp), streamed READ-ONLY
            data = None
            try:
                import urllib.parse as _up; q = _up.parse_qs(_up.urlparse(self.path).query)
                d = os.path.basename(q.get("d", [""])[0])   # basename() blocks path traversal
                ok_prefix = d.startswith("Livery_") or d.startswith("SoulBoundLivery_") or d.startswith("BaseLivery_")
                if TUNE is not None and ok_prefix:
                    root = TUNE.find_containers_root()
                    if root:
                        p = os.path.join(root, d, "bigThumb.webp")
                        if os.path.exists(p):
                            data = open(p, "rb").read()
            except Exception:
                data = None   # missing root / mid-save file swap must yield a clean 404, not a dead socket
            if data:
                # NOTE: no _cors() here — it stamps Cache-Control: no-cache, which would defeat the max-age below
                self.send_response(200); self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Content-Type", "image/webp"); self.send_header("Cache-Control", "max-age=3600")
                self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data)
            else:
                self.send_response(404); self._cors(); self.end_headers()
        else:
            self.send_response(404); self._cors(); self.end_headers()
    def do_OPTIONS(self):
        self.send_response(204); self._cors(); self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS"); self.send_header("Access-Control-Allow-Headers", "Content-Type"); self.end_headers()
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); body = json.loads(self.rfile.read(n) or b"{}")
        obj = names_load(); ok = False; save_names = False
        if self.path.startswith("/car") and body.get("ordinal") and body.get("name"):
            obj.setdefault("cars", {})[str(body["ordinal"])] = {"name": str(body["name"]).strip(), "confidence": "player-confirmed", "source": f"dashboard {time.strftime('%Y-%m-%d')}"}; ok = save_names = True
            with ST.lock:
                for c in ST.cars.values():
                    if str(c["ordinal"]) == str(body["ordinal"]): c["name"] = obj["cars"][str(body["ordinal"])]["name"]
        elif self.path.startswith("/reset"):
            reset_session(); ok = True
        elif (self.path.startswith("/tag") or self.path.startswith("/role")) and (body.get("label") is not None or body.get("role") is not None):
            n = int(body.get("stint") or ST.stint)
            with ST.lock:
                cur = dict(ST.stint_tags.get(str(n)) or {})
                if body.get("label") is not None: cur["label"] = str(body["label"]).strip()[:80]
                if "role" in body:
                    role = body["role"]
                    # a role is exclusive: clear it from any other stint first
                    if role in ("donor", "replica"):
                        for k, v in ST.stint_tags.items():
                            if isinstance(v, dict) and v.get("role") == role: v.pop("role", None)
                    if role: cur["role"] = role
                    else: cur.pop("role", None)
                cur.setdefault("t0", ST.stint_start); ST.stint_tags[str(n)] = cur
            _save_tags()
            ST.emit("tag", {"n": n, "label": cur.get("label"), "role": cur.get("role")}); ok = True
        elif self.path.startswith("/mode"):
            m = body.get("mode"); ST.lab_mode = m if m in ("course", "decode", "free") else None; ok = True   # effective lab mode from the dashboard (auto-detected or manual override)
        elif self.path.startswith("/clone-lock"):
            o = body.get("ordinal"); ST.clone_lock = int(o) if o else None; ok = True   # pin/clear a clone TARGET — pauses PI/catalog accrual for it so building the replica can't poison it
        elif self.path.startswith("/new-run"):
            ST._force_split = True; ok = True   # split at the next driving frame (after a slider change in Decode / Free mode)
        elif self.path.startswith("/analyze"):   # force a fresh analysis NOW (the 're-test' button after you implement a tune change)
            if ST.csv_path and not ST.analyzing:
                ST._last_lap_analysis = 0.0; ST.drive_since_periodic = 0.0
                threading.Thread(target=run_analysis, args=(None, False), daemon=True).start()
            ok = True; resp = {"ok": True, "analyzing": bool(ST.analyzing)}
        elif self.path.startswith("/tune-range") and body.get("field") is not None:   # register a (norm, displayed-value) point to back-solve a per-car slider range
            resp = {"ok": False}
            if TUNE is not None:
                try:
                    ordn = int(body.get("ordinal")); field = str(body["field"])
                    # Read the CURRENT position straight from the newest save rather than trusting the client's cached
                    # norm — the calibration card doesn't re-render on every save (the disk-watch only re-decodes while a
                    # car is in-frame, not in the menu), so a downforce/aero re-save was registering the SAME position
                    # twice and the range never solved. Pair the newest-save norm with the value the user just read.
                    norm = None
                    try:
                        metas, _ = TUNE.tunes_for_ordinal(ordn)
                        if metas:
                            e = (TUNE.parse_tune(metas[0]["path"], ordinal_hint=ordn).get("sliders") or {}).get(field)
                            if e and e.get("norm") is not None: norm = float(e["norm"])
                    except Exception: pass
                    if norm is None: norm = float(body.get("norm"))
                    solved = TUNE.register_range(ordn, field, norm, float(body["value"]), unit=body.get("unit"))
                    npts, distinct = TUNE.range_points(ordn, field)
                    resp = {"ok": True, "solved": solved, "points": npts, "distinct": distinct,
                            "need": max(0, 2 - distinct), "norm": round(norm, 4), "field": field, "ordinal": ordn}
                except Exception as ex_:
                    print("tune-range not saved:", repr(ex_), file=sys.stderr); resp = {"ok": False, "error": str(ex_)}
            out2 = json.dumps(resp).encode()
            self.send_response(200 if resp.get("ok") else 400); self._cors(); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(out2))); self.end_headers(); self.wfile.write(out2); return
        elif self.path.startswith("/build-field") and body.get("cid"):   # save a 'shop check' value (from a screenshot) into the build record data/builds/<cid>.json
            try:
                import re as _re2
                bdir = os.path.join(ROOT, "data", "builds"); os.makedirs(bdir, exist_ok=True)
                fn = _re2.sub(r"[^A-Za-z0-9._-]+", "_", str(body["cid"])) + ".json"; bp = os.path.join(bdir, fn)   # '|' is illegal in Windows filenames — the real cid is kept in the JSON
                if os.path.exists(bp):
                    with open(bp, encoding="utf-8") as f: rec = json.load(f)
                else:
                    tp = os.path.join(bdir, "_template.json")
                    rec = json.load(open(tp, encoding="utf-8")) if os.path.exists(tp) else {"parts": {}, "pane": {}}
                    rec["cid"] = str(body["cid"]); rec["car_ordinal"] = int(str(body["cid"]).split("|")[0]); rec.pop("_purpose", None)
                rec.setdefault("captured", time.strftime("%Y-%m-%d")); rec["source"] = "dashboard shop-capture (screenshots)"; rec["updated"] = time.strftime("%Y-%m-%d %H:%M")
                if body.get("pane_key") is not None: rec.setdefault("pane", {})[str(body["pane_key"])] = body.get("value")
                elif body.get("menu") and body.get("slot"):
                    items = rec.setdefault("parts", {}).setdefault(str(body["menu"]), [])
                    row = next((it for it in items if it.get("slot") == body["slot"]), None)
                    if row is None: row = {"slot": body["slot"]}; items.append(row)
                    row["installed"] = body.get("value");
                    if body.get("shot"): row["shot"] = body["shot"]
                elif body.get("tune_tabs") is not None: rec["tune_tabs"] = body["tune_tabs"]
                with open(bp + ".tmp", "w", encoding="utf-8") as f: json.dump(rec, f, indent=1, ensure_ascii=False)
                os.replace(bp + ".tmp", bp); ok = True
            except Exception as ex_: print("build-field not saved:", repr(ex_), file=sys.stderr); ok = False
        elif self.path.startswith("/mark-start") and body.get("name"):
            if ST.last_pos is None or (abs(ST.last_pos[0]) < 5 and abs(ST.last_pos[1]) < 5): ok = False   # no valid ON-TRACK position yet (menu / pre-race reports [0,0]) — drive onto the track first, then mark
            else:
                name = str(body["name"]).strip()[:60]; lp = {"name": name, "start": [round(ST.last_pos[0]), round(ST.last_pos[1])], "radius": int(body.get("radius") or 60), "min_dist": int(body.get("min_dist") or 250)}
                rp = os.path.join(ROOT, "data", "reference-loops.json")
                try:
                    with open(rp, encoding="utf-8") as f: lobj = json.load(f)
                except Exception: lobj = {"schema_version": "1.0.0", "loops": {}}
                lobj.setdefault("loops", {})[name] = {k: lp[k] for k in ("start", "radius", "min_dist")}
                with open(rp, "w", encoding="utf-8") as f: json.dump(lobj, f, indent=2, ensure_ascii=False)
                with ST.lock: ST.loop = lp; ST.loop_lap = 0; ST._loop_state = "start"; ST._loop_away = 0.0; ST._loop_prev = None; ST._loop_t0 = None; ST.loop_last_s = None
                ST.emit("loop", {"name": name, "start": lp["start"], "lap": 0}); ok = True
        elif self.path.startswith("/clear-loop"):
            with ST.lock: ST.loop = None; ST.loop_lap = 0
            ST.emit("loop", {"name": None}); ok = True
        elif self.path.startswith("/course-expected") and body.get("route_key") is not None:
            import re as _re
            mp = os.path.join(ROOT, "data", "courses", _re.sub(r"[^A-Za-z0-9_.-]+", "_", str(body["route_key"])) + ".json")   # ground-truth turn count → persists in the course model; next analysis cross-checks
            try:
                m = {}
                if os.path.exists(mp):
                    with open(mp, encoding="utf-8") as f: m = json.load(f)
                n = body.get("n")
                if n in (None, "", 0): m.pop("expected_turns", None)
                else: m["expected_turns"] = int(n)
                if m:
                    with open(mp + ".tmp", "w", encoding="utf-8") as f: json.dump(m, f, indent=1, ensure_ascii=False)
                    os.replace(mp + ".tmp", mp)
                ok = True
            except Exception as ex_: print("course-expected not saved:", repr(ex_), file=sys.stderr)
        elif self.path.startswith("/build-livery") and body.get("ordinal") and body.get("build") is not None:   # pin (or clear) a build↔livery association — user-confirmed truth over the save-time guess
            bp = os.path.join(ROOT, "data", "build-liveries.json")
            try:
                with open(bp, encoding="utf-8") as f: bobj = json.load(f)
            except Exception:
                bobj = {"schema_version": "1.0.0", "assoc": {}}
            a_ = bobj.setdefault("assoc", {}).setdefault(str(int(body["ordinal"])), {})
            d_ = body.get("dir")
            if d_: a_[str(body["build"])] = os.path.basename(str(d_))
            else: a_.pop(str(body["build"]), None)
            tmp_ = bp + ".tmp"
            with open(tmp_, "w", encoding="utf-8") as f: json.dump(bobj, f, indent=1)
            os.replace(tmp_, bp); ok = True
        elif self.path.startswith("/route") and body.get("route_key") and body.get("name"):
            rp = os.path.join(ROOT, "data", "routes.json")
            try:
                with open(rp, encoding="utf-8") as f: robj = json.load(f)
            except Exception: robj = {"schema_version": "1.0.0", "routes": {}}
            robj.setdefault("routes", {})[str(body["route_key"])] = {"name": str(body["name"]).strip()[:80], "source": f"dashboard {time.strftime('%Y-%m-%d')}", "mode": body.get("mode")}
            with open(rp, "w", encoding="utf-8") as f: json.dump(robj, f, indent=2, ensure_ascii=False)
            ok = True
        elif self.path.startswith("/build") and body.get("build_id") and body.get("label"):
            obj.setdefault("builds", {})[str(body["build_id"])] = {"label": str(body["label"]).strip(), "source": f"dashboard {time.strftime('%Y-%m-%d')}", "cid": body.get("cid")}; ok = save_names = True
        if save_names: names_save(obj)
        out = json.dumps({"ok": ok, "cars": obj.get("cars", {}), "builds": obj.get("builds", {})}).encode()
        self.send_response(200 if ok else 400); self._cors(); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(out))); self.end_headers(); self.wfile.write(out)

def reset_session():
    """Start a fresh session on request: clear live accumulators and rotate the CSV (live mode)."""
    with ST.lock:
        ST.strip = []; ST.corners = []; ST._corner = None; ST._sec = None; ST._sec_rows = []; ST.cars = {}
        ST.analysis = None; ST.session_json = None; ST.session_path = None
        ST.fdg_cache = {}; ST.gear_verdicts = {}   # measured-ladder cache + hysteresis state die with the session — stale telemetry must not outlive it
        ST.last_on_t = None; ST.live_since_analysis = 0.0; ST.drive_since_periodic = 0.0
        ST.stint = 0; ST.stint_start = None; ST._zero_since = None; ST.prev_cfg = None; ST.stint_tags = {}
        ST.loop_lap = 0; ST._loop_state = "start"; ST._loop_away = 0.0; ST._loop_prev = None; ST._loop_t0 = None; ST.loop_last_s = None; ST._auto_suspend = None   # keep the loop DEFINITION, reset its lap count
        ST.live_seen = {}   # J20: the parked-identity hold is session telemetry — it dies with the session
        ST.gears_seen = {}
        ST.game = "menu"; ST.game_kind = None; ST._noev_since = None; ST.ev_maxpos = 0; ST.mode_suggest = None; ST.mode_reason = None
        ST._force_split = False; ST._ev_edge = False; ST.stint_starts = {}; ST.last_drive_game = None   # lab_mode (dashboard override) intentionally kept
        ST.events = []; ST.seq += 1
        if ST.csv_file and not ST.replay:
            try: ST.csv_file.close()
            except Exception: pass
            ST.csv_path = os.path.join(os.path.dirname(ST.csv_path), f"fh6_{time.strftime('%Y%m%d_%H%M%S')}.csv")
            ST.csv_file = open(ST.csv_path, "w", newline=""); ST.csv_writer = csv.writer(ST.csv_file)
            ST.csv_writer.writerow(["t_wall", "t_mono", "speed_mph", "lat_g", "long_g", "yaw_rate_dps"] + [f"TireTempC{w}" for w in W] + FIELDS)
            ST.frames = 0; ST.t0 = time.monotonic()
    ST.emit("reset", {"csv": ST.csv_path and os.path.relpath(ST.csv_path, ROOT)})
    print(f"[reset] new session -> {ST.csv_path}")

def udp_loop(port):
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); sock.bind(("0.0.0.0", port)); sock.settimeout(1.0)
    print(f"[udp] listening 0.0.0.0:{port}")
    t0 = time.monotonic()
    while True:
        try: data, _ = sock.recvfrom(2048)
        except socket.timeout: continue
        if len(data) < 323: continue
        if len(data) == 323: data += b"\x00"
        ingest(decode(data), time.monotonic() - t0)

def replay_loop(path, speed):
    print(f"[replay] {path} at {speed}x")
    with open(path, newline="") as f:
        rd = csv.DictReader(f); prev = None; start = time.monotonic(); tbase = None
        for r in rd:
            t = float(r["t_mono"])
            if tbase is None: tbase = t
            rel = (t - tbase) / speed
            while time.monotonic() - start < rel: time.sleep(0.002)
            p = {k: (float(r[k]) if k not in ("IsRaceOn","Gear","Accel","Brake","Clutch","HandBrake","Steer","CarOrdinal","CarPI","CarClass","DrivetrainType","NumCylinders","CarGroup","LapNumber","RacePosition","Trailing323","NormDrivingLine","NormAIBrakeDiff") else int(float(r[k]))) for k in FIELDS}
            ingest(p, t - tbase)
    print("[replay] done")

_PI_SOLVE_AT = [0.0]
def _maybe_solve_pi():
    """Auto-accrue: re-run the per-part PI solver in the background as observations grow (throttled to 120 s),
    then invalidate the decode's parts-pi cache so the next deliverable reflects freshly-solved estimates.
    Subprocess = clean module state; all failures are non-fatal (PI stays whatever it last solved)."""
    now = time.time()
    if now - _PI_SOLVE_AT[0] < 120:
        return
    _PI_SOLVE_AT[0] = now
    def _run():
        try:
            subprocess.run([sys.executable, os.path.join(HERE, "fh6_pi_solve.py")], cwd=ROOT, timeout=60,
                           capture_output=True)
            if TUNE is not None:
                TUNE._PARTS_PI = None      # force reload of data/parts-pi.json on the next pi_for()
        except Exception:
            pass
    threading.Thread(target=_run, daemon=True).start()


def _record_pi_observation(ordn, tune):
    """Feature B: append/refresh one observation pairing the active car's decoded config (its 50 slot tiers)
    with the live CarPI, in data/pi-observations.json. Guards: only when THIS car is the active, on-track car
    with a plausible CarPI (a car in a menu drops CarOrdinal->0 / CarPI absent). Deduped by parts_hash (same
    exact config recorded once, latest CarPI kept). Safe-write (temp + os.replace). Never touches the save."""
    if TUNE is None:
        return
    fr = ST.latest
    if not fr or not fr.get("on"):
        return
    try:
        if int(fr.get("car") or 0) != int(ordn):
            return
        pi = int(fr.get("pi") or 0)
    except (TypeError, ValueError):
        return
    if pi <= 0 or pi > 999:              # CarPI is 100..999; 0/absent means a menu / no valid read
        return
    try:
        ph = TUNE.parts_hash(ordn, tune["parts"])
    except Exception:
        return
    key = (int(ordn), ph, pi)
    if key == _PI_LAST[0]:               # same config + same PI already written — nothing to do
        return
    with _PI_LOCK:
        try:
            with open(PI_OBS_PATH, encoding="utf-8") as f:
                doc = json.load(f)
            if not isinstance(doc, dict):
                doc = {}
        except Exception:
            doc = {}
        doc.setdefault("schema_version", "1.0.0")
        doc.setdefault("purpose", "decoded-config <-> live CarPI observations; single-part diffs give per-part "
                                  "PI cost — see scripts/telemetry/fh6_pi_solve.py")
        obs = doc.setdefault("observations", [])
        rec = {"ordinal": int(ordn), "ts": round(time.time(), 1), "car_pi": pi, "car_class": fr.get("cls"),
               "parts": TUNE.parts_tiers(tune["parts"]), "parts_hash": ph}
        for i, o in enumerate(obs):
            if o.get("parts_hash") == ph and int(o.get("ordinal", -1)) == int(ordn):
                if int(o.get("car_pi") or 0) != pi:   # same config cannot have two PIs — the earlier stamp was misattributed (pre-guard era) or pre-family-hash; the fresh VERIFIED read wins
                    print(f"[pi-obs] CONFLICTING re-stamp ord {ordn} {ph}: {o.get('car_pi')} -> {pi} (earlier stamp replaced)")
                obs[i] = rec; break
        else:
            obs.append(rec)
        data = json.dumps(doc, indent=1, ensure_ascii=False)
        if len(data) < 20:               # sanity: never truncate to garbage
            return
        tmp = PI_OBS_PATH + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(data)
        if os.path.getsize(tmp) < 20:
            os.remove(tmp); return
        os.replace(tmp, PI_OBS_PATH)
    _PI_LAST[0] = key
    # the decode module CACHES observations — without this, /disk-tune serves pre-stamp PIs for the daemon's
    # whole lifetime (the "identifies as A700 while the live frame says S1 800" bug). Refresh + force a re-emit.
    try:
        TUNE._PI_OBS = None
    except Exception:
        pass
    ST._disk_dirty = True


def disk_watcher():
    """Watch the FH save folder for the ACTIVE car and push a fresh decode (+ a diff vs the previous
    save) over SSE the instant a new tune Data file appears. Saving a tune in-game then updates the
    dashboard within ~1s, hands-free. Diff only fires on a genuine re-save of the same car, not a car change."""
    if TUNE is None:
        return
    last = None
    while True:
        time.sleep(1.5)
        try:
            fr = ST.latest; ordn = fr and fr.get("car")
            if ordn:
                ST.last_car = int(ordn)
            else:
                ordn = getattr(ST, "last_car", None)   # J3: the FIRST save happens IN the tune menu, where CarOrdinal drops to 0 — watch the last driven car so the save is detected without requiring another drive
            if not ordn:
                continue
            ordn = int(ordn)
            metas, _ = TUNE.tunes_for_ordinal(ordn)
            if not metas:
                if last != (ordn, None):
                    last = (ordn, None); ST.emit("disk", {"ordinal": ordn, "available": False})
                continue
            # Feature B: record a PI observation for the current on-disk config whenever this car is being
            # driven (cheap 598-byte re-decode; deduped by _PI_LAST so the file isn't rewritten needlessly).
            try:
                # PAUSE accrual for a locked clone target: while you build the replica, half-built configs must not be
                # recorded (a stale on-disk parts snapshot paired with live PI corrupts real configs — see audit).
                if fr.get("on") and int(fr.get("car") or 0) == ordn and int(fr.get("pi") or 0) > 0 and ST.clone_lock != ordn:
                    rec_meta, _rm = _pick_meta(metas, ordn)   # pair the LIVE build's parts (matched by cyl) with the live PI — not the newest file, which may be a different build
                    # J6: a verdict CHANGE (e.g. the gear ladder just verified the build mid-event) must reach the
                    # client — no file changed, so the mtime watcher alone would never re-emit and the confirm gate
                    # stayed blocked on 'drive the gears' the user had already driven.
                    if not hasattr(ST, "_last_verdict"):
                        ST._last_verdict = {}
                    _v = f"{_rm.get('how')}|{rec_meta.get('ts')}" if _rm else ""
                    if ST._last_verdict.get(str(ordn)) != _v:
                        ST._last_verdict[str(ordn)] = _v; ST._disk_dirty = True
                    # STAMP ONLY ON A VERIFIED IDENTITY: with several same-cyl builds, a cyl/PI pick can't prove WHICH
                    # build is equipped (at a class cap they converge; unstamped PIs are unknown) — stamping then would
                    # pair the live PI with the wrong build's parts and poison the observation store. Require a single
                    # candidate or a gear-ladder-verified pick.
                    ok_stamp = _rm and _rm.get("how") != "no-match" and ((_rm.get("n_signature_ties") or 1) <= 1 or _rm.get("gear_disambig"))
                    if ok_stamp:
                        _record_pi_observation(ordn, TUNE.parse_tune(rec_meta["path"], ordinal_hint=ordn))
                    _maybe_solve_pi()   # keep parts-pi.json fresh as configs accrue (throttled, background)
            except Exception:
                pass
            if getattr(ST, "_disk_dirty", False):
                ST._disk_dirty = False; last = (None, None)   # an auto-association changed the deliverable — re-emit even without a file change
            key = (ordn, round(metas[0]["mtime"], 2))
            if key == last:
                continue
            new_save = bool(last and last[0] == ordn)   # same car + newer file = a fresh save
            last = key
            if new_save:
                # a fresh save may change gearing/identity — drop this car's measured-ladder cache + gear verdicts so
                # stale telemetry can't be compared against the new tune (phantom conflicts), and its livery may have
                # changed too (the client clears its own livery cache off this event)
                if hasattr(ST, "fdg_cache"):
                    for k in [k for k in ST.fdg_cache if k.startswith(f"{ordn}|")]:
                        ST.fdg_cache.pop(k, None)
                if hasattr(ST, "gear_verdicts"):
                    for k in [k for k in ST.gear_verdicts if k.startswith(f"{ordn}|")]:
                        ST.gear_verdicts.pop(k, None)
                # an in-game save is a POSITIVE identity signal — it comes from the car you're sitting in, so the
                # just-written file IS the equipped build. Re-anchor the sticky identity to it.
                if not hasattr(ST, "gear_id"):
                    ST.gear_id = {}
                ST.gear_id[str(ordn)] = {"ts": str(metas[0]["ts"]), "t": time.time()}
                _gear_log(ordn, metas[0]["ts"]); _auto_assoc_livery(ordn)
            nm = names_load().get("cars", {}).get(str(ordn)) or {}
            nm = nm.get("name") if isinstance(nm, dict) else nm
            diff = None
            if new_save and len(metas) >= 2:
                try:
                    diff = TUNE.tune_diff(TUNE.parse_tune(metas[1]["path"], ordinal_hint=ordn),
                                          TUNE.parse_tune(metas[0]["path"], ordinal_hint=ordn))
                except Exception:
                    diff = None
            # decode the MATCHED save (same _pick_meta as /disk-tune) and CARRY the match — the emit used to decode
            # metas[0] with no match key, which made the client's confirm gate read every save event as
            # 'single save — unambiguous' and bypassed applyDiskTune's no-match guard.
            meta_m, match_m = _pick_meta(metas, ordn)
            tune = TUNE.parse_tune(meta_m["path"], ordinal_hint=ordn)
            deliverable = TUNE.tune_to_deliverable(tune, nm)
            _enrich_engine_desc(deliverable, ordn); _enrich_drivetrain(deliverable, ordn); _enrich_gears(deliverable, ordn)
            _build_union(deliverable, ordn, match=match_m)
            ST.emit("disk", {"ordinal": ordn, "name": nm, "ts": meta_m["ts"], "available": True,
                             "deliverable": deliverable, "match": match_m, "diff": diff, "new_save": new_save})
        except Exception:
            pass

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=9876); ap.add_argument("--http", type=int, default=8765)
    ap.add_argument("--out", default=os.path.join(ROOT, "captures")); ap.add_argument("--replay"); ap.add_argument("--speed", type=float, default=1.0)
    ap.add_argument("--no-csv", action="store_true")
    ap.add_argument("--shots-dir", action="append", help="folder(s) of in-game screenshots to serve to the dashboard (repeatable); defaults to Pictures/Screenshots + Videos/Captures")
    a = ap.parse_args()
    # screenshot folders for the dashboard's shop-capture panel — default to the common Windows capture locations
    home = os.path.expanduser("~")
    defaults = [os.path.join(home, "Pictures", "Screenshots"), os.path.join(home, "Videos", "Captures"), os.path.join(home, "Documents", "ShareX", "Screenshots")]
    ST.shots_dirs = [d for d in (a.shots_dir or defaults) if os.path.isdir(d)]
    if ST.shots_dirs: print("[shots] serving screenshots from:", " · ".join(ST.shots_dirs))
    if not a.no_csv and not a.replay:
        os.makedirs(a.out, exist_ok=True)
        ST.csv_path = os.path.join(a.out, f"fh6_{time.strftime('%Y%m%d_%H%M%S')}.csv")
        ST.csv_file = open(ST.csv_path, "w", newline=""); ST.csv_writer = csv.writer(ST.csv_file)
        ST.csv_writer.writerow(["t_wall", "t_mono", "speed_mph", "lat_g", "long_g", "yaw_rate_dps"] + [f"TireTempC{w}" for w in W] + FIELDS)
        print(f"[csv] {ST.csv_path}")
    elif a.replay:
        ST.csv_path = os.path.abspath(a.replay); ST.replay = True   # analysis runs on the replayed file, capped at replay time
    srv = ThreadingHTTPServer(("127.0.0.1", a.http), H); srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    if TUNE is not None:
        threading.Thread(target=disk_watcher, daemon=True).start()   # push on-disk tune decode on save / car change
    print(f"[http] http://localhost:{a.http}/events  (SSE)  /session.json  /health")
    try:
        if a.replay: replay_loop(a.replay, a.speed); time.sleep(8)
        else: udp_loop(a.port)
    except KeyboardInterrupt:
        pass
    finally:
        if ST.csv_file: ST.csv_file.close()

if __name__ == "__main__":
    main()
