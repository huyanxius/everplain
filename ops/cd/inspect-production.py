"""Read-only booleans only: no production metadata is disclosed in public Actions logs."""

import hashlib
import json
import os
import re
import shutil
import stat
import subprocess
import time
import urllib.request
from pathlib import Path

UPLOAD_SHA256 = "85f2b033ed68e94d9d0563800d3d5b078c4b4e2d7b6ad868c4a3fa2e0cf3ec03"
# Public artifact 11266871021 used compression-level 0. Its ZIP includes the entire
# tar plus metadata, so this larger denominator gives conservative progress only.
PUBLIC_ARTIFACT_BYTES = 141_463_972
REVISION = "0dae10baff6a78cb0e12f67cc6f5ad153336a8a4"
CHECKED_IMAGES = {
    "api": "sha256:e3101bab572ab3f795a13a4c7ccd70198d4908b7ab949fefc3e05afcd19b14a0",
    "web": "sha256:d7fa4418995958435e783f23d627be4542bf4aa6ba0c9b0d805f56c3338ff8d3",
}

DATA_PRESENCE_SCRIPT = r"""
import contextlib,json,os,re,sqlite3
result = {key: False for key in (
    "data_presence_verified", "account_records_present", "auth_state_present",
    "business_records_present", "initialization_records_present",
    "registration_email_configured", "initial_admin_configured")}
try:
    connection = sqlite3.connect("file:/data/everplain.db?mode=ro", uri=True, timeout=5)
    with contextlib.closing(connection) as db:
        db.execute("PRAGMA query_only=ON")
        tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        assert {"users", "alembic_version"} <= tables
        initialization = {"alembic_version", "account_system_state", "sqlite_sequence"}
        # FTS shadow tables contain internal rows even when the searchable table is empty.
        initialization.update(row[1] for row in db.execute("PRAGMA table_list")
                              if row[2] == "shadow")
        auth = {"user_sessions", "registration_verifications", "account_password_resets",
                "account_mutation_requests", "account_audit_events", "user_preferences"}
        present = set()
        for table in tables:
            assert re.fullmatch(r"[a-z][a-z0-9_]*", table)
            if not table.startswith("sqlite_") and db.execute(
                    'SELECT 1 FROM "' + table + '" LIMIT 1').fetchone() is not None:
                present.add(table)
        result["account_records_present"] = "users" in present
        result["auth_state_present"] = bool(present & auth)
        result["initialization_records_present"] = bool(present & initialization)
        result["business_records_present"] = bool(present - initialization - auth - {"users"})
    result["registration_email_configured"] = bool(
        os.environ.get("EVERPLAIN_RESEND_API_KEY", "").strip()
        and "@" in os.environ.get("EVERPLAIN_EMAIL_FROM", ""))
    result["initial_admin_configured"] = bool(
        "@" in os.environ.get("EVERPLAIN_ACCOUNT_INITIAL_ADMIN_EMAIL", "")
        and len(os.environ.get("EVERPLAIN_ACCOUNT_INITIAL_ADMIN_PASSWORD", "")) >= 12)
    result["data_presence_verified"] = True
except Exception:
    pass
print(json.dumps(result))
"""


def inspect_data_presence():
    try:
        value = json.loads(
            read_command(["docker", "exec", "everplain-api", "python", "-c", DATA_PRESENCE_SCRIPT])
        )
        allowed = {
            "data_presence_verified",
            "account_records_present",
            "auth_state_present",
            "business_records_present",
            "initialization_records_present",
            "registration_email_configured",
            "initial_admin_configured",
        }
        if set(value) == allowed and all(type(item) is bool for item in value.values()):
            return value
    except (OSError, ValueError, TypeError, subprocess.SubprocessError):
        pass
    return {"data_presence_verified": False}


def read_command(args):
    result = subprocess.run(args, capture_output=True, text=True, timeout=20, check=False)
    if result.returncode:
        raise ValueError("inspection unavailable")
    return result.stdout.strip()


def inspect_release(base=Path("/srv/everplain-updates")):
    report = {
        key: False
        for key in (
            "release_disk_budget_ok",
            "release_api_image_verified",
            "release_web_image_verified",
            "release_private_env_present",
        )
    }
    try:
        stages = [
            p
            for p in base.glob(REVISION[:8] + "-*")
            if p.is_dir()
            and not p.is_symlink()
            and p.stat().st_uid == os.geteuid()
            and p.stat().st_mode & 0o077 == 0
        ]
        stage = max(stages, key=lambda p: p.stat().st_mtime_ns)
        release = stage / "releases" / REVISION
        env = release / "runtime.env"
        report["release_private_env_present"] = env.is_file() and not env.is_symlink()
        for role, image in CHECKED_IMAGES.items():
            try:
                output = read_command(
                    [
                        "docker",
                        "image",
                        "inspect",
                        "--format",
                        "{{.Architecture}} {{.Os}} "
                        '{{index .Config.Labels "org.opencontainers.image.revision"}}',
                        image,
                    ]
                )
                report[f"release_{role}_image_verified"] = output == "amd64 linux " + REVISION
            except (OSError, ValueError, subprocess.SubprocessError):
                pass
        mounts = json.loads(
            read_command(["docker", "inspect", "--format", "{{json .Mounts}}", "everplain-api"])
        )
        source = Path(next(item["Source"] for item in mounts if item["Destination"] == "/data"))
        image_bytes = sum(
            (release / "images" / (role + ".tar")).stat().st_size for role in CHECKED_IMAGES
        )
        data_bytes = sum(p.stat().st_size for p in source.iterdir())
        budget = image_bytes * 3 + data_bytes * 3 + 512 * 1024**2
        docker_root = Path(read_command(["docker", "info", "--format", "{{.DockerRootDir}}"]))
        report["release_disk_budget_ok"] = (
            shutil.disk_usage(stage).free > budget and shutil.disk_usage(docker_root).free > budget
        )
    except (OSError, ValueError, TypeError, KeyError, StopIteration, subprocess.SubprocessError):
        pass
    return report


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


def inspect_upstream():
    report = {
        "proxied_api_health_ok": False,
        "web_api_upstream_found": False,
        "web_api_upstream_matches": False,
    }
    try:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
        with opener.open("http://127.0.0.1:5196/api/health", timeout=5) as response:
            report["proxied_api_health_ok"] = (
                response.status == 200 and json.loads(response.read(65536)).get("status") == "ok"
            )
    except (OSError, ValueError):
        pass
    try:
        networks = json.loads(
            read_command(
                [
                    "docker",
                    "inspect",
                    "--format",
                    "{{json .NetworkSettings.Networks}}",
                    "everplain-api",
                ]
            )
        )
        mounts = json.loads(
            read_command(["docker", "inspect", "--format", "{{json .Mounts}}", "everplain-web"])
        )
        paths = [
            Path(item["Source"])
            for item in mounts
            if item["Destination"] == "/etc/nginx/conf.d/default.conf"
        ]
        if len(networks) == 1 and len(paths) == 1:
            path = paths[0]
            if (
                path.is_file()
                and not path.is_symlink()
                and path.stat().st_size < 1024**2
                and any("everplain" in part for part in path.parts)
            ):
                targets = re.findall(r"proxy_pass\s+http://([0-9.]+):8297\s*;", path.read_text())
                report["web_api_upstream_found"] = len(targets) == 1
                report["web_api_upstream_matches"] = len(targets) == 1 and (
                    targets[0] == next(iter(networks.values())).get("IPAddress")
                )
    except (OSError, ValueError, TypeError, KeyError, subprocess.SubprocessError):
        pass
    return report


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
        **inspect_release(),
        **inspect_upstream(),
        **inspect_data_presence(),
    }


if __name__ == "__main__":
    print(json.dumps(inspect(), indent=2))
