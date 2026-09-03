#!/usr/bin/env python3
"""The import-and-regenerate service: one local HTTP endpoint the dashboard can call.

    python scripts/rebuild_service.py 8001          # from the repo root (the WORKTREE), like the daemon

Why a separate process. The dashboard server (scripts/serve_dashboard.py, port 8000) and the live daemon
(port 8765) must not be restarted casually — the daemon holds the session, the server serves the current
tags — so the one thing that has to be able to run Python on the user's behalf lives here, on its own port.

What it does. POST /rebuild runs, in a worker thread and in this order:
    python scripts/db/rebuild.py --only containers      (the save containers -> parts, sliders, gears, packages)
    python scripts/db/build_web.py                       (the dashboard's api/*.json)
Measured 2026-09-03 on 578 containers: 7.8 s + 1.75 s. Light enough to run automatically — on a NEW SAVE,
which is when the database falls behind, not on every menu return (menus open many times a minute; saves
do not). A request that arrives while a run is in progress is coalesced: the run is repeated once when it
finishes, so a burst of saves costs two runs, never a queue.

GET /status reports {state, started, finished, wall_s, rc, tail, runs, queued}. Everything binds to
127.0.0.1 only; CORS is open because the caller is the dashboard on another local port.
"""
import json, os, subprocess, sys, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
STEPS = [
    ["scripts/db/rebuild.py", "--only", "containers"],
    ["scripts/db/build_web.py"],
]

S = {"state": "idle", "started": None, "finished": None, "wall_s": None, "rc": None, "tail": [], "runs": 0,
     "queued": False, "why": None, "last_ok": None}
LOCK = threading.Lock()


def _run_once(why):
    t0 = time.time()
    with LOCK:
        S.update(state="running", started=t0, finished=None, wall_s=None, rc=None, tail=[], why=why)
    rc, tail = 0, []
    for args in STEPS:
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
                 last_ok=(t1 if rc == 0 else S["last_ok"]))
    print("[rebuild] %s rc=%d in %.1fs (%s)" % (why, rc, t1 - t0, time.strftime("%H:%M:%S")), flush=True)


def _worker(why):
    _run_once(why)
    while True:
        with LOCK:
            if not S["queued"]:
                return
            S["queued"] = False
        _run_once("queued after " + why)


def request(why):
    with LOCK:
        if S["state"] == "running":
            S["queued"] = True
            return "queued"
        S["state"] = "running"          # claim before the thread starts, so a second request in the same tick queues
    threading.Thread(target=_worker, args=(why,), daemon=True).start()
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
        if self.path.startswith("/status"):
            with LOCK:
                self._send(200, dict(S, now=time.time()))
        else:
            self._send(404, {"error": "GET /status or POST /rebuild"})

    def do_POST(self):
        if self.path.startswith("/rebuild"):
            n = int(self.headers.get("Content-Length") or 0)
            why = "manual"
            if n:
                try:
                    why = (json.loads(self.rfile.read(n) or b"{}") or {}).get("why") or why
                except Exception:
                    pass
            how = request(str(why)[:80])
            with LOCK:
                self._send(202, dict(S, how=how, now=time.time()))
        else:
            self._send(404, {"error": "POST /rebuild"})

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8001
    print("rebuild service on http://127.0.0.1:%d  root %s" % (port, ROOT), flush=True)
    ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()
