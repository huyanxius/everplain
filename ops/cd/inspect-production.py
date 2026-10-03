"""Read-only booleans only: no production metadata is disclosed in public Actions logs."""

import hashlib
import json
import os
import re
import stat
import subprocess
import time
import urllib.request
from pathlib import Path

UPLOAD_SHA256 = "85f2b033ed68e94d9d0563800d3d5b078c4b4e2d7b6ad868c4a3fa2e0cf3ec03"
# Public artifact 11266871021 used compression-level 0. Its ZIP includes the entire
# tar plus metadata, so this larger denominator gives conservative progress only.
PUBLIC_ARTIFACT_BYTES = 141_463_972


def upload_snapshot(parent=Path("/tmp")):
    result = {}
    uid = int(os.environ.get("SUDO_UID", str(os.getuid())))
    for directory in parent.glob("everplain-candidate.*"):
        try:
            info = directory.lstat()
            if (
                not re.fullmatch(r"everplain-candidate\.[A-Za-z0-9]+", directory.name)
                or not stat.S_ISDIR(info.st_mode)
                or info.st_uid != uid
                or info.st_mode & 0o077
            ):
                continue
            path = directory / "release.tar.gz"
            info = path.lstat()
            if stat.S_ISREG(info.st_mode) and info.st_uid == uid and info.st_nlink == 1:
                result[path] = (info.st_size, info.st_mtime_ns)
                parts = directory / "parts"
                plan = parts / "plan.json"
                if not parts.is_symlink() and not plan.is_symlink() and plan.is_file():
                    if plan.stat().st_size > 16384:
                        continue
                    values = json.loads(plan.read_text())
                    if values.get("prefix_size") != info.st_size:
                        continue
                    for index, item in enumerate(values.get("parts", [])[:3]):
                        if item.get("name") != f"part-{index}":
                            continue
                        chunk = parts / item["name"]
                        data = chunk.lstat()
                        if (
                            stat.S_ISREG(data.st_mode)
                            and data.st_uid == uid
                            and data.st_nlink == 1
                            and data.st_size <= item["size"]
                        ):
                            result[chunk] = (data.st_size, data.st_mtime_ns)
        except (OSError, ValueError, TypeError, KeyError):
            pass
    return result


def upload_writers(paths, proc=Path("/proc")):
    writers = set()
    for fd in proc.glob("[0-9]*/fd/*"):
        try:
            target = Path(os.readlink(fd))
            if target not in paths:
                continue
            flags = (fd.parent.parent / "fdinfo" / fd.name).read_text()
            match = re.search(r"^flags:\s+([0-7]+)$", flags, re.MULTILINE)
            if match and int(match[1], 8) & os.O_ACCMODE in {os.O_WRONLY, os.O_RDWR}:
                writers.add(target)
        except OSError:
            pass
    return writers


def inspect_upload():
    before = upload_snapshot()
    started = time.monotonic()
    time.sleep(10)
    after = upload_snapshot()
    elapsed = max(1, time.monotonic() - started)
    writers = upload_writers(after)
    complete = False
    for path, metadata in after.items():
        if path in writers or before.get(path) != metadata:
            continue
        try:
            digest = hashlib.sha256()
            with path.open("rb") as stream:
                for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                    digest.update(chunk)
            unchanged = upload_snapshot().get(path) == metadata
            complete |= unchanged and digest.hexdigest() == UPLOAD_SHA256
        except OSError:
            pass
    totals = {}
    for path, (size, _mtime) in after.items():
        directory = path.parent.parent if path.parent.name == "parts" else path.parent
        totals[directory] = totals.get(directory, 0) + size
    return {
        "upload_present": bool(after),
        "upload_growing": any(
            value[0] > before.get(path, (0, 0))[0] for path, value in after.items()
        ),
        "upload_writer_present": bool(writers),
        "upload_complete": complete,
        "upload_at_least_64_kib_per_second": sum(
            max(0, value[0] - before.get(path, (0, 0))[0]) for path, value in after.items()
        )
        / elapsed
        >= 64 * 1024,
        **{
            f"upload_bytes_at_least_{percent}_percent": complete
            or any(
                size * 100 >= PUBLIC_ARTIFACT_BYTES * percent
                for size in totals.values()
                if size <= PUBLIC_ARTIFACT_BYTES
            )
            for percent in (25, 50, 75)
        },
    }


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args):
        raise ValueError("redirect rejected")


def healthy(url):
    try:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
        with opener.open(url, timeout=5) as response:
            return response.status == 200
    except Exception:
        return False


def inspect():
    docker_readable, container_present = False, False
    try:
        result = subprocess.run(
            ["docker", "ps", "--filter", "name=everplain", "--format", "{{.Names}}"],
            capture_output=True,
            text=True,
            timeout=20,
            check=False,
        )
        docker_readable = result.returncode == 0
        container_present = docker_readable and any(
            re.fullmatch(r"everplain(?:[-_][\w-]+)?", name) for name in result.stdout.splitlines()
        )
    except Exception:
        pass
    return {
        "ssh_authenticated": True,
        "docker_readable": docker_readable,
        "everplain_container_present": container_present,
        "api_health_ok": healthy("http://127.0.0.1:8297/api/health"),
        "web_health_ok": healthy("http://127.0.0.1:5196/"),
        "existing_release_controller_present": Path(
            "/usr/local/lib/everplain/cd/deploy.py"
        ).is_file(),
        "host_changes": False,
        **inspect_upload(),
    }


if __name__ == "__main__":
    print(json.dumps(inspect(), indent=2))
