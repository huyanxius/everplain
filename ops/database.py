"""Consistent SQLite backup and restore; existing targets are never overwritten."""

import argparse
import hashlib
import json
import os
import sqlite3
import tempfile
from contextlib import closing
from pathlib import Path


def open_readonly(path):
    if not path.is_file():
        raise ValueError("Source database does not exist")
    return sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True, timeout=30)


def inspect_database(path):
    with closing(open_readonly(path)) as database:
        if database.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
            raise ValueError("Database integrity check failed")
        if database.execute("PRAGMA foreign_key_check").fetchone() is not None:
            raise ValueError("Database foreign key check failed")
        tables = {
            row[0]
            for row in database.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            )
        }
        if not {"users", "alembic_version"} <= tables:
            raise ValueError("Source is not an application database")
        revision = [
            row[0]
            for row in database.execute("SELECT version_num FROM alembic_version")
        ]
        users = database.execute("SELECT count(*) FROM users").fetchone()[0]
    with path.open("rb") as handle:
        digest = hashlib.file_digest(handle, "sha256").hexdigest()
    return {"schema_revisions": revision, "user_count": users, "sha256": digest}


def copy_database(source, target):
    source, target = source.resolve(), target.resolve()
    if source == target or target.exists():
        raise ValueError("Destination already exists; restore to a new path")
    target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    with closing(open_readonly(source)) as database:
        descriptor, temporary = tempfile.mkstemp(
            prefix=".everplain-backup-", dir=target.parent
        )
        os.close(descriptor)
        temporary = Path(temporary)
        try:
            with closing(sqlite3.connect(temporary)) as snapshot:
                database.backup(snapshot, pages=256, sleep=0.05)
                snapshot.execute("PRAGMA journal_mode=DELETE")
            report = inspect_database(temporary)
            os.chmod(temporary, 0o600)
            with temporary.open("rb") as handle:
                os.fsync(handle.fileno())
            # A hard link publishes atomically without replacing a concurrent destination.
            os.link(temporary, target)
            directory_fd = os.open(target.parent, os.O_RDONLY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
        finally:
            temporary.unlink(missing_ok=True)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("backup", "restore"):
        command = commands.add_parser(name)
        command.add_argument("source", type=Path)
        command.add_argument("destination", type=Path)
    command = commands.add_parser("verify")
    command.add_argument("source", type=Path)
    args = parser.parse_args()
    try:
        report = (
            inspect_database(args.source)
            if args.command == "verify"
            else copy_database(args.source, args.destination)
        )
    except (OSError, sqlite3.Error, ValueError) as error:
        # No SQL rows, source content or exception values are printed.
        print(
            json.dumps(
                {
                    "status": "failed",
                    "operation": args.command,
                    "error": type(error).__name__,
                }
            )
        )
        return 1
    print(json.dumps({"status": "verified", "operation": args.command, **report}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
