#!/usr/bin/env python3
"""SPOT CHECK — is anything about this tune obviously wrong? One screen, one second.

    python scripts/telemetry/spot_check.py            # the car you are driving right now
    python scripts/telemetry/spot_check.py 2866       # a specific ordinal
    python scripts/telemetry/spot_check.py --all      # every car with a saved tune

The dashboard's 🩺 drawer already checks the subtle things — rebound below bump, diff lock, ARB spread,
measured grip ratios. This is the blunt pass in front of it: the values that are wrong at a glance, so a
bad decode or a wrecked tune is caught before anyone reasons about it.

The check it adds that the drawer does not have is RAIL-PEGGING. A slider sitting exactly on its minimum or
maximum is suspicious on its own and damning in bulk: ordinal 4167 decoded with front_arb at 65 (max), rear_arb
at 1 (min), every damper at 20 (max), springs and ride height at norm 1.0 — 17 of 30 fields on a rail. That is
not a tune, it is a signature of a tune that was never really set, or of a decode reading the wrong save.
Nothing flagged it, because every individual value was inside its legal range.
"""
import io, json, os, sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
import fh6_tune_decode as T   # noqa: E402

RED, AMB, GRN, DIM, OFF = "\033[31m", "\033[33m", "\033[32m", "\033[90m", "\033[0m"
# Ranges a sane road/race tune lives in. Outside these is not always wrong, but it is always worth a look.
SANE = {
    "front_tire_pressure": (20.0, 38.0, "psi"), "rear_tire_pressure": (20.0, 38.0, "psi"),
    "front_camber": (-4.5, 0.0, "deg"), "rear_camber": (-4.0, 0.0, "deg"),
    "front_toe": (-0.5, 0.5, "deg"), "rear_toe": (-0.5, 0.5, "deg"),
    "brake_balance": (40.0, 60.0, "% front"), "brake_pressure": (80.0, 130.0, "%"),
}


def check(ordn, name=None):
    metas, _ = T.tunes_for_ordinal(ordn)
    if not metas:
        return None
    m = max(metas, key=lambda q: str(q.get("ts") or ""))
    t = T.parse_tune(m["path"], ordinal_hint=ordn)
    sl = t.get("sliders") or {}
    rails, wild, unread = [], [], []
    for k, v in sl.items():
        if not v.get("adjustable"):
            continue
        n = v.get("norm")
        val, rng = v.get("value"), v.get("range")
        if val is None:
            unread.append(k); continue
        if n is not None and (n <= 0.0005 or n >= 0.9995):
            rails.append((k, val, "min" if n <= 0.5 else "max"))
        lo, hi, unit = SANE.get(k, (None, None, ""))
        if lo is not None and not (lo <= val <= hi):
            wild.append((k, val, unit, lo, hi))
    n_adj = sum(1 for v in sl.values() if v.get("adjustable"))
    return {"ts": m["ts"], "locked": t["locked"], "gears": t.get("gear_count"), "name": name,
            "n_adj": n_adj, "rails": rails, "wild": wild, "unread": unread,
            "hash": T.tune_hash(m["path"])}


def verdict(r):
    """One word, chosen by the worst thing found — the whole point is not having to read the detail.

    Calibrated by sweeping all 162 saved tunes: a first cut that warned on ANY rail or ANY undecoded field
    returned 0 clean out of 162, which is a check that says nothing. Two corrections:

      * an undecoded per-car field (springs, ride height, downforce) is a KNOWN gap in calibration, not a fault
        in the tune — it never moves the verdict, it is just noted
      * a value on its rail is weak evidence on its own. Maximum downforce is an ordinary choice, not a
        symptom. Rails only speak in BULK, where they stop describing a tune and start describing one that was
        never really set.

    An out-of-range VALUE is the strong signal, so it dominates: two of them is already SUSPECT.
    """
    frac = len(r["rails"]) / max(1, r["n_adj"])
    if len(r["wild"]) >= 2 or frac >= 0.55:
        return "error", RED, "SUSPECT"
    if r["wild"] or frac >= 0.33:
        return "warn", AMB, "CHECK"
    return "ok", GRN, "CLEAN"


def report(ordn, name=None, brief=False):
    r = check(ordn, name)
    if not r:
        print("%s%d — no saved tune on disk%s" % (DIM, ordn, OFF)); return "none"
    lvl, col, word = verdict(r)
    head = "%s%-7s%s %-42s save %s%s  %d/%d on a rail" % (
        col, word, OFF, (name or "")[:42], r["ts"], "  LOCKED" if r["locked"] else "",
        len(r["rails"]), r["n_adj"])
    print(head)
    if brief:
        return lvl
    for k, val, unit, lo, hi in r["wild"]:
        print("   %s! %-22s %-8s outside a sane %s-%s %s%s" % (RED, k, val, lo, hi, unit, OFF))
    if r["rails"]:
        shown = ", ".join("%s=%s(%s)" % (k, v, s) for k, v, s in r["rails"][:6])
        more = "" if len(r["rails"]) <= 6 else " +%d more" % (len(r["rails"]) - 6)
        print("   %s· pegged: %s%s%s" % (AMB, shown, more, OFF))
    if r["unread"]:
        print("   %s· not decoded (needs calibration): %s%s" % (DIM, ", ".join(r["unread"][:6]), OFF))
    if lvl == "ok" and not r["rails"] and not r["wild"]:
        print("   %s· nothing pegged, nothing outside a sane range%s" % (DIM, OFF))
    elif lvl == "ok":
        print("   %s· rails only, and few enough to be deliberate — no value is outside a sane range%s" % (DIM, OFF))
    return lvl


def live_ordinal():
    try:
        import urllib.request
        d = json.load(urllib.request.urlopen("http://127.0.0.1:8765/health", timeout=4))
        for c in (d.get("cars") or []):
            return int(str(c).split("|")[0])
    except Exception:
        pass
    return None


def main():
    args = [a for a in sys.argv[1:]]
    names = {}
    try:
        import urllib.request
        names = {c["ordinal"]: c.get("name") for c in
                 json.load(urllib.request.urlopen("http://127.0.0.1:8765/disk-tunes", timeout=20)).get("cars", [])}
    except Exception:
        pass
    if "--all" in args:
        tally = {}
        for o in sorted(names):
            lvl = report(o, names.get(o), brief=True)
            tally[lvl] = tally.get(lvl, 0) + 1
        print("\n%s%d suspect%s · %s%d to check%s · %s%d clean%s · %d with no saved tune" % (
            RED, tally.get("error", 0), OFF, AMB, tally.get("warn", 0), OFF,
            GRN, tally.get("ok", 0), OFF, tally.get("none", 0)))
        return
    if args and args[0].isdigit():
        report(int(args[0]), names.get(int(args[0]))); return
    o = live_ordinal()
    if o is None:
        print("no car on the live stream — pass an ordinal, or use --all")
        return
    report(o, names.get(o))


if __name__ == "__main__":
    main()
