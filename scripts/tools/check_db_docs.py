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
     column list. ("Never forget a store.")
  5. Row counts quoted in the docs are still true.

    python scripts/tools/check_db_docs.py            # everything
    python scripts/tools/check_db_docs.py schema     # just one section

Exit code 1 if any check fails. READ-ONLY: opens the live DB in read-only mode
and never writes to it.
"""
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
        # A declared index the live DB lacks is a real defect: queries that the
        # schema promises are cheap are doing full scans.
        for n in missing_live:
            fails.append("%s '%s' is declared in schema.sql but MISSING from the live DB" % (kind, n))
        for n in extra_live:
            fails.append("%s '%s' exists live but is not declared in schema.sql" % (kind, n))

    order_drift = []
    for t in sorted(names(m, "table") & names(lv, "table")):
        A, B = cols(m, t), cols(lv, t)
        only_dec = [c for c in A if c not in B]
        only_live = [c for c in B if c not in A]
        if only_dec or only_live:
            fails.append("%s column mismatch: declared-only=%s live-only=%s"
                         % (t, only_dec, only_live))
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


CHECKS = {"schema": check_schema, "handoff": check_handoff, "counts": check_counts}

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
