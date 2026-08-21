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

ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
G = 9.80665
CLASS = {0: "D", 1: "C", 2: "B", 3: "A", 4: "S1", 5: "S2", 6: "X", 7: "X"}
DRIVE = {0: "FWD", 1: "RWD", 2: "AWD"}

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
        self.last_on_t = None; self.live_since_analysis = 0.0; self.analyzing = False
        self.session_json = None; self.session_path = None
        self.events = []            # queued one-shot events (strip/corner/session) for SSE clients: list of (seq, name, payload)
        self.seq = 0
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
        "lat": round(p["AccelX"] / G, 2), "lon": round(p["AccelZ"] / G, 2), "yaw": round(math.degrees(p["AngVelY"]), 1),
        "steer": p["Steer"], "thr": p["Accel"], "brk": p["Brake"], "hb": p["HandBrake"], "boost": round(p["Boost"], 1),
        "hp": round(p["Power"] / 745.7), "tq": round(p["Torque"] * 0.7376),
        "slip": {w: [fl("SlipRatio" + w), fl("SlipAngle" + w), fl("CombinedSlip" + w)] for w in W},
        "susp": [round(p["NormSusp" + w], 3) for w in W],
        "temp": [round(p["TireTempF" + w]) for w in W],
        "smash": round(p["SmashableVelDiff"], 2),
    }

def ingest(p, t_mono):
    """Core pipeline for one decoded packet (live or replay)."""
    c = compact(p, t_mono)
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
                v_min = min(r["mph"] for r in rows)
                cc = {"t0": round(rows[0]["t"], 1), "t1": round(rows[-1]["t"], 1), "car": co["car"], "dir": "R" if sign > 0 else "L", "mph_in": round(rows[0]["mph"]), "mph_min": round(v_min),
                      "lat_g_peak": round(peak, 2), "phases": phases, "first_red": first, "usi": round(usi, 3), "drift": drift, "kink": v_min > 85 and peak < 0.9,
                      "brake_max": max([r["brk"] for r in co["pre"] + rows] or [0]), "hb": any(r["hb"] > 0 for r in rows)}
                with ST.lock: ST.corners.append(cc)
                ST.emit("corner", cc)
    # auto-analysis trigger: driving stopped for > 5 s after >= 15 s of driving since last analysis
    if c["on"]:
        ST.last_on_t = t_mono; ST.live_since_analysis += 1 / 100.0
    elif ST.last_on_t is not None and t_mono - ST.last_on_t > 5 and ST.live_since_analysis > 15 and not ST.analyzing and ST.csv_path:
        ST.live_since_analysis = 0; threading.Thread(target=run_analysis, daemon=True).start()

def run_analysis():
    ST.analyzing = True
    try:
        if ST.csv_file: ST.csv_file.flush()
        outdir = os.path.join(ROOT, "data", "sessions")
        r = subprocess.run([sys.executable, os.path.join(HERE, "analyze_session.py"), ST.csv_path, "--out", outdir], capture_output=True, text=True, timeout=120)
        sid = os.path.splitext(os.path.basename(ST.csv_path))[0]
        path = os.path.join(outdir, sid + ".json")
        if os.path.exists(path):
            with open(path) as f: js = json.load(f)
            with ST.lock: ST.session_json = js; ST.session_path = path
            ST.emit("session", {"id": js["id"], "summary": js["summary"], "path": os.path.relpath(path, ROOT)})
            print(f"[analysis] {js['id']} -> {js['summary']}")
        else:
            print("[analysis] failed:", r.stdout[-300:], r.stderr[-300:])
    finally:
        ST.analyzing = False

# ---------------- HTTP / SSE ----------------
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
                with ST.lock: snap = {"strip": ST.strip[-1800:], "corners": ST.corners[-60:], "cars": list(ST.cars.values()), "session": ST.session_json and {"id": ST.session_json["id"], "summary": ST.session_json["summary"]}}
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
                        self.wfile.write(f"event: status\ndata: {json.dumps({'pps': round(pps, 1), 'frames': frames, 'receiving': now - lp < 1.0, 'cars': list(ST.cars.values()), 'csv': ST.csv_path and os.path.relpath(ST.csv_path, ROOT)})}\n\n".encode()); last_status = now
                    self.wfile.flush(); time.sleep(0.02)
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                return
        elif self.path.startswith("/cars-map"):
            body = json.dumps(names_load()).encode()
            self.send_response(200); self._cors(); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)
        elif self.path.startswith("/session.json"):
            body = json.dumps(ST.session_json or {}).encode()
            self.send_response(200); self._cors(); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)
        elif self.path.startswith("/health"):
            with ST.lock: body = json.dumps({"pps": round(len(ST.pps_win) / 2.0, 1), "frames": ST.frames, "receiving": time.monotonic() - ST.last_pkt < 1.0, "cars": list(ST.cars.keys())}).encode()
            self.send_response(200); self._cors(); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)
        else:
            self.send_response(404); self._cors(); self.end_headers()
    def do_OPTIONS(self):
        self.send_response(204); self._cors(); self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS"); self.send_header("Access-Control-Allow-Headers", "Content-Type"); self.end_headers()
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); body = json.loads(self.rfile.read(n) or b"{}")
        obj = names_load(); ok = False
        if self.path.startswith("/car") and body.get("ordinal") and body.get("name"):
            obj.setdefault("cars", {})[str(body["ordinal"])] = {"name": str(body["name"]).strip(), "confidence": "player-confirmed", "source": f"dashboard {time.strftime('%Y-%m-%d')}"}; ok = True
            with ST.lock:
                for c in ST.cars.values():
                    if str(c["ordinal"]) == str(body["ordinal"]): c["name"] = obj["cars"][str(body["ordinal"])]["name"]
        elif self.path.startswith("/build") and body.get("build_id") and body.get("label"):
            obj.setdefault("builds", {})[str(body["build_id"])] = {"label": str(body["label"]).strip(), "source": f"dashboard {time.strftime('%Y-%m-%d')}", "cid": body.get("cid")}; ok = True
        if ok: names_save(obj)
        out = json.dumps({"ok": ok, "cars": obj.get("cars", {}), "builds": obj.get("builds", {})}).encode()
        self.send_response(200 if ok else 400); self._cors(); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(out))); self.end_headers(); self.wfile.write(out)

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

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=9876); ap.add_argument("--http", type=int, default=8765)
    ap.add_argument("--out", default=os.path.join(ROOT, "captures")); ap.add_argument("--replay"); ap.add_argument("--speed", type=float, default=1.0)
    ap.add_argument("--no-csv", action="store_true")
    a = ap.parse_args()
    if not a.no_csv and not a.replay:
        os.makedirs(a.out, exist_ok=True)
        ST.csv_path = os.path.join(a.out, f"fh6_{time.strftime('%Y%m%d_%H%M%S')}.csv")
        ST.csv_file = open(ST.csv_path, "w", newline=""); ST.csv_writer = csv.writer(ST.csv_file)
        ST.csv_writer.writerow(["t_wall", "t_mono", "speed_mph", "lat_g", "long_g", "yaw_rate_dps"] + [f"TireTempC{w}" for w in W] + FIELDS)
        print(f"[csv] {ST.csv_path}")
    elif a.replay:
        ST.csv_path = os.path.abspath(a.replay)   # analysis runs on the replayed file
    srv = ThreadingHTTPServer(("127.0.0.1", a.http), H); srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
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
