#!/usr/bin/env python3
"""One-time checked candidate update of the existing Everplain containers.

No installed controller, new account or new network. All host details stay local.
"""

import contextlib
import fcntl
import hashlib
import json
import os
import re
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

from artifact import MAX_BYTES, unpack
from deploy import Controller, atomic_bytes, copy_index, expected_runtime_mode

REVISION = "0dae10baff6a78cb0e12f67cc6f5ad153336a8a4"
ARCHIVE_SHA256 = "85f2b033ed68e94d9d0563800d3d5b078c4b4e2d7b6ad868c4a3fa2e0cf3ec03"
API_IMAGE = "sha256:e3101bab572ab3f795a13a4c7ccd70198d4908b7ab949fefc3e05afcd19b14a0"
WEB_IMAGE = "sha256:d7fa4418995958435e783f23d627be4542bf4aa6ba0c9b0d805f56c3338ff8d3"
PREVIOUS_REVISION = "c226d64523dd6d1c30606aad4730856c0cbbb80e"
BASE = Path("/srv/everplain-updates")
NAMES = {"api": "everplain-api", "web": "everplain-web"}


def require(condition):
    if not condition:
        raise RuntimeError("checked release precondition failed")


def run(args, timeout=180):
    result = subprocess.run(args, capture_output=True, text=True, timeout=timeout, check=False)
    if result.returncode:
        # Never print argv/output: inspect and preflight can contain private configuration.
        raise RuntimeError("checked release command failed")
    return result.stdout


def metadata(name):
    return json.loads(run(["docker", "inspect", name]))[0]


def environment(container):
    result = dict(item.split("=", 1) for item in container["Config"]["Env"])
    require(result.get("EVERPLAIN_RUNTIME_MODE") == "base")
    require(result.get("EVERPLAIN_DATABASE_URL") == "sqlite:////data/everplain.db")
    require(result.get("EVERPLAIN_RETRIEVAL_INDEX_PATH") == "/data/everplain-retrieval.db")
    require(not any(key.startswith("QUNXUE_") for key in result))
    require(
        all(re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", k) and "\n" not in v for k, v in result.items())
    )
    return result


def existing_layout(api, web):
    for role, value, port, inside in (
        ("api", api, "8297", "8297/tcp"),
        ("web", web, "5196", "8080/tcp"),
    ):
        require(value["Name"] == "/" + NAMES[role])
        require(value["State"]["Running"] and not value["HostConfig"].get("Privileged"))
        require(
            value["HostConfig"].get("RestartPolicy", {}).get("Name") in {"unless-stopped", "no"}
        )
        require(
            value["HostConfig"]["PortBindings"]
            == {inside: [{"HostIp": "127.0.0.1", "HostPort": port}]}
        )
        require(len(value["NetworkSettings"]["Networks"]) == 1)
    api_network = next(iter(api["NetworkSettings"]["Networks"]))
    web_network = next(iter(web["NetworkSettings"]["Networks"]))
    require(api_network == web_network)
    require(api_network == "bridge" or api_network.startswith("everplain"))
    mounts = api["Mounts"]
    require(len(mounts) == 1 and mounts[0]["Destination"] == "/data" and mounts[0]["RW"])
    mount = mounts[0]
    require(mount["Type"] in {"volume", "bind"})
    if mount["Type"] == "volume":
        require(mount.get("Name", "").startswith("everplain"))
    source = Path(mount["Source"])
    require(source.is_absolute() and source.resolve() == source)
    require(any(part.startswith("everplain") for part in source.parts))
    require((source / "everplain.db").is_file())
    allowed = {
        name + suffix
        for name in ("everplain.db", "everplain-retrieval.db")
        for suffix in ("", "-wal", "-shm", "-journal")
    }
    require(all(p.is_file() and not p.is_symlink() and p.name in allowed for p in source.iterdir()))
    environment(api)
    return source, api_network


def save_json(path, value):
    atomic_bytes(path, (json.dumps(value, indent=2) + "\n").encode())


def http(url):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(url, timeout=5) as response:
        require(response.url == url and response.status == 200)
        return response.read(16 * 1024**2 + 1)


def public_health(manifest, mode):
    for _attempt in range(12):
        try:
            health = json.loads(http("https://e.qunxue.xyz/api/health?revision=" + REVISION))
            require(health.get("status") == "ok" and health.get("release_revision") == REVISION)
            require(health.get("runtime_mode") == mode)
            require(
                json.loads(http("https://e.qunxue.xyz/revision.json?revision=" + REVISION))[
                    "revision"
                ]
                == REVISION
            )
            # Local index is byte-checked by Controller.health. Public entry assets are exact;
            # CDN analytics may append a script to public HTML without changing app bytes.
            for path, digest in manifest["web_checks"].items():
                if path != "/index.html":
                    require(
                        hashlib.sha256(http("https://e.qunxue.xyz" + path)).hexdigest() == digest
                    )
            return
        except Exception:
            if _attempt == 11:
                raise RuntimeError("public acceptance failed") from None
            time.sleep(2)


class ExistingRelease:
    def __init__(self, archive, base=BASE):
        self.archive, self.base = Path(archive), base
        self.stage = None
        self.started = False
        self.stopped = False
        self.renamed = []
        self.report = {
            name: False
            for name in (
                "artifact_verified",
                "live_layout_verified",
                "backup_complete",
                "migration_complete",
                "candidate_started",
                "api_health_ok",
                "web_health_ok",
                "public_health_ok",
                "deployment_succeeded",
                "old_service_restored",
                "forward_stop_required",
            )
        }
        self.report["data_preserved"] = True

    def record(self):
        save_json(
            self.stage / "transaction.json",
            {
                "revision": REVISION,
                "candidate_started": self.started,
                "renamed": self.renamed,
                "old_names": self.old_names,
                "data": str(self.stage / "data"),
                "report": self.report,
            },
        )

    def recover(self):
        # After API start, even background writes belong to the new database/schema.
        if self.started:
            for role in ("web", "api"):
                with contextlib.suppress(Exception):
                    run(["docker", "stop", "--time", "45", NAMES[role]])
            self.report["forward_stop_required"] = True
        elif self.stopped:
            for role in reversed(self.renamed):
                run(["docker", "rename", self.old_names[role], NAMES[role]])
            run(["docker", "start", NAMES["api"]])
            run(["docker", "start", NAMES["web"]])
            for attempt in range(12):
                try:
                    restored = json.loads(http("http://127.0.0.1:5196/api/health"))
                    require(restored.get("status") == "ok")
                    require(restored.get("release_revision") == self.old_revision)
                    self.report["old_service_restored"] = True
                    break
                except Exception:
                    if attempt == 11:
                        raise RuntimeError("previous service readiness failed") from None
                    time.sleep(2)
        self.record()

    def execute(self):
        api, web = metadata(NAMES["api"]), metadata(NAMES["web"])
        source, network = existing_layout(api, web)
        old_env = environment(api)
        require(old_env.get("EVERPLAIN_RELEASE_REVISION") in {PREVIOUS_REVISION, REVISION})
        self.old_revision = old_env["EVERPLAIN_RELEASE_REVISION"]
        self.report["live_layout_verified"] = True
        self.base.mkdir(mode=0o700, exist_ok=True)
        require(
            self.base.is_dir() and not self.base.is_symlink() and self.base.resolve() == self.base
        )
        require(self.base.stat().st_uid == os.geteuid() and self.base.stat().st_mode & 0o022 == 0)
        data_bytes = sum(p.stat().st_size for p in source.iterdir())
        archive_bytes = self.archive.stat().st_size
        require(archive_bytes <= MAX_BYTES)
        reserve = 512 * 1024**2
        # Reserve the entire bounded unpack allowance before copying or extracting.
        require(
            shutil.disk_usage(self.base).free > archive_bytes + MAX_BYTES + data_bytes * 3 + reserve
        )
        self.stage = Path(tempfile.mkdtemp(prefix=REVISION[:8] + "-", dir=self.base))
        self.old_names = {role: NAMES[role] + "-before-" + self.stage.name for role in NAMES}
        frozen = self.stage / "release.tar.gz"
        shutil.copyfile(self.archive, frozen)
        release = self.stage / "releases" / REVISION
        release.parent.mkdir()
        manifest = unpack(frozen, release, REVISION, ARCHIVE_SHA256)
        require(manifest["images"] == {"api": API_IMAGE, "web": WEB_IMAGE})
        self.report["artifact_verified"] = True
        image_bytes = sum(
            (release / "images" / (role + ".tar")).stat().st_size for role in ("api", "web")
        )
        remaining_budget = image_bytes * 3 + data_bytes * 3 + reserve
        docker_root = Path(run(["docker", "info", "--format", "{{.DockerRootDir}}"]).strip())
        require(docker_root.is_absolute() and docker_root.is_dir())
        # Check both destinations with a combined budget, including on shared filesystems.
        require(shutil.disk_usage(self.base).free > remaining_budget)
        require(shutil.disk_usage(docker_root).free > remaining_budget)
        for role, image in (("api", API_IMAGE), ("web", WEB_IMAGE)):
            run(["docker", "load", "--input", str(release / "images" / (role + ".tar"))])
            info = json.loads(run(["docker", "image", "inspect", image]))[0]
            require(info["Architecture"] == "amd64" and info["Os"] == "linux")
            require(info["Config"]["Labels"].get("org.opencontainers.image.revision") == REVISION)
        env = environment(api)
        env.update(EVERPLAIN_RELEASE_REVISION=REVISION, EVERPLAIN_MIGRATIONS_MANAGED="1")
        atomic_bytes(
            release / "runtime.env", "".join(k + "=" + v + "\n" for k, v in env.items()).encode()
        )
        mode = expected_runtime_mode(release)
        run(
            [
                "docker",
                "run",
                "--rm",
                "--network",
                "none",
                "--env-file",
                str(release / "runtime.env"),
                "--entrypoint",
                "python",
                API_IMAGE,
                "/app/ops/preflight.py",
            ]
        )
        require(
            shutil.disk_usage(self.base).free
            > frozen.stat().st_size * 3 + sum(p.stat().st_size for p in source.iterdir()) * 3
        )
        self.record()
        if (
            self.old_revision == REVISION
            and api.get("Image") == API_IMAGE
            and web.get("Image") == WEB_IMAGE
        ):
            Controller(self.stage).health(REVISION)
            public_health(manifest, mode)
            self.report.update(
                api_health_ok=True,
                web_health_ok=True,
                public_health_ok=True,
                deployment_succeeded=True,
            )
            self.record()
            return self.report
        require(metadata(NAMES["api"])["Id"] == api["Id"])
        require(metadata(NAMES["web"])["Id"] == web["Id"])
        try:
            # Only these exact Everplain containers are stopped; old containers/config stay intact.
            self.stopped = True
            run(["docker", "stop", "--time", "45", NAMES["web"], NAMES["api"]])
            self.record()
            backups, data = self.stage / "backups", self.stage / "data"
            backups.mkdir(mode=0o700)
            data.mkdir(mode=stat.S_IMODE(source.stat().st_mode))
            os.chown(data, source.stat().st_uid, source.stat().st_gid)
            # Use the already checked API image's existing SQLite Online Backup helper.
            run(
                [
                    "docker",
                    "run",
                    "--rm",
                    "--network",
                    "none",
                    "--user",
                    "0:0",
                    "--mount",
                    f"type=bind,src={source},dst=/source,readonly",
                    "--mount",
                    f"type=bind,src={backups},dst=/backups",
                    "--entrypoint",
                    "python",
                    API_IMAGE,
                    "/app/ops/database.py",
                    "backup",
                    "/source/everplain.db",
                    "/backups/everplain.db",
                ]
            )
            for name in ("everplain.db", "everplain-retrieval.db"):
                origin, target = source / name, data / name
                if not origin.exists():
                    continue
                backup = backups / name
                if name != "everplain.db":
                    copy_index(origin, backup)
                copy_index(backup, target)
                info = origin.stat()
                os.chown(target, info.st_uid, info.st_gid)
                target.chmod(stat.S_IMODE(info.st_mode))
            self.report["backup_complete"] = True
            run(
                [
                    "docker",
                    "run",
                    "--rm",
                    "--network",
                    "none",
                    "--env",
                    "EVERPLAIN_RUNTIME_MODE=mock",
                    "--env",
                    "EVERPLAIN_DATABASE_URL=sqlite:////data/everplain.db",
                    "--mount",
                    f"type=bind,src={data},dst=/data",
                    "--entrypoint",
                    "alembic",
                    API_IMAGE,
                    "upgrade",
                    "head",
                ]
            )
            self.report["migration_complete"] = True
            for role in ("web", "api"):
                run(["docker", "rename", NAMES[role], self.old_names[role]])
                self.renamed.append(role)
                self.record()
            self.started = True
            self.report["candidate_started"] = True
            self.record()
            run(
                [
                    "docker",
                    "run",
                    "-d",
                    "--name",
                    NAMES["api"],
                    "--restart",
                    "unless-stopped",
                    "--network",
                    network,
                    "--security-opt",
                    "no-new-privileges:true",
                    "--env-file",
                    str(release / "runtime.env"),
                    "-p",
                    "127.0.0.1:8297:8297",
                    "--mount",
                    f"type=bind,src={data},dst=/data",
                    API_IMAGE,
                ]
            )
            checker = Controller(self.stage)
            checker.health(REVISION, web=False)
            self.report["api_health_ok"] = True
            address = metadata(NAMES["api"])["NetworkSettings"]["Networks"][network]["IPAddress"]
            require(re.fullmatch(r"(?:[0-9]{1,3}\.){3}[0-9]{1,3}", address))
            nginx = Path(__file__).resolve().parents[1] / "nginx.conf"
            config = nginx.read_text()
            require(config.count("proxy_pass http://api:8297;") == 1)
            atomic_bytes(
                self.stage / "nginx.conf",
                config.replace("http://api:8297", f"http://{address}:8297").encode(),
            )
            nginx_mount = (
                f"type=bind,src={self.stage / 'nginx.conf'},"
                "dst=/etc/nginx/conf.d/default.conf,readonly"
            )
            run(
                [
                    "docker",
                    "run",
                    "--rm",
                    "--network",
                    network,
                    "--mount",
                    nginx_mount,
                    "--entrypoint",
                    "nginx",
                    WEB_IMAGE,
                    "-t",
                ]
            )
            run(
                [
                    "docker",
                    "run",
                    "-d",
                    "--name",
                    NAMES["web"],
                    "--restart",
                    "unless-stopped",
                    "--network",
                    network,
                    "--security-opt",
                    "no-new-privileges:true",
                    "-p",
                    "127.0.0.1:5196:8080",
                    "--mount",
                    nginx_mount,
                    WEB_IMAGE,
                ]
            )
            checker.health(REVISION)
            self.report["web_health_ok"] = True
            public_health(manifest, mode)
            self.report["public_health_ok"] = True
            self.report["deployment_succeeded"] = True
            self.record()
        except BaseException:
            self.recover()
            raise
        return self.report


def interrupted(_signum, _frame):
    raise RuntimeError("release interrupted")


if __name__ == "__main__":
    updater = None
    try:
        require(os.geteuid() == 0 and len(sys.argv) == 2)
        with Path("/run/lock/everplain-release.lock").open("a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            for number in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
                signal.signal(number, interrupted)
            updater = ExistingRelease(sys.argv[1])
            print(json.dumps(updater.execute()))
    except BaseException:
        print(json.dumps(updater.report if updater else {"deployment_succeeded": False}))
        raise SystemExit(2) from None
