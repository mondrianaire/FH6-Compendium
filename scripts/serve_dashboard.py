#!/usr/bin/env python3
"""Serve the dashboard with cache headers that actually work.

    python scripts/serve_dashboard.py 8000        # from the repo root

WHY THIS EXISTS. `python -m http.server` sends Last-Modified and NOTHING else — no Cache-Control, no Expires.
With no cache directive a browser is free to apply HEURISTIC FRESHNESS (commonly 10% of the document's age) and
serve index.html from cache WITHOUT revalidating. Every asset is cache-busted with ?v=<tag>, but the tag lives
inside index.html — so if the document itself is served from cache the browser never learns the new tag and
happily reuses the old db.js too. The cache-buster is worthless when the file carrying it is cached.

That is not a theoretical failure. It cost this project repeatedly: course models were merged and rebuilt, the
server was verified to be serving 21 correct courses on both ports, and the owner still saw six deleted courses
on screen — because his browser had never re-fetched the document that would have told it to look again.

THE RULE, and it is the standard one:
  * HTML  -> `no-cache`. Not "do not store": revalidate every time. The document is tiny and it is the only thing
             that knows which asset versions are current, so it must never be stale.
  * ?v=   -> `immutable`, one year. A versioned URL's content cannot change by definition, so the browser should
             never ask about it again. This is what makes the busting cheap.
  * else  -> `no-cache` as well, since anything unversioned here is data the lab rewrites.
"""
import os, sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "dashboard"))


class H(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def end_headers(self):
        p = (self.path or "").split("?")[0]
        if "?v=" in (self.path or "") or "&v=" in (self.path or ""):
            self.send_header("Cache-Control", "public, max-age=31536000, immutable")
        elif p.endswith((".html", "/")) or p == "":
            self.send_header("Cache-Control", "no-cache, must-revalidate")
        else:
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from lab_root import require_lab_root
    require_lab_root(os.path.dirname(ROOT), "dashboard")
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    print("dashboard on http://127.0.0.1:%d  (html revalidates, ?v= assets immutable)" % port, flush=True)
    ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()
