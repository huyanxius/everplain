"""Repair only the existing Everplain Web's API address without restarting the API."""

import fcntl
import hashlib
import ipaddress
import json
import os
import re
import stat
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path

REPORT = {
    name: False
    for name in (
        "configuration_backup_complete",
        "nginx_config_valid",
        "nginx_reloaded",
        "proxied_api_health_ok",
        "configuration_restored",
        "repair_succeeded",
    )
}
PREVIOUS = "c226d64523dd6d1c30606aad4730856c0cbbb80e"


def require(value):
    if not value:
        raise RuntimeError("existing web repair check failed")


def run(args):
    result = subprocess.run(args, capture_output=True, text=True, timeout=30, check=False)
    require(result.returncode == 0)
    return result.stdout


def healthy(url):
    try:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(url, timeout=3) as response:
            value = json.loads(response.read(65536))
            return (
                response.url == url
                and response.status == 200
                and value.get("status") == "ok"
                and value.get("release_revision") == PREVIOUS
            )
    except (OSError, ValueError):
        return False


def replacement(original, address):
    parsed = ipaddress.ip_address(address)
    require(parsed.version == 4 and parsed.is_private)
    # Old releases have one direct proxy; current releases share one named backend.
    # Refuse mixed, duplicate, unknown or multi-server API targets before writing.
    pattern = (
        rb"(proxy_pass\s+http://)([0-9.]+)(:8297\s*;)"
        rb"|(upstream\s+everplain_api_backend\s*\{\s*server\s+)"
        rb"([0-9.]+)(:8297\s*;\s*\})"
    )
    require(len(re.findall(pattern, original)) == 1)
    targets = re.findall(rb"(?:proxy_pass\s+http://|server\s+)[^\s;{}]+:8297\s*;", original)
    require(len(targets) == 1)
    return re.sub(
        pattern,
        lambda match: (match[1] or match[4]) + address.encode() + (match[3] or match[6]),
        original,
    )


def write_same_inode(stream, data):
    stream.seek(0)
    stream.write(data)
    stream.truncate()
    stream.flush()
    os.fsync(stream.fileno())


def repair():
    require(os.geteuid() == 0)
    api, web = [
        json.loads(run(["docker", "inspect", name]))[0]
        for name in ("everplain-api", "everplain-web")
    ]
    for role, value in (("api", api), ("web", web)):
        require(value["Name"] == "/everplain-" + role and value["State"]["Running"])
    env = dict(item.split("=", 1) for item in api["Config"]["Env"])
    require(env.get("EVERPLAIN_RELEASE_REVISION") == PREVIOUS)
    require(healthy("http://127.0.0.1:8297/api/health"))
    networks = api["NetworkSettings"]["Networks"]
    require(len(networks) == 1 and set(networks) == set(web["NetworkSettings"]["Networks"]))
    require(next(iter(networks)) == "bridge" or next(iter(networks)).startswith("everplain"))
    address = next(iter(networks.values()))["IPAddress"]
    mounts = [
        item
        for item in web["Mounts"]
        if item["Destination"] == "/etc/nginx/conf.d/default.conf" and item["Type"] == "bind"
    ]
    require(len(mounts) == 1)
    path = Path(mounts[0]["Source"])
    require(
        path.is_absolute()
        and path.resolve() == path
        and any("everplain" in part for part in path.parts)
    )
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_size < 1024**2)
    with path.open("r+b") as stream:
        fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        require(os.fstat(stream.fileno()).st_ino == info.st_ino)
        original = stream.read()
        changed = replacement(original, address)
        if changed == original and healthy("http://127.0.0.1:5196/api/health"):
            REPORT.update(proxied_api_health_ok=True, repair_succeeded=True)
            return
        base = Path("/srv/everplain-updates/upstream-recovery")
        base.mkdir(mode=0o700, parents=True, exist_ok=True)
        require(
            base.resolve() == base and base.stat().st_uid == 0 and base.stat().st_mode & 0o077 == 0
        )
        backup = Path(tempfile.mkdtemp(prefix="web-", dir=base))
        (backup / "nginx.before.conf").write_bytes(original)
        (backup / "nginx.before.conf").chmod(0o600)
        (backup / "identity.json").write_text(
            json.dumps(
                {
                    "source": str(path),
                    "uid": info.st_uid,
                    "gid": info.st_gid,
                    "mode": stat.S_IMODE(info.st_mode),
                    "sha256": hashlib.sha256(original).hexdigest(),
                }
            )
        )
        (backup / "identity.json").chmod(0o600)
        REPORT["configuration_backup_complete"] = True
        try:
            write_same_inode(stream, changed)
            run(["docker", "exec", "everplain-web", "nginx", "-t"])
            REPORT["nginx_config_valid"] = True
            run(["docker", "exec", "everplain-web", "nginx", "-s", "reload"])
            REPORT["nginx_reloaded"] = True
            for _attempt in range(12):
                if healthy("http://127.0.0.1:5196/api/health"):
                    REPORT.update(proxied_api_health_ok=True, repair_succeeded=True)
                    return
                time.sleep(2)
            raise RuntimeError("existing web health check failed")
        except BaseException:
            write_same_inode(stream, original)
            REPORT["configuration_restored"] = True
            run(["docker", "exec", "everplain-web", "nginx", "-t"])
            run(["docker", "exec", "everplain-web", "nginx", "-s", "reload"])
            raise


if __name__ == "__main__":
    try:
        with Path("/run/lock/everplain-release.lock").open("a") as lock:
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            repair()
        print(json.dumps(REPORT))
    except BaseException:
        print(json.dumps(REPORT))
        raise SystemExit(2) from None
