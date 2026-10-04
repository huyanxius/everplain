"""Private transfer-state helper. Its output is captured, never published as job logs."""

import fcntl
import hashlib
import json
import os
import re
import shutil
import stat
import sys
from pathlib import Path

EXPECTED = None  # Validated current-run checksum, supplied at the CLI boundary.
LOCK = Path("/run/lock/everplain-release.lock")


def idle(lock=LOCK):
    if not lock.exists():
        return
    if lock.is_symlink():
        raise RuntimeError("release lock unavailable")
    with lock.open("rb") as stream:
        fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)


def checksum(path):
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def eligible(directory, uid, parent=Path("/tmp")):
    return (
        directory.parent == parent
        and re.fullmatch(r"everplain-candidate\.[A-Za-z0-9]+", directory.name)
        and not directory.is_symlink()
        and directory.is_dir()
        and directory.stat().st_uid == uid
        and directory.stat().st_mode & 0o077 == 0
    )


def discover(size, uid, parent=Path("/tmp")):
    candidates = []
    for directory in parent.glob("everplain-candidate.*"):
        if not eligible(directory, uid, parent):
            continue
        parts = directory / "parts"
        plan = parts / "plan.json"
        if parts.is_symlink() or plan.is_symlink():
            continue
        if plan.exists():
            info = plan.stat()
            if (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1
                    or info.st_uid not in {uid, os.getuid()} or info.st_size > 65536):
                continue
            try:
                if json.loads(plan.read_text()).get("archive_sha256") != EXPECTED:
                    continue
            except (ValueError, OSError):
                continue
        path = directory / "release.tar.gz"
        if path.is_symlink() or not path.is_file():
            continue
        before = path.stat()
        if before.st_uid != uid or before.st_nlink != 1 or not 0 <= before.st_size <= size:
            continue
        digest = checksum(path)
        after = path.stat()
        if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
            continue
        if before.st_size == size and digest != EXPECTED:
            continue
        candidates.append({"directory": str(directory), "size": before.st_size, "sha256": digest})
    return sorted(candidates, key=lambda row: row["size"], reverse=True)


def verify(directory, size, uid, parent=Path("/tmp")):
    if not eligible(directory, uid, parent):
        raise RuntimeError("upload target unavailable")
    path = directory / "release.tar.gz"
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != uid or info.st_nlink != 1:
        raise RuntimeError("upload target unavailable")
    if info.st_size != size or checksum(path) != EXPECTED:
        raise RuntimeError("upload checksum mismatch")


if __name__ == "__main__":
    try:
        mode, size, EXPECTED = sys.argv[1], int(sys.argv[2]), sys.argv[3]
        if not re.fullmatch(r"[0-9a-f]{64}", EXPECTED) or not 0 < size <= 2 * 1024**3:
            raise RuntimeError("invalid transfer identity")
        uid = int(os.environ.get("SUDO_UID", str(os.getuid())))
        idle()
        if mode == "find":
            print(json.dumps(discover(size, uid)))
        else:
            directory = Path(sys.argv[4])
            if not eligible(directory, uid):
                raise RuntimeError("upload target unavailable")
            if mode == "space":
                path = directory / "release.tar.gz"
                current = path.stat().st_size if path.exists() else 0
                if shutil.disk_usage(directory).free <= max(0, size - current) + 64 * 1024**2:
                    raise RuntimeError("upload space unavailable")
            elif mode == "verify":
                verify(directory, size, uid)
            else:
                raise RuntimeError("unsupported transfer operation")
    except Exception:
        raise SystemExit(2) from None
