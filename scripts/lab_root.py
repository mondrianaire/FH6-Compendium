"""Which checkout is this process serving -- and is it allowed to?

The lab's data stores (captures, course models, pi-observations, fh6.db) live in ONE worktree.
The main checkout (master) is a code mirror with stale stores. On 2026-09-05 a second Claude
session launched the daemon and a dashboard from master after a reboot; every frame of telemetry
for the next half hour landed in master's data/ and the two stores diverged further. Nothing
stopped it, because nothing checked.

A checkout that HOSTS lab worktrees (<root>/.claude/worktrees/*/scripts/telemetry/fh6_live_daemon.py
exists) is the main checkout, and the lab is one of those worktrees -- so a process started from
such a root is starting in the wrong place. It refuses, names the worktree(s), and exits 2.
FH6_ALLOW_MAIN=1 overrides for deliberate one-off work against master.
"""
import glob
import os
import subprocess
import sys

DAEMON_REL = os.path.join("scripts", "telemetry", "fh6_live_daemon.py")


def branch_of(root):
    try:
        out = subprocess.run(["git", "-C", root, "rev-parse", "--abbrev-ref", "HEAD"],
                             capture_output=True, text=True, timeout=5)
        return out.stdout.strip() or None
    except Exception:
        return None


def hosted_labs(root):
    """Lab worktrees hosted UNDER this root -- non-empty only for the main checkout."""
    return sorted(os.path.dirname(os.path.dirname(os.path.dirname(p)))
                  for p in glob.glob(os.path.join(root, ".claude", "worktrees", "*", DAEMON_REL)))


def check(root):
    """(ok, info). ok=False means: this root hosts lab worktrees, so it is master, not the lab."""
    root = os.path.abspath(root)
    labs = hosted_labs(root)
    info = {"root": root, "branch": branch_of(root), "hosted_labs": labs}
    return (not labs), info


def require_lab_root(root, what):
    """Call at startup. Returns the info dict; exits 2 when started from the main checkout."""
    ok, info = check(root)
    if ok or os.environ.get("FH6_ALLOW_MAIN") == "1":
        print(f"[{what}] root {info['root']}  branch {info['branch'] or '?'}", flush=True)
        return info
    print(f"[{what}] REFUSING TO START from {info['root']} (branch {info['branch'] or '?'}): this checkout "
          f"HOSTS the lab worktree(s) below, so its data/ is the stale mirror, not the lab.", file=sys.stderr)
    for lab in info["hosted_labs"]:
        print(f"[{what}]   run from: {lab}", file=sys.stderr)
    print(f"[{what}] set FH6_ALLOW_MAIN=1 to override deliberately.", file=sys.stderr, flush=True)
    sys.exit(2)
