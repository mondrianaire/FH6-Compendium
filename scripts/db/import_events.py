#!/usr/bin/env python3
"""import_events.py -- the Rivals catalogue as displayed: names, lengths, guids -> ref_event.

Source: data/rivals-routes-<discipline>.json, one file per discipline, each the Rivals > Routes
screen transcribed end to end -- verbatim event name, the screen's one-decimal "Route Length" in
miles, and the seven IDS_Name guids the name sits under (RivalsEventData is one-to-many: a route
name repeats under one guid per event variant, and its description likewise under seven disjoint
IDS_Description guids -- see the file's own "note").

Every guid is a checked join, re-proven on every run, not a copy: a guid absent from ref_string,
or present with content that disagrees with the name we read off the screen, fails the whole
stage rather than importing a name nobody can trust. Two routes sharing a name in one file fails
the same way -- event_id is derived FROM the name, so a collision there is silent data loss
waiting to happen.

Length is the only topology the screen gives: is_loop follows the name's own suffix (' Circuit'
/ ' Sprint' / the two lap-around specials), never a guess from the route id, because the route id
does not exist here at all (route_id/class_limit/pi_limit stay NULL until an event dataset
decodes them).

Run:  python scripts/db/import_events.py [--db PATH] [-v]
"""
import argparse
import glob
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)

import fh6db                                            # noqa: E402

DATA = os.path.join(ROOT, "data")
MI = 1609.344                          # miles -> metres
FILE_RE = re.compile(r"^rivals-routes-(.+)\.json$")


def slug(s):
    """lowercase, runs of non-alphanumerics -> '-', stripped -- the one slug rule for both
    event_id and the file-derived discipline tag."""
    return re.sub(r"[^0-9a-z]+", "-", s.lower()).strip("-")


def is_loop_of(name):
    """The only topology the Routes screen gives: its own name suffix."""
    if name.endswith(" Circuit") or name in ("The Colossus", "The Goliath"):
        return 1
    if name.endswith(" Sprint"):
        return 0
    return None


def jload(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def gather(cx, path, disciplines, verbose=False):
    basename = os.path.basename(path)
    m = FILE_RE.match(basename)
    disc = slug(m.group(1) if m else os.path.splitext(basename)[0])
    doc = jload(path)
    routes = doc.get("routes") or []

    erows, esrows = [], []
    seen_names = {}
    for r in routes:
        name = r["name"]
        order = r["order"]
        if name in seen_names:
            raise ValueError("%s: '%s' names both route #%d and #%d" %
                              (basename, name, seen_names[name], order))
        seen_names[name] = order

        event_id = "rivals:" + slug(name)
        length_mi = r["length_mi"]
        description = r.get("description")
        data = json.dumps({"order": order, "length_mi": length_mi,
                            "description": description, "frames": r.get("frames")})
        erows.append((event_id, "rivals", name, None, None, None, None, None, data,
                      disc, length_mi * MI, is_loop_of(name), "data/%s#%d" % (basename, order)))

        for g in r["ids_name_guids"]:
            key_name = "IDS_Name_" + g
            row = cx.execute(
                "SELECT key_hash, content FROM ref_string WHERE table_name='RivalsEventData' AND key_name=?",
                (key_name,)).fetchone()
            if row is None:
                raise ValueError("%s #%d '%s': guid %s is not in ref_string(RivalsEventData)" %
                                  (basename, order, name, g))
            if row["content"] != name:
                raise ValueError("%s #%d: guid %s says '%s', screen says '%s'" %
                                  (basename, order, g, row["content"], name))
            esrows.append((event_id, "RivalsEventData", row["key_hash"], key_name, "name"))

        if description:
            for kh, kn in cx.execute(
                    "SELECT key_hash, key_name FROM ref_string"
                    " WHERE table_name='RivalsEventData' AND content=?", (description,)):
                esrows.append((event_id, "RivalsEventData", kh, kn, "description"))

    disciplines[disc] = disciplines.get(disc, 0) + len(routes)
    if verbose:
        print("  %s: %d routes, discipline=%s" % (basename, len(routes), disc))
    return erows, esrows


def run(cx, verbose=False):
    erows, esrows = [], []
    disciplines = {}
    for path in sorted(glob.glob(os.path.join(DATA, "rivals-routes-*.json"))):
        er, es = gather(cx, path, disciplines, verbose)
        erows += er
        esrows += es

    with cx:
        cx.execute("BEGIN")                  # a PRAGMA outside a transaction autocommits and resets itself
        cx.execute("PRAGMA defer_foreign_keys=ON")
        # ref_event is a foreign-key PARENT (course_event and ref_event_string cascade off it), so it
        # is MERGED, not wiped: a wipe-and-reinsert -- and INSERT OR REPLACE, which deletes first --
        # would empty course_event on every rerun. Only events that vanished from the catalogue are
        # deleted, after their non-cascading links (course.event_id, ref_route.*) are nulled.
        new_ids = {r[0] for r in erows}
        cx.execute("CREATE TEMP TABLE IF NOT EXISTS _keep_ev(event_id TEXT PRIMARY KEY)")
        cx.execute("DELETE FROM _keep_ev")
        cx.executemany("INSERT INTO _keep_ev(event_id) VALUES(?)", [(e,) for e in new_ids])
        retired = "SELECT event_id FROM ref_event WHERE kind='rivals' AND event_id NOT IN (SELECT event_id FROM _keep_ev)"
        cx.execute("UPDATE course SET event_id=NULL WHERE event_id IN (%s)" % retired)
        cx.execute("UPDATE ref_route SET name=NULL, event_id=NULL, name_source=NULL, name_confidence=NULL"
                   " WHERE event_id IN (%s)" % retired)
        cx.execute("DELETE FROM ref_event WHERE event_id IN (%s)" % retired)   # course_event/ref_event_string cascade
        n_ev = fh6db.merge_many(cx, "ref_event", [
            "event_id", "kind", "name", "track_id", "route_id", "class_limit", "pi_limit",
            "region", "data", "discipline", "length_m", "is_loop", "source"], erows, key=("event_id",))
        # ref_event_string is a leaf: refresh it per event
        cx.execute("DELETE FROM ref_event_string WHERE event_id IN (SELECT event_id FROM _keep_ev)")
        n_es = fh6db.upsert_many(cx, "ref_event_string", [
            "event_id", "table_name", "key_hash", "key_name", "role"], esrows)

    return {"ref_event": n_ev, "ref_event_string": n_es}, disciplines


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--db", default=None)
    ap.add_argument("-v", "--verbose", action="store_true")
    a = ap.parse_args(argv)
    cx = fh6db.connect(a.db)
    fh6db.migrate(cx)                  # so a standalone run works on an un-migrated DB
    rid = fh6db.run_begin(cx, "events", DATA)
    try:
        counts, disciplines = run(cx, a.verbose)
    except Exception as e:                               # noqa: BLE001
        cx.rollback()
        fh6db.run_end(cx, rid, 0, 0, "%s: %s" % (type(e).__name__, e))
        raise
    notes = {"events": counts["ref_event"], "strings": counts["ref_event_string"],
             "disciplines": disciplines}
    fh6db.run_end(cx, rid, sum(counts.values()), 1, json.dumps(notes))
    for k in sorted(counts):
        print("  %-18s %8d" % (k, counts[k]))
    for d in sorted(disciplines):
        print("  discipline %-12s %8d" % (d, disciplines[d]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
