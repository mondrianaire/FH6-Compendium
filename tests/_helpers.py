"""Shared test plumbing: path setup, a fresh temp database per test, small insert helpers.

Not a test module itself (no test_ prefix) -- unittest discover will not collect it.
"""
import json
import os
import sqlite3
import sys
import tempfile
import uuid

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DB_DIR = os.path.join(ROOT, "scripts", "db")
TEL_DIR = os.path.join(ROOT, "scripts", "telemetry")
for p in (DB_DIR, TEL_DIR):
    if p not in sys.path:
        sys.path.insert(0, p)

import fh6db  # noqa: E402

SCHEMA_PATH = os.path.join(ROOT, "db", "schema.sql")


def new_db():
    """A fresh sqlite file under the OS temp dir, schema loaded via fh6db.ensure_schema.

    Returns (cx, path). Caller must call close_db(cx, path) when done.
    """
    path = os.path.join(tempfile.gettempdir(), "fh6_test_%s.db" % uuid.uuid4().hex)
    for suffix in ("", "-wal", "-shm"):
        if os.path.exists(path + suffix):
            os.remove(path + suffix)
    cx = fh6db.connect(path)
    fh6db.ensure_schema(cx, SCHEMA_PATH)
    return cx, path


def close_db(cx, path):
    try:
        cx.close()
    except Exception:                                      # noqa: BLE001
        pass
    for suffix in ("", "-wal", "-shm"):
        try:
            if os.path.exists(path + suffix):
                os.remove(path + suffix)
        except OSError:
            pass


def insert(cx, table, cols, row):
    cx.execute(
        "INSERT INTO %s (%s) VALUES (%s)" % (table, ",".join(cols), ",".join("?" * len(cols))),
        row,
    )


def dump(cx, sql, *args):
    """Rows of a SELECT as plain tuples, for before/after equality checks."""
    return [tuple(r) for r in cx.execute(sql, args)]


def jwrite(path, obj):
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(obj, fh)
