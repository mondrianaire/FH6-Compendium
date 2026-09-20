#!/usr/bin/env python3
"""check_db_docs.py -- prove the database documentation still describes the database.

The binary formats have docs/formats/ + check_bt_template.py. This is the same
idea for the relational half: db/schema.sql, docs/handoff-data-structures.md and
docs/DATA-INVENTORY.md all describe data/fh6.db, and all three drift. On
2026-09-18 a re-measure found 56 stale row counts across the two docs, including
DATA-INVENTORY still calling corner_obs empty while it held 17,560 rows. Prose
does not fail loudly. This does.

What it checks:

  1. db/schema.sql EXECUTES. It is the canonical declaration, so it has to be
     runnable, not just readable -- the same standard a .bt is held to.
  2. The tables, views and indexes it declares are the ones the live DB has.
  3. Column SETS match per table; column ORDER differences are reported but not
     failed (ALTER TABLE appends, schema.sql declares inline -- benign, but you
     want to know before trusting SELECT *).
  4. Every table is documented in handoff-data-structures.md, with the right
     column list.
  5. Row counts quoted in the docs are still true (reported, not failed -- the
     DB is written continuously; --refresh rewrites them, --strict gates).
  6. Every NON-BINARY source in the SOURCE REGISTRY declares its category,
     disk location, read instructions and reader -- and the location resolves.
     The binary ones do the same inside docs/formats/*.bt, checked by
     scripts/tools/check_bt_template.py paths.
  7. Every value that EXISTS in a catalogued enum column is documented in the
     §3 value catalogue -- the only place that says what a coded value MEANS.
     The value SET is failed on; the counts beside it are only reported.
  8. Every committed data/*.json parses and declares a version or its
     provenance -- so a consumer knows which shape it reads, and a stale copy
     is distinguishable from a fresh one.
  9. The import pipeline (scripts/db/) and the gates (scripts/tools/) are all
     listed in DATA-INVENTORY §7, and every docs//scripts path it names exists.
 10. Two-way store reconciliation: every store tracked under data/ is
     documented here, which is the rule this inventory exists to enforce
     ("when a store is added, add it here in the same commit") and which
     nothing checked until now. It found three on its first run.

    python scripts/tools/check_db_docs.py            # everything
    python scripts/tools/check_db_docs.py schema     # just one section

Exit code 1 if any check fails. READ-ONLY: opens the live DB in read-only mode
and never writes to it.
"""
import glob
import io
import os
import re
import sqlite3
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
DB = os.path.join(ROOT, "data", "fh6.db")
SCHEMA = os.path.join(ROOT, "db", "schema.sql")
HANDOFF = os.path.join(ROOT, "docs", "handoff-data-structures.md")
INVENTORY = os.path.join(ROOT, "docs", "DATA-INVENTORY.md")


def live():
    """Read-only connection to the live database."""
    return sqlite3.connect("file:%s?mode=ro" % DB.replace("\\", "/"), uri=True)


def declared():
    """A fresh in-memory database built by executing db/schema.sql."""
    m = sqlite3.connect(":memory:")
    m.executescript(io.open(SCHEMA, encoding="utf-8").read())
    return m


def names(conn, kind):
    return {r[0] for r in conn.execute(
        "select name from sqlite_master where type=? and name not like 'sqlite_%'", (kind,))}


def cols(conn, t):
    return [r[1] for r in conn.execute('pragma table_info("%s")' % t)]


MIGRATIONS = io.open(os.path.join(ROOT, "scripts", "db", "fh6db.py"),
                     encoding="utf-8").read()


def check_schema():
    """schema.sql executes, and declares exactly what the live DB has."""
    fails = []
    try:
        m = declared()
    except Exception as e:
        return ["db/schema.sql does not execute: %s" % e]
    print("  db/schema.sql executes cleanly")
    lv = live()

    for kind in ("table", "view", "index"):
        a, b = names(m, kind), names(lv, kind)
        extra_live = sorted(b - a)
        missing_live = sorted(a - b)
        print("  %-6s declared=%-3d live=%-3d" % (kind, len(a), len(b)), end="")
        if missing_live or extra_live:
            print("  declared-but-absent=%s  live-but-undeclared=%s"
                  % (missing_live, extra_live))
        else:
            print("  match")
        # A declared object the live DB lacks is only a DEFECT when nothing will
        # ever create it. schema.sql runs on a FRESH database only, so an
        # addition also has to be registered in fh6db.py's migrate(). If it is,
        # the object is merely PENDING -- it appears on the next rebuild, and
        # flagging it would cry wolf at another agent's in-flight work. If it is
        # not, the object exists on fresh databases and silently nowhere else,
        # which is the failure fh6db.py's own comments warn about.
        for n in missing_live:
            # INDEXES are migrated generically: ensure_indexes() parses every CREATE INDEX out
            # of schema.sql and replays the missing ones, so no index NAME ever appears in
            # fh6db.py. Without this, every newly declared index would be misreported as
            # broken -- which is exactly what happened to ix_grip_envelope on 2026-09-19.
            if kind == "index" and "def ensure_indexes" in MIGRATIONS:
                print("      '%s' is pending: ensure_indexes() replays it from schema.sql" % n)
            elif n in MIGRATIONS:
                print("      '%s' is pending: registered in migrate(), applies on the next rebuild" % n)
            else:
                fails.append("%s '%s' is declared in schema.sql, MISSING from the live DB, and NOT "
                             "registered in migrate() -- it will never be created on an existing DB"
                             % (kind, n))
        for n in extra_live:
            fails.append("%s '%s' exists live but is not declared in schema.sql" % (kind, n))

    order_drift = []
    for t in sorted(names(m, "table") & names(lv, "table")):
        A, B = cols(m, t), cols(lv, t)
        only_dec = [c for c in A if c not in B]
        only_live = [c for c in B if c not in A]
        if only_dec or only_live:
            # A declared column gets the same PENDING/BROKEN split as a table or view: if it is
            # registered in V2_COLUMNS, migrate() will ALTER it in on the next rebuild. Without
            # this, every newly declared column failed the gate until a rebuild happened to run --
            # which is normal, not a defect. corner_segment.med_r_m hit it on 2026-09-19.
            pend = [c for c in only_dec if '"%s"' % c in MIGRATIONS or "'%s'" % c in MIGRATIONS]
            rest = [c for c in only_dec if c not in pend]
            if pend:
                print("      %s: %s pending -- registered in V2_COLUMNS, applies on the next rebuild"
                      % (t, ", ".join(pend)))
            if rest or only_live:
                fails.append("%s column mismatch: declared-only=%s live-only=%s" % (t, rest, only_live))
        elif A != B:
            order_drift.append(t)
    if order_drift:
        print("  column ORDER differs (same columns) on %d tables: %s"
              % (len(order_drift), ", ".join(order_drift)))
        print("    ^ expected: ALTER TABLE appends, schema.sql declares inline. "
              "Benign for named-column SQL; do not rely on SELECT * ordering.")
    else:
        print("  column order matches everywhere")
    return fails


def _doc_tables(path):
    """{table: [columns]} parsed from a markdown table whose last cell is a
    backticked column list."""
    out = {}
    for line in io.open(path, encoding="utf-8"):
        m = re.match(r"\s*\|\s*`([a-z_0-9]+)`\s*\|(.+)\|\s*$", line)
        if not m:
            continue
        cells = [c.strip() for c in m.group(2).split("|")]
        fields = re.findall(r"`([a-z_0-9]+)`", cells[-1]) if cells else []
        if fields:
            out[m.group(1)] = fields
    return out


def check_handoff():
    """Every table documented, with the right columns."""
    fails = []
    lv = live()
    tables = {t for t in names(lv, "table") if not t.startswith("sqlite_")}
    doc = _doc_tables(HANDOFF)
    text = io.open(HANDOFF, encoding="utf-8").read()

    undocumented = sorted(t for t in tables if "`%s`" % t not in text)
    print("  %d live tables; %d of them documented with a column list "
          "(+%d lists for views or other stores)"
          % (len(tables), len(set(doc) & tables), len(set(doc) - tables)))
    if undocumented:
        fails.append("tables absent from handoff-data-structures.md: %s" % undocumented)

    # VIEWS are the consumer contract -- build_web.py generates the dashboard bundle from them and
    # nothing re-derives -- but this check only ever looked at tables, so all 10 sat undocumented in
    # the handoff while DATA-INVENTORY listed 6 of them. Require them by name.
    views = names(lv, "view")
    missing_views = sorted(v for v in views if "`%s`" % v not in text)
    print("  %d views; %d documented" % (len(views), len(views) - len(missing_views)))
    if missing_views:
        fails.append("views absent from handoff-data-structures.md: %s" % missing_views)

    wrong = 0
    for t, fields in sorted(doc.items()):
        if t not in tables:
            continue
        real = cols(lv, t)
        missing = [c for c in real if c not in fields]
        bogus = [c for c in fields if c not in real]
        if missing or bogus:
            wrong += 1
            fails.append("%s: documented column list is stale -- undocumented=%s, "
                         "documented-but-gone=%s" % (t, missing, bogus))
    print("  %d documented column lists checked, %d stale" % (len(doc), wrong))
    return fails


def rebuild_in_flight(cx):
    """(running, note) -- is an import/rebuild mid-run right now?

    import_run gets its row when a stage STARTS and finished_utc when it ends, so
    an unfinished row is a stage in progress. This matters for --refresh: a
    rebuild stage does DELETE FROM x then re-INSERT, and a count taken inside
    that window is a TRANSIENT ZERO. Writing that into the docs would look like
    a measurement and be pure fiction -- observed 2026-09-18, when corner_segment
    read 0 mid-rebuild and settled at 67,755 seconds later.
    """
    try:
        row = cx.execute("SELECT run_id, kind, started_utc FROM import_run "
                         "WHERE finished_utc IS NULL ORDER BY run_id DESC LIMIT 1").fetchone()
    except sqlite3.Error:
        return False, ""
    if not row:
        return False, ""
    return True, "run %s (%s) started %s" % row


COUNT_RE = re.compile(r"(\s*\|\s*`?([a-z_0-9]+)`?\s*\|\s*)([\d,]+)(\s*\|)")


def check_counts(strict=False, refresh=False):
    """Row counts quoted in either doc.

    REPORTED, NOT FAILED, by default -- and that is a deliberate design choice.
    data/fh6.db is written continuously by the daemon and by other agents; the
    counts corrected on the morning of 2026-09-18 were already stale by that
    afternoon (session 474 -> 644, lap_point 511,998 -> 523,003). A gate that
    can only be green between two imports is a broken gate, and this project
    has withdrawn one of those before.

    So: a count drifting is NEWS, not a defect. --refresh rewrites them in
    place, which turns a treadmill into one command. --strict fails on drift,
    for the one moment it matters: just before publishing a doc as current.
    """
    fails = []
    lv = live()
    running, note = rebuild_in_flight(lv)
    if running:
        print("  REBUILD IN FLIGHT -- %s" % note)
        if refresh:
            print("  REFUSING to --refresh: a stage mid DELETE/INSERT reports transient zeros,")
            print("  and writing one into the docs would look like a measurement. Re-run after.")
            return fails
        print("  counts below may be mid-transaction; treat them as unsettled.")
    real = {t: lv.execute('select count(*) from "%s"' % t).fetchone()[0]
            for t in names(lv, "table")}
    grand = 0
    for path in (HANDOFF, INVENTORY):
        lines = io.open(path, encoding="utf-8").readlines()
        bad, out = [], []
        for n, line in enumerate(lines, 1):
            m = COUNT_RE.match(line)
            if m and m.group(2) in real:
                grand += 1
                got, want = int(m.group(3).replace(",", "")), real[m.group(2)]
                if got != want:
                    bad.append((n, m.group(2), got, want))
                    if refresh:
                        val = format(want, ",") if "," in m.group(3) else str(want)
                        line = m.group(1) + val + m.group(4) + line[m.end():]
            out.append(line)
        if refresh and bad:
            io.open(path, "w", encoding="utf-8", newline="").write("".join(out))
        print("  %-28s %d stale%s" % (os.path.basename(path), len(bad),
                                      " (REFRESHED)" if refresh and bad else ""))
        for n, t, got, want in bad[:10]:
            print("      line %d  %-18s doc=%s live=%s"
                  % (n, t, format(got, ","), format(want, ",")))
        if len(bad) > 10:
            print("      ... and %d more" % (len(bad) - 10))
        if bad and strict and not refresh:
            fails.append("%s has %d stale row counts" % (os.path.basename(path), len(bad)))
    print("  %d row counts checked" % grand)
    if not strict and not refresh:
        print("  (drift here is reported, not failed -- the DB is written live. "
              "Use --refresh to update, --strict to gate.)")
    return fails


def _registry():
    """Parse the SOURCE REGISTRY block out of DATA-INVENTORY.md into records."""
    text = io.open(INVENTORY, encoding="utf-8").read()
    recs, cur = [], None
    for line in text.splitlines():
        m = re.match(r"^SOURCE-([A-Z-]+):\s*(.*)$", line)
        if not m:
            continue
        key, val = m.group(1), m.group(2).strip()
        if key == "NAME":
            cur = {"NAME": val, "LOC": [], "OPT": [], "READ": [], "CATEGORY": "", "READER": ""}
            recs.append(cur)
        elif cur is None:
            continue
        elif key == "LOCATION":
            cur["LOC"].append(val)
        elif key == "LOCATION-OPTIONAL":
            cur["OPT"].append(val)
        elif key == "READ":
            cur["READ"].append(val)
        else:
            cur[key] = val
    return recs


def check_sources():
    """Every non-binary source declares its category/location/read, and resolves."""
    fails = []
    recs = _registry()
    if not recs:
        return ["DATA-INVENTORY.md has no SOURCE REGISTRY block"]
    for r in recs:
        if not r["CATEGORY"]:
            fails.append("%s declares no SOURCE-CATEGORY" % r["NAME"])
        if not r["LOC"] and not r["OPT"]:
            fails.append("%s declares no SOURCE-LOCATION" % r["NAME"])
        if not r.get("READER"):
            fails.append("%s declares no SOURCE-READER" % r["NAME"])

        shown = []
        for loc, required in [(l, True) for l in r["LOC"]] + [(l, False) for l in r["OPT"]]:
            if loc.startswith("("):
                shown.append((loc[:38], "no file"))
                continue
            probe = loc if (len(loc) > 1 and loc[1] == ":") else os.path.join(ROOT, loc)
            hits = glob.glob(probe.replace("\\", "/"), recursive=True)
            shown.append((loc, len(hits) if hits else ("MISSING" if required else "absent here")))
            if required and not hits:
                fails.append("%s: SOURCE-LOCATION does not resolve: %s" % (r["NAME"], loc))
        print("  %-32s %s" % (r["NAME"], r["CATEGORY"][:46]))
        for loc, n in shown:
            print("      %-58s %s" % (loc[:58], n))
    print("  %d sources registered" % len(recs))
    return fails


def check_stores():
    """Two-way: every tracked store is documented, every documented path exists.

    This is the rule DATA-INVENTORY.md exists to enforce -- "when a store is
    added, add it here in the same commit" -- which nothing checked until now.
    """
    import subprocess
    fails = []
    try:
        out = subprocess.run(["git", "ls-files", "data/"], cwd=ROOT,
                             capture_output=True, text=True, timeout=60).stdout
    except Exception as e:
        return ["could not list tracked files: %s" % e]
    tracked = [l for l in out.splitlines() if l]
    root_files = [p for p in tracked if p.count("/") == 1]
    doc = io.open(INVENTORY, encoding="utf-8").read()

    # 1. tracked -> documented (skip backup dumps: transient, not stores)
    undocumented = [p for p in root_files
                    if not os.path.basename(p).startswith("_")
                    and os.path.basename(p) not in doc]
    print("  %d tracked files at data/ root, %d undocumented" % (len(root_files), len(undocumented)))
    for p in undocumented:
        print("      %s" % p)
    if undocumented:
        fails.append("tracked stores missing from DATA-INVENTORY.md: %s"
                     % ", ".join(os.path.basename(p) for p in undocumented))

    # 2. tracked backup directories are not stores and should not be in git
    backups = sorted({p.split("/")[1] for p in tracked
                      if p.count("/") > 1 and p.split("/")[1].startswith("_backup")})
    if backups:
        print("  NOTE: %d _backup* director%s tracked in git (transient dumps, not stores): %s"
              % (len(backups), "y is" if len(backups) == 1 else "ies are", ", ".join(backups)))
    return fails


def check_values():
    """Every value that EXISTS in a catalogued enum column is documented.

    The §3 value catalogue is the only place that says what a coded value MEANS,
    and nothing checked it. Unlike row counts, an enum's value SET is stable and
    a new member is a real event: the docs become silently wrong about a column
    someone reads to interpret data. So the set is FAILED on, while the counts
    beside it are only reported -- same split as `counts`.

    Self-maintaining, like parsing CREATE INDEX out of schema.sql: the columns
    checked are whatever the §3 headings name as `table.column`. Document a new
    enum with a heading and it is covered; no second list to drift.

    Found on its first run: session_event.mode's two `lapped` variants (described
    in prose but never written as literal values, so unverifiable) and three
    ref_field_reliability.tier_name values missing entirely, which had hidden the
    fact that TWO vocabularies share that tier ladder.
    """
    fails = []
    text = io.open(HANDOFF, encoding="utf-8").read()
    try:
        sec = text[text.index("## 3. The value catalogue"):text.index("## 4.")]
    except ValueError:
        return ["handoff-data-structures.md has no '## 3. The value catalogue' section"]

    lv = live()
    tables = names(lv, "table")
    checked = drifted = 0
    for block in re.split(r"\n(?=### )", sec):
        head = block.split("\n", 1)[0]
        for t, c in re.findall(r"`([a-z_0-9]+)\.([a-z_0-9]+)`", head):
            if t not in tables:
                fails.append("value catalogue names `%s.%s` but there is no table %s" % (t, c, t))
                continue
            if c not in cols(lv, t):
                fails.append("value catalogue names `%s.%s` but %s has no column %s" % (t, c, t, c))
                continue
            rows = list(lv.execute('select "%s", count(*) from "%s" group by 1 order by 2 desc' % (c, t)))
            checked += 1
            missing = []
            for v, n in rows:
                tok = "NULL" if v is None else str(v)
                if ("`%s`" % tok) not in block:
                    missing.append((tok, n))
            if missing:
                fails.append("%s.%s has undocumented value(s): %s"
                             % (t, c, ", ".join("%r (%s rows)" % (m, format(n, ",")) for m, n in missing)))
            else:
                # counts beside the values drift like every other count -- report only
                for v, n in rows:
                    tok = "NULL" if v is None else str(v)
                    if re.search(r"`%s`[^|\n]*?\(\s*([\d,]+)\s*\)" % re.escape(tok), block):
                        m = re.search(r"`%s`[^|\n]*?\(\s*([\d,]+)\s*\)" % re.escape(tok), block)
                        if int(m.group(1).replace(",", "")) != n:
                            drifted += 1
            print("  %-38s %d distinct, all documented" % ("%s.%s" % (t, c), len(rows)))
    print("  %d enum columns checked" % checked)
    if drifted:
        print("  %d inline counts have drifted (reported, not failed -- the DB is written live)" % drifted)
    return fails


#: A committed JSON store must say what it IS. Either a version key -- so a consumer knows which
#: shape it is reading -- or provenance, for a store that is a capture rather than a format.
JSON_VERSION_KEYS = ("schema_version", "schema", "version")
JSON_PROVENANCE_KEYS = ("captured", "source", "sources", "generated", "note", "_note", "_summary")
#: field-catalog.json's top level is a LIST, so it can carry neither. It is the source for the three
#: ref_field* tables; if its shape ever changes, nothing in the file will say so. Recorded, not excused.
JSON_SHAPE_EXEMPT = {"field-catalog.json"}


def check_json():
    """Every committed JSON store parses, and declares a version or its provenance."""
    fails = []
    import json as _json
    files = sorted(glob.glob(os.path.join(ROOT, "data", "*.json")))
    if not files:
        print("  NOTE: no data/*.json here; skipped")
        return fails
    bad, versioned, prov, exempt = [], 0, [], []
    for f in files:
        name = os.path.basename(f)
        try:
            d = _json.load(io.open(f, encoding="utf-8"))
        except Exception as e:                                   # noqa: BLE001
            bad.append((name, str(e)[:60]))
            continue
        if name in JSON_SHAPE_EXEMPT or not isinstance(d, dict):
            exempt.append(name)
            continue
        keys = set(d)
        if keys & set(JSON_VERSION_KEYS):
            versioned += 1
        elif keys & set(JSON_PROVENANCE_KEYS):
            prov.append(name)
        else:
            fails.append("%s declares neither a version nor provenance -- a stale copy is "
                         "indistinguishable from a fresh one" % name)
    print("  %d stores: %d versioned, %d carry provenance instead, %d cannot declare either"
          % (len(files), versioned, len(prov), len(exempt)))
    if prov:
        print("      provenance-only: %s" % ", ".join(sorted(prov)))
    if exempt:
        print("      shape-exempt (top level is a list): %s" % ", ".join(sorted(exempt)))
    for name, err in bad:
        fails.append("%s does not parse: %s" % (name, err))
    return fails


def check_scripts():
    """The pipeline and the gates are listed in DATA-INVENTORY §7, and every path it names exists.

    Enforced only where an omission actually hurts: scripts/db/ (the import cascade) and
    scripts/tools/ (the gates). A stage nobody knows about is how import_corners.py came to own the
    grip envelope while appearing in no inventory at all. One-off probes and migrations under
    scripts/analysis/ and scripts/sim/ are deliberately NOT enumerated -- see the section.

    Also checks every docs/ and scripts/ path named anywhere in the file resolves, because a doc that
    points at a file that moved is worse than one that says nothing.
    """
    fails = []
    text = io.open(INVENTORY, encoding="utf-8").read()
    for label, pattern in (("scripts/db", os.path.join(ROOT, "scripts", "db", "*.py")),
                           ("scripts/tools", os.path.join(ROOT, "scripts", "tools", "*.py"))):
        on_disk = sorted(os.path.basename(p) for p in glob.glob(pattern))
        missing = [n for n in on_disk if "`%s/%s`" % (label, n) not in text]
        print("  %-14s %d on disk, %d listed" % (label, len(on_disk), len(on_disk) - len(missing)))
        if missing:
            fails.append("%s not listed in DATA-INVENTORY §7: %s" % (label, ", ".join(missing)))

    # every path the inventory names must resolve
    named = set(re.findall(r"`((?:docs|scripts)/[A-Za-z0-9_./-]+\.(?:md|py))`", text))
    gone = sorted(p for p in named if not os.path.exists(os.path.join(ROOT, p)))
    print("  %d docs/scripts paths named; %d do not resolve" % (len(named), len(gone)))
    if gone:
        fails.append("DATA-INVENTORY names paths that do not exist: %s" % ", ".join(gone))
    return fails


CHECKS = {"schema": check_schema, "handoff": check_handoff, "counts": check_counts,
          "values": check_values, "json": check_json, "scripts": check_scripts,
          "sources": check_sources, "stores": check_stores}

if __name__ == "__main__":
    argv = sys.argv[1:]
    refresh = "--refresh" in argv
    strict = "--strict" in argv
    want = [a for a in argv if not a.startswith("-")] or list(CHECKS)
    bad = 0
    for name in want:
        if name not in CHECKS:
            raise SystemExit("unknown check %r; known: %s" % (name, ", ".join(CHECKS)))
        print("== %s" % name)
        fails = (CHECKS[name](strict=strict, refresh=refresh)
                 if name == "counts" else CHECKS[name]())
        for f in fails:
            print("  FAIL %s" % f)
        bad += len(fails)
        print("  %s" % ("OK" if not fails else "%d FAILURE(S)" % len(fails)))
    sys.exit(1 if bad else 0)
