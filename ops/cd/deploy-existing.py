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
import tarfile
import tempfile
import time
import urllib.request
from pathlib import Path

from artifact import MAX_BYTES, digest, tree_hash, unpack, validate_manifest
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


def run(args, timeout=180, report=None, prefix=""):
    result = subprocess.run(args, capture_output=True, text=True, timeout=timeout, check=False)
    if report is not None:
        error = result.stderr.lower()
        report.update(
            {
                prefix + "command_succeeded": result.returncode == 0,
                prefix + "exit_1": result.returncode == 1,
                prefix + "no_space": "no space left" in error,
                prefix + "missing_file": "no such file" in error,
                prefix + "permission_denied": "permission denied" in error,
                prefix + "unsupported_format": any(
                    word in error
                    for word in ("unsupported", "invalid tar", "invalid argument", "unrecognized")
                ),
            }
        )
        if prefix == "configuration_":
            allowed = set(
                [
                    "MODEL_BASE_URL",
                    "MODEL_NAME",
                    "MODEL_API_KEY",
                    "EMBEDDING_BASE_URL",
                    "EMBEDDING_MODEL",
                    "EMBEDDING_API_KEY",
                    "RERANKER_BASE_URL",
                    "RERANKER_MODEL",
                    "RERANKER_API_KEY",
                    "WEB_SEARCH_API_KEY",
                    "WEB_SEARCH_PROFILE",
                    "WEB_SEARCH_BASE_URL",
                    "ACCOUNT_INITIAL_ADMIN_EMAIL",
                    "ACCOUNT_INITIAL_ADMIN_PASSWORD",
                    "RESEND_API_KEY",
                    "EMAIL_FROM",
                    "TRANSCRIPTION_API_KEY",
                    "TRANSCRIPTION_BASE_URL",
                    "TRANSCRIPTION_MODEL",
                    "RUNTIME_MODE",
                    "SESSION_COOKIE_SECURE",
                    "SESSION_COOKIE_NAME",
                    "DATABASE_URL",
                    "CORS_ALLOWED_ORIGINS",
                    "MODEL_FALLBACKS",
                    "SETTINGS_FORMAT",
                ]
            )
            try:
                fields = set(json.loads(result.stdout)["invalid_fields"])
                for name in allowed:
                    report["invalid_" + name.lower()] = "EVERPLAIN_" + name in fields
                report["invalid_other_configuration"] = bool(
                    fields - {"EVERPLAIN_" + name for name in allowed}
                )
            except (ValueError, TypeError, KeyError):
                report["configuration_report_unrecognized"] = True
    if result.returncode:
        # Never print argv/output: inspect and preflight can contain private configuration.
        raise RuntimeError("checked release command failed")
    return result.stdout


def reusable_stage(base):
    for stage in sorted(
        base.glob(REVISION[:8] + "-*"), key=lambda p: p.stat().st_mtime_ns, reverse=True
    ):
        if (
            not stage.is_dir()
            or stage.is_symlink()
            or stage.stat().st_uid != os.geteuid()
            or stage.stat().st_mode & 0o077
            or any(
                (stage / name).exists() or (stage / name).is_symlink()
                for name in ("transaction.json", "data", "backups")
            )
        ):
            continue
        frozen, release = stage / "release.tar.gz", stage / "releases" / REVISION
        require(release.resolve() == release and release.is_dir())
        if not frozen.is_file() or frozen.is_symlink() or digest(frozen) != ARCHIVE_SHA256:
            continue
        manifest = validate_manifest(json.loads((release / "manifest.json").read_text()), REVISION)
        require(not any(p.is_symlink() for p in release.rglob("*")))
        require(
            all(digest(release / name) == checksum for name, checksum in manifest["files"].items())
        )
        require(tree_hash(release / "backend") == manifest["migration_tree"])
        return stage, manifest
    return None


def inspect_image_archive(path, expected, report, role):
    config = None
    with tarfile.open(path, "r") as archive:
        names = set(archive.getnames())
        report[f"{role}_archive_docker_manifest"] = "manifest.json" in names
        report[f"{role}_archive_oci_layout"] = "oci-layout" in names
        image_hash = expected.removeprefix("sha256:")
        options = [image_hash + ".json", "blobs/sha256/" + image_hash]
        config_name = next((name for name in options if name in names), None)
        report[f"{role}_archive_config_matches_image"] = False
        report[f"{role}_archive_linux_amd64"] = False
        if config_name:
            data = archive.extractfile(config_name).read(2 * 1024**2)
            report[f"{role}_archive_config_matches_image"] = (
                hashlib.sha256(data).hexdigest() == image_hash
            )
            config = json.loads(data)
            report[f"{role}_archive_linux_amd64"] = (
                config.get("architecture") == "amd64" and config.get("os") == "linux"
            )
            report[f"{role}_archive_revision_label_matches"] = (
                (config.get("config") or {}).get("Labels") or {}
            ).get("org.opencontainers.image.revision") == REVISION
        if "manifest.json" in names:
            manifest = json.load(archive.extractfile("manifest.json"))
            expected_entries = [item for item in manifest if item.get("Config") in options]
            report[f"{role}_archive_manifest_references_expected_config"] = bool(expected_entries)
            report[f"{role}_archive_tag_references_expected_config"] = any(
                "everplain-" + role + ":" + REVISION in (item.get("RepoTags") or [])
                for item in expected_entries
            )
    return config


def archive_image_identities(path, expected):
    """Prove config/manifest/index identities from the already checksum-verified archive."""
    identities = {expected}
    with tarfile.open(path, "r") as archive:
        names = set(archive.getnames())
        if "index.json" not in names:
            return identities

        def read_json(name, digest_value=None):
            require(name in names and archive.getmember(name).size <= 2 * 1024**2)
            data = archive.extractfile(name).read()
            if digest_value:
                require(hashlib.sha256(data).hexdigest() == digest_value[7:])
            return json.loads(data)

        def references_expected(descriptor, depth=0):
            require(depth < 6)
            identity = descriptor.get("digest", "")
            require(re.fullmatch(r"sha256:[a-f0-9]{64}", identity))
            node = read_json("blobs/sha256/" + identity[7:], identity)
            matched = (node.get("config") or {}).get("digest") == expected
            if "manifests" in node:
                require(len(node["manifests"]) <= 64)
                matched = any(references_expected(item, depth + 1) for item in node["manifests"])
            if matched:
                identities.add(identity)
            return matched

        root = read_json("index.json")
        require(len(root["manifests"]) <= 64)
        for descriptor in root["manifests"]:
            references_expected(descriptor)
    return identities


def loaded_image(expected, role, report, archive_config=None, archive_path=None):
    found = {}
    for reference, name in ((expected, "id"), ("everplain-" + role + ":" + REVISION, "tag")):
        result = subprocess.run(
            ["docker", "image", "inspect", reference],
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
        report[f"{role}_inspect_{name}_succeeded"] = result.returncode == 0
        if result.returncode:
            continue
        value = json.loads(result.stdout)[0]
        found[name] = value
        report[f"{role}_{name}_identity_matches"] = value.get("Id") == expected
        report[f"{role}_{name}_amd64"] = value.get("Architecture") == "amd64"
        report[f"{role}_{name}_linux"] = value.get("Os") == "linux"
        report[f"{role}_{name}_revision_label_matches"] = (
            (value.get("Config") or {}).get("Labels") or {}
        ).get("org.opencontainers.image.revision") == REVISION
        if archive_config:
            layers = (archive_config.get("rootfs") or {}).get("diff_ids")
            report[f"{role}_{name}_rootfs_matches_archive"] = bool(layers) and (
                (value.get("RootFS") or {}).get("Layers") == layers
            )
            report[f"{role}_{name}_labels_match_archive"] = (value.get("Config") or {}).get(
                "Labels"
            ) == (archive_config.get("config") or {}).get("Labels")
            report[f"{role}_{name}_architecture_matches_archive"] = value.get(
                "Architecture"
            ) == archive_config.get("architecture")
    if "id" in found and found["id"].get("Id") == expected:
        return found["id"]
    # A containerd image store may address an image by manifest/index digest instead
    # of config digest. Never trust a mutable tag without this complete archive proof.
    require("tag" in found and archive_config and archive_path)
    value = found["tag"]
    require(report.get(f"{role}_archive_config_matches_image"))
    require(report.get(f"{role}_archive_tag_references_expected_config"))
    identities = archive_image_identities(archive_path, expected)
    report[f"{role}_store_identity_proven_by_archive"] = value.get("Id") in identities
    report[f"{role}_runtime_config_matches_archive"] = value.get("Config") == archive_config.get(
        "config"
    )
    require(report[f"{role}_store_identity_proven_by_archive"])
    require(report[f"{role}_runtime_config_matches_archive"])
    require(report.get(f"{role}_tag_rootfs_matches_archive"))
    require(report.get(f"{role}_tag_architecture_matches_archive"))
    require(value.get("Os") == archive_config.get("os"))
    return value


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
        self.images = {}
        self.report = {
            name: False
            for name in (
                "artifact_verified",
                "staged_artifact_reused",
                "copy_budget_verified",
                "stage_load_budget_verified",
                "docker_load_budget_verified",
                "api_load_started",
                "api_image_verified",
                "web_load_started",
                "web_image_verified",
                "runtime_mode_verified",
                "configuration_verified",
                "backup_budget_verified",
                "service_stop_started",
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
                "images": self.images,
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
        cached = reusable_stage(self.base)
        if cached:
            self.stage, manifest = cached
            self.report["staged_artifact_reused"] = True
            frozen = self.stage / "release.tar.gz"
            release = self.stage / "releases" / REVISION
        else:
            # Reserve the entire bounded unpack allowance before copying or extracting.
            require(
                shutil.disk_usage(self.base).free
                > archive_bytes + MAX_BYTES + data_bytes * 3 + reserve
            )
            self.report["copy_budget_verified"] = True
            self.stage = Path(tempfile.mkdtemp(prefix=REVISION[:8] + "-", dir=self.base))
            frozen = self.stage / "release.tar.gz"
            shutil.copyfile(self.archive, frozen)
            release = self.stage / "releases" / REVISION
            release.parent.mkdir()
            manifest = unpack(frozen, release, REVISION, ARCHIVE_SHA256)
        self.old_names = {role: NAMES[role] + "-before-" + self.stage.name for role in NAMES}
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
        self.report["stage_load_budget_verified"] = True
        require(shutil.disk_usage(docker_root).free > remaining_budget)
        self.report["docker_load_budget_verified"] = True
        for role, image in (("api", API_IMAGE), ("web", WEB_IMAGE)):
            archive_path = release / "images" / (role + ".tar")
            archive_config = inspect_image_archive(archive_path, image, self.report, role)
            self.report[role + "_load_started"] = True
            run(
                ["docker", "load", "--input", str(archive_path)],
                report=self.report,
                prefix=role + "_load_",
            )
            info = loaded_image(image, role, self.report, archive_config, archive_path)
            self.images[role] = info["Id"]
            require(info["Architecture"] == "amd64" and info["Os"] == "linux")
            require(info["Config"]["Labels"].get("org.opencontainers.image.revision") == REVISION)
            self.report[role + "_image_verified"] = True
        env = environment(api)
        env.update(EVERPLAIN_RELEASE_REVISION=REVISION, EVERPLAIN_MIGRATIONS_MANAGED="1")
        atomic_bytes(
            release / "runtime.env", "".join(k + "=" + v + "\n" for k, v in env.items()).encode()
        )
        mode = expected_runtime_mode(release)
        self.report["runtime_mode_verified"] = True
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
                self.images["api"],
                "/app/ops/preflight.py",
            ],
            report=self.report,
            prefix="configuration_",
        )
        self.report["configuration_verified"] = True
        require(
            shutil.disk_usage(self.base).free
            > frozen.stat().st_size * 3 + sum(p.stat().st_size for p in source.iterdir()) * 3
        )
        self.report["backup_budget_verified"] = True
        self.record()
        if (
            self.old_revision == REVISION
            and api.get("Image") == self.images["api"]
            and web.get("Image") == self.images["web"]
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
            self.report["service_stop_started"] = True
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
                    self.images["api"],
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
                    self.images["api"],
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
                    self.images["api"],
                ]
            )
            checker = Controller(self.stage)
            require(metadata(NAMES["api"])["Config"]["Image"] == self.images["api"])
            self.report["api_runtime_image_reference_verified"] = True
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
                    self.images["web"],
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
                    self.images["web"],
                ]
            )
            require(metadata(NAMES["web"])["Config"]["Image"] == self.images["web"])
            self.report["web_runtime_image_reference_verified"] = True
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
            print(json.dumps({"deployment_started": True}), flush=True)
            updater = ExistingRelease(sys.argv[1])
            print(json.dumps(updater.execute()))
    except BaseException:
        print(json.dumps(updater.report if updater else {"deployment_succeeded": False}))
        raise SystemExit(2) from None
