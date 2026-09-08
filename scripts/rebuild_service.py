#!/usr/bin/env python3
"""The import-and-regenerate service: one local HTTP endpoint the dashboard can call.

    python scripts/rebuild_service.py 8001          # from the repo root (the WORKTREE), like the daemon

Why a separate process. The dashboard server (scripts/serve_dashboard.py, port 8000) and the live daemon
(port 8765) must not be restarted casually — the daemon holds the session, the server serves the current
tags — so the one thing that has to be able to run Python on the user's behalf lives here, on its own port.

What it does. POST /rebuild takes a `scope` (default "containers") and runs that scope's steps, in a
worker thread:
    scope=containers (the dashboard, on a NEW SAVE):
        python scripts/db/rebuild.py --only containers   (the save containers -> parts, sliders, gears, packages)
        python scripts/db/build_web.py                    (the dashboard's api/*.json)
    scope=telemetry (the live daemon, on session close):
        python scripts/db/rebuild.py --only telemetry     (sessions, courses, laps, per-sample trace rows;
                                                           since 2026-09-05 `--only` CASCADES to its dependents:
                                                           course_match, route_names, corners, diagnosis)
        python scripts/db/build_web.py                    (courses.json carries route_id + name provenance)
Measured 2026-09-03 on 578 containers: 7.8 s + 1.75 s. Measured the same day on 13 sessions: 2.8 s + 0.4 s.
Both are light enough to run automatically on their own natural boundary — a new save, or driving having
stopped for 5 s after >= 15 s of driving (a real session close, never a menu return or a mid-lap event:
`routes`/`surface` are deliberately NOT in scope=telemetry — they describe the game's static road network,
not this session, and cost ~22 s combined for no new information after the first time a route is seen).
BUG FIXED 2026-09-03: scope=telemetry did not exist; every automatic trigger only ever ran scope=containers,
so `session`/`lap`/`corner_obs` silently fell behind — 13 sessions and 5+ hours of driving, one of them the
exact session Jett asked about, were sitting on disk unimported until a manual full rebuild caught them up.
See memory fh6-telemetry-rebuild-scope-gap.

A request that arrives while a run of the SAME OR ANY scope is in progress is coalesced per scope: each
distinct pending scope runs once more when the current run finishes, so a burst of triggers across both
scopes costs at most one run per scope, never a queue.

GET /status reports {state, started, finished, wall_s, rc, tail, runs, queued_scopes, scope, sessions_pending}.
`sessions_pending` is a proactive staleness signal, not just a log: the count of session files on disk
newer than the newest imported session, refreshed on every /status poll, so the dashboard can show it as a
chip (matching how a new tune save already gets an "as saved, not yet held" state) instead of the gap being
invisible until someone happens to query the database directly. Everything binds to 127.0.0.1 only; CORS is
open because the caller is the dashboard on another local port.

GET /watch is the live-reload channel (Server-Sent Events). The service polls the dashboard's own files
once a second and pushes `code` when any of them changes (index.html, *.js, *.css under dashboard/v2 —
the ?v= bump in index.html is how a code change is announced), and pushes `data` the moment a rebuild
finishes or dashboard/v2/api/identity.json is rewritten by anyone. The page reloads on `code` and
re-reads its data on `data`; nothing in the browser polls.
"""
import queue
import json, os, subprocess, sys, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
SCOPES = {
    "containers": [["scripts/db/rebuild.py", "--only", "containers"], ["scripts/db/build_web.py"]],
    # build_web is NOT in the telemetry scope: it rewrites all ~776 api files over ~20 s, and a session
    # close fires every few minutes while the game sits in menus -- the live page re-read the api
    # mid-write and flickered continuously (2026-09-05 20:30). The api refreshes on the containers
    # scope (a save) as before; courses.json provenance follows on the next save.
    "telemetry": [["scripts/db/rebuild.py", "--only", "telemetry"]],
}
DEFAULT_SCOPE = "containers"

WATCH = {"subs": [], "lock": threading.Lock(), "code_sig": None, "data_sig": None}
CODE_DIR = os.path.join(ROOT, "dashboard", "v2")
DATA_FILE = os.path.join(ROOT, "dashboard", "v2", "api", "identity.json")
SESSIONS_DIR = os.path.join(ROOT, "data", "sessions")


OPEN_SESSION_GRACE_S = 90   # run_analysis rewrites the CURRENT session's file every 6-40+ s while
                            # driving (see maybe_lap_analysis's debounce) -- a file touched more
                            # recently than this is presumed still open, not stale. Without this, the
                            # chip would read "N pending" the instant you start driving, every time,
                            # which is not a confidence-worthy signal -- it's indistinguishable noise
                            # from a genuinely stuck import. Only a file that has gone quiet longer
                            # than any real debounce interval is counted as a real gap.


def _sessions_pending(db=None):
    """How many session*.json files on disk are (a) newer than the newest imported session AND
    (b) have not been touched in OPEN_SESSION_GRACE_S -- i.e. genuinely closed and still unimported,
    not just the session currently being driven. The proactive staleness signal for scope=telemetry.
    Cheap: one listdir + one small SQL query, safe to call on every /status poll. Returns 0 (not an
    error) if the db or dir isn't reachable yet -- a missing signal must read as "nothing to report",
    never as a false "everything's fine"."""
    try:
        import sqlite3
        now = time.time()
        names = sorted(
            fn[:-5] for fn in os.listdir(SESSIONS_DIR)
            if fn.endswith(".json") and not fn.endswith(".tags.json")
            and now - os.path.getmtime(os.path.join(SESSIONS_DIR, fn)) > OPEN_SESSION_GRACE_S)
        if not names:
            return 0
        dbp = db or os.path.join(ROOT, "data", "fh6.db")
        cx = sqlite3.connect(dbp)
        row = cx.execute("select max(session_id) from session").fetchone()
        cx.close()
        newest_imported = row[0] if row else None
        if newest_imported is None:
            return len(names)
        return sum(1 for n in names if n > newest_imported)
    except Exception:
        return 0


def _code_sig():
    out = []
    for fn in sorted(os.listdir(CODE_DIR)):
        if fn.endswith((".html", ".js", ".css")):
            try: out.append((fn, os.path.getmtime(os.path.join(CODE_DIR, fn))))
            except OSError: pass
    return tuple(out)


def _mtime(p):
    try: return os.path.getmtime(p)
    except OSError: return None


def broadcast(event, payload):
    with WATCH["lock"]:
        subs = list(WATCH["subs"])
    for q in subs:
        try: q.put_nowait((event, payload))
        except Exception: pass


def _watcher():
    WATCH["code_sig"] = _code_sig(); WATCH["data_sig"] = _mtime(DATA_FILE)
    while True:
        time.sleep(1.0)
        try:
            sig = _code_sig()
            if sig != WATCH["code_sig"]:
                changed = sorted({a for a, b in set(sig) ^ set(WATCH["code_sig"] or ())})
                WATCH["code_sig"] = sig
                broadcast("code", {"files": changed})
                print("[watch] code changed: %s" % ", ".join(changed), flush=True)
            dm = _mtime(DATA_FILE)
            if dm != WATCH["data_sig"]:
                WATCH["data_sig"] = dm
                broadcast("data", {"file": "api/identity.json", "mtime": dm})
        except Exception as e:
            print("[watch] %r" % (e,), flush=True)


S = {"state": "idle", "started": None, "finished": None, "wall_s": None, "rc": None, "tail": [], "runs": 0,
     "queued_scopes": [], "why": None, "last_ok": None, "scope": None, "sessions_pending": 0}
LOCK = threading.Lock()


def _run_once(why, scope):
    t0 = time.time()
    with LOCK:
        S.update(state="running", started=t0, finished=None, wall_s=None, rc=None, tail=[], why=why, scope=scope)
    rc, tail = 0, []
    for args in SCOPES[scope]:
        p = subprocess.run([sys.executable] + args, cwd=ROOT, capture_output=True, text=True,
                           encoding="utf-8", errors="replace")
        lines = [l for l in (p.stdout + p.stderr).splitlines() if l.strip()]
        tail += [os.path.basename(args[0]) + ": " + l for l in lines[-3:]]
        if p.returncode != 0:
            rc = p.returncode
            tail += ["FAILED rc=%d" % p.returncode] + lines[-12:]
            break
    t1 = time.time()
    with LOCK:
        S.update(state="idle", finished=t1, wall_s=round(t1 - t0, 2), rc=rc, tail=tail[-16:], runs=S["runs"] + 1,
                 last_ok=(t1 if rc == 0 else S["last_ok"]), sessions_pending=_sessions_pending())
    print("[rebuild:%s] %s rc=%d in %.1fs (%s)" % (scope, why, rc, t1 - t0, time.strftime("%H:%M:%S")), flush=True)
    if scope == "containers":
        WATCH["data_sig"] = _mtime(DATA_FILE)      # the watcher must not announce this run a second time
    broadcast("data", {"why": why, "scope": scope, "rc": rc, "wall_s": round(t1 - t0, 2)})


def _worker(why, scope):
    _run_once(why, scope)
    while True:
        with LOCK:
            if not S["queued_scopes"]:
                return
            nxt = S["queued_scopes"].pop(0)
        _run_once("queued after " + why, nxt)


# ---------------------------------------------------------------- service supervisor
# THE LAB IS THREE PROCESSES AND THE DASHBOARD COULD NEITHER SEE NOR TOUCH THEM
# (Jett 2026-09-08: "add buttons to start/stop/restart all project critical background processes").
# The controls live HERE because this is the process that is neither the daemon nor the page server:
# it can restart either without cutting the branch it sits on.
# The definitions mirror scripts/lab_up.ps1 exactly -- same interpreter, args, working directory and
# log files -- so a service started from the dashboard is indistinguishable from one the launcher
# started. There is deliberately no third way to start these.
SERVICES = {
    "daemon":    {"port": 8765, "args": ["scripts/telemetry/fh6_live_daemon.py"], "what": "telemetry daemon (UDP 9876 -> 8765)"},
    "dashboard": {"port": 8000, "args": ["scripts/serve_dashboard.py", "8000"],   "what": "dashboard server (serves this page)"},
    "rebuild":   {"port": 8001, "args": ["scripts/rebuild_service.py", "8001"],   "what": "import + regenerate service (this one)"},
}
SELF = "rebuild"


def _listening(port):
    """LISTENING only. A just-killed service leaves TIME_WAIT lines on its port for about a minute, and
    those must not read as "already up" -- the trap lab_up.ps1 records from 2026-09-05."""
    import socket
    sk = socket.socket()
    sk.settimeout(0.35)
    try:
        return sk.connect_ex(("127.0.0.1", port)) == 0
    finally:
        sk.close()


def _pid_on(port):
    try:
        out = subprocess.run(["netstat", "-ano", "-p", "TCP"], capture_output=True, text=True, timeout=8).stdout
    except Exception:                                          # noqa: BLE001
        return None
    for ln in out.splitlines():
        f = ln.split()
        if len(f) >= 5 and f[0] == "TCP" and f[1].endswith(":" + str(port)) and f[3] == "LISTENING":
            try:
                return int(f[4])
            except ValueError:
                return None
    return None


def _svc_state(name):
    d = SERVICES[name]
    up = _listening(d["port"])
    return {"name": name, "port": d["port"], "what": d["what"], "up": up,
            "pid": _pid_on(d["port"]) if up else None, "self": name == SELF}


def _svc_start(name):
    d = SERVICES[name]
    if _listening(d["port"]):
        return False, "already listening on " + str(d["port"])
    logs = os.path.join(ROOT, "data", "logs")
    os.makedirs(logs, exist_ok=True)
    out = open(os.path.join(logs, name + ".log"), "ab")
    err = open(os.path.join(logs, name + ".err"), "ab")
    flags = 0
    if os.name == "nt":            # detach: the child must outlive both this request and this process
        flags = subprocess.CREATE_NEW_PROCESS_GROUP | getattr(subprocess, "DETACHED_PROCESS", 0x00000008)
    subprocess.Popen([sys.executable] + d["args"], cwd=ROOT, stdout=out, stderr=err,
                     stdin=subprocess.DEVNULL, creationflags=flags, close_fds=True)
    for _ in range(50):                                        # lab_up waits 15 s for the bind; match it
        time.sleep(0.3)
        if _listening(d["port"]):
            return True, "up on " + str(d["port"])
    return False, "did not bind %d in 15 s -- see data/logs/%s.err" % (d["port"], name)


def _svc_stop(name):
    port = SERVICES[name]["port"]
    pid = _pid_on(port)
    if not pid:
        return False, "not running"
    try:
        if os.name == "nt":
            subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True, timeout=15)
        else:
            os.kill(pid, 15)
    except Exception as e:                                     # noqa: BLE001
        return False, "kill failed: " + str(e)
    for _ in range(40):                       # the PORT must free, not merely the process exit
        if not _listening(port):
            return True, "stopped (pid %d)" % pid
        time.sleep(0.25)
    return False, "pid %d killed but %d still listening" % (pid, port)


_RELAUNCH = (
    "import subprocess,sys,time,socket\n"
    "def lis():\n"
    "    s=socket.socket(); s.settimeout(0.3)\n"
    "    try: return s.connect_ex(('127.0.0.1',8001))==0\n"
    "    finally: s.close()\n"
    "t=time.time()\n"
    "while lis() and time.time()-t<20: time.sleep(0.3)\n"
    "o=open(LOG,'ab'); e=open(ERR,'ab')\n"
    "subprocess.Popen([sys.executable,'scripts/rebuild_service.py','8001'],cwd=ROOT,"
    "stdout=o,stderr=e,stdin=subprocess.DEVNULL,close_fds=True)\n")


def _svc_restart_self():
    """Restarting the supervisor cannot happen in-process: whoever kills it has to still be alive to start
    it again. Hand that to a detached child that waits for 8001 to free, relaunches, and exits."""
    logs = os.path.join(ROOT, "data", "logs")
    os.makedirs(logs, exist_ok=True)
    code = ("LOG=%r\nERR=%r\nROOT=%r\n" % (os.path.join(logs, "rebuild.log"),
                                            os.path.join(logs, "rebuild.err"), ROOT)) + _RELAUNCH
    flags = 0
    if os.name == "nt":
        flags = subprocess.CREATE_NEW_PROCESS_GROUP | getattr(subprocess, "DETACHED_PROCESS", 0x00000008)
    subprocess.Popen([sys.executable, "-c", code], cwd=ROOT, stdin=subprocess.DEVNULL,
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                     creationflags=flags, close_fds=True)
    threading.Thread(target=lambda: (time.sleep(0.6), os._exit(0)), daemon=True).start()
    return True, "relauncher spawned -- this service exits in ~0.6 s and returns on 8001"


def svc_action(name, action):
    if name not in SERVICES:
        return 404, {"error": "unknown service " + repr(name), "services": sorted(SERVICES)}
    if name == SELF and action == "stop":
        # Refused on purpose: these buttons are served BY this process, so stopping it removes the only
        # way to start anything again. scripts/lab_up.ps1 is the way back from a full stop.
        return 409, {"ok": False, "service": name, "action": action,
                     "note": "the rebuild service hosts these controls -- stopping it would leave nothing "
                             "to start them again. Use restart, or scripts/lab_up.ps1."}
    if name == SELF and action == "restart":
        ok, note = _svc_restart_self()
    elif action == "start":
        ok, note = _svc_start(name)
    elif action == "stop":
        ok, note = _svc_stop(name)
    elif action == "restart":
        _svc_stop(name)
        ok, note = _svc_start(name)
    else:
        return 400, {"error": "action must be start, stop or restart"}
    return 200, {"ok": ok, "note": note, "service": name, "action": action}


def request(why, scope=DEFAULT_SCOPE):
    with LOCK:
        if S["state"] == "running":
            if scope not in S["queued_scopes"]:
                S["queued_scopes"].append(scope)
            return "queued"
        S["state"] = "running"          # claim before the thread starts, so a second request in the same tick queues
    threading.Thread(target=_worker, args=(why, scope), daemon=True).start()
    return "started"


class H(BaseHTTPRequestHandler):
    def _send(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self._send(204, {})

    def do_GET(self):
        if self.path.startswith("/watch"):
            q = queue.Queue()
            with WATCH["lock"]: WATCH["subs"].append(q)
            try:
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.send_header("Cache-Control", "no-store")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(b"event: hello\ndata: {}\n\n"); self.wfile.flush()
                while True:
                    try:
                        ev, payload = q.get(timeout=15)
                        self.wfile.write(("event: %s\ndata: %s\n\n" % (ev, json.dumps(payload))).encode())
                    except queue.Empty:
                        self.wfile.write(b": keepalive\n\n")
                    self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
                pass
            finally:
                with WATCH["lock"]:
                    if q in WATCH["subs"]: WATCH["subs"].remove(q)
            return
        if self.path.startswith("/services"):
            return self._send(200, {"services": [_svc_state(n) for n in SERVICES]})
        if self.path.startswith("/status"):
            # sessions_pending is a live gauge, not a log entry -- recomputed on every poll (idle
            # only; a run in progress already knows it's behind) so the dashboard can show a
            # standing "N sessions not yet imported" chip instead of the gap being invisible
            # between runs the way it was before scope=telemetry existed.
            with LOCK:
                if S["state"] != "running":
                    S["sessions_pending"] = _sessions_pending()
                self._send(200, dict(S, now=time.time()))
        else:
            self._send(404, {"error": "GET /status, GET /services or POST /rebuild, POST /service"})

    def do_POST(self):
        if self.path.startswith("/service"):
            n = int(self.headers.get("Content-Length") or 0)
            try:
                body = json.loads(self.rfile.read(n) or b"{}")
            except Exception:                                  # noqa: BLE001
                body = {}
            code, out = svc_action(str(body.get("name", "")), str(body.get("action", "")))
            return self._send(code, out)
        if self.path.startswith("/rebuild"):
            n = int(self.headers.get("Content-Length") or 0)
            why, scope = "manual", DEFAULT_SCOPE
            if n:
                try:
                    b = json.loads(self.rfile.read(n) or b"{}") or {}
                    why = b.get("why") or why
                    scope = b.get("scope") if b.get("scope") in SCOPES else DEFAULT_SCOPE
                except Exception:
                    pass
            how = request(str(why)[:80], scope)
            with LOCK:
                self._send(202, dict(S, how=how, now=time.time()))
        else:
            self._send(404, {"error": "POST /rebuild"})

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from lab_root import require_lab_root
    require_lab_root(ROOT, "rebuild")
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8001
    S["sessions_pending"] = _sessions_pending()
    print("rebuild service on http://127.0.0.1:%d  root %s  (POST /rebuild · GET /status · GET /watch)" % (port, ROOT), flush=True)
    threading.Thread(target=_watcher, daemon=True).start()
    ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()
