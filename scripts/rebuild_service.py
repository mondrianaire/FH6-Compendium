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
    "telemetry": [["scripts/db/rebuild.py", "--only", "telemetry"], ["scripts/db/build_web.py"]],
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
            self._send(404, {"error": "GET /status or POST /rebuild"})

    def do_POST(self):
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
