#!/usr/bin/env python3
"""Current-run checked artifact update of the existing Everplain containers.

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
import sqlite3
import stat
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request
from pathlib import Path

from artifact import MAX_BYTES, digest, tree_hash, unpack, validate_manifest
from channel_gateway import GatewayRelease, backend_environment, configuration, nginx_routes
from deploy import Controller, atomic_bytes, check_compatible, copy_index, expected_runtime_mode
from release_identity import (
    SHA,
    load_request,
    read_state,
    snapshot,
    validate_provenance,
    verify_baseline,
)
from repair_existing_web import repair as repair_web

# Set only from the checksum- and current-run-verified manifest in main().
REVISION = None
ARCHIVE_SHA256 = None
API_IMAGE = None
WEB_IMAGE = None
RUN_ID = None
RUN_ATTEMPT = None
BASE = Path("/srv/everplain-updates")
NAMES = {"api": "everplain-api", "web": "everplain-web"}
COMPATIBILITY_DESTINATIONS = {
    "/app/backend/.venv/lib/python3.12/site-packages/qunxue_api/settings.py",
    "/app/ops/preflight.py",
}
DATABASE_FILES = {
    name + suffix
    for name in ("everplain.db", "everplain-retrieval.db")
    for suffix in ("", "-wal", "-shm", "-journal")
}


def require(condition, message="checked release precondition failed"):
    if not condition:
        raise RuntimeError(message)


def check_existing_migration_transition(old, new, policy):
    """Allow reviewed forward-only edges only in this updater's retention model.

    Before candidate start this route restores the untouched old data. After
    candidate start recover() never runs the previous app on the candidate DB.
    The separate rollback-capable Controller must keep using check_compatible.
    Return whether the exact forward-only review was needed, for the report.
    """
    try:
        check_compatible(old, new, policy)
    except ValueError:
        transition = {"from": old["migration_tree"], "to": new["migration_tree"]}
        reviewed = policy.get("reviewed_forward_only_migration_transitions", [])
        if (
            isinstance(reviewed, list)
            and all(isinstance(value, str) and re.fullmatch(r"[0-9a-f]{64}", value)
                    for value in transition.values())
            and transition in reviewed
        ):
            return True
        raise
    return False


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


def reusable_stage(base, *, inputs_only=False):
    for stage in sorted(
        base.glob(REVISION[:8] + "-*"), key=lambda p: p.stat().st_mtime_ns, reverse=True
    ):
        if (
            not stage.is_dir()
            or stage.is_symlink()
            or stage.stat().st_uid != os.geteuid()
            or stage.stat().st_mode & 0o077
            or (
                not inputs_only
                and any(
                    (stage / name).exists() or (stage / name).is_symlink()
                    for name in ("transaction.json", "data", "backups", "online-validation")
                )
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


def link_verified_payload(source_stage, stage, manifest):
    """Reuse only immutable public inputs; never link runtime config, data or backups."""
    source = source_stage / "releases" / REVISION
    target = stage / "releases" / REVISION
    target.mkdir(parents=True)
    for name in {"manifest.json", *manifest["files"]}:
        destination = target / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        os.link(source / name, destination)
    os.link(source_stage / "release.tar.gz", stage / "release.tar.gz")


def copy_preserving_sidecar_owner(source, target):
    owner = source.stat()
    paths = [source.with_name(source.name + suffix) for suffix in ("-wal", "-shm")]
    existed = {path: path.exists() for path in paths}
    try:
        copy_index(source, target)
    finally:
        for path in paths:
            if not existed[path] and path.exists():
                info = path.lstat()
                require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1)
                if info.st_uid == os.geteuid():
                    os.chown(path, owner.st_uid, owner.st_gid)


def copy_primary(source, target, report, prefix="primary_backup_"):
    try:
        # mode=ro prohibits database writes while allowing SQLite's required WAL
        # coordination sidecars on the host. A read-only bind mount prevented this.
        copy_preserving_sidecar_owner(source, target)
        with contextlib.closing(
            sqlite3.connect(target.resolve().as_uri() + "?mode=ro", uri=True)
        ) as db:
            tables = {
                row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")
            }
            require({"users", "alembic_version"} <= tables)
        report[prefix + "complete"] = True
    except sqlite3.Error:
        report[prefix + "sqlite_error"] = True
        raise
    except OSError:
        report[prefix + "io_error"] = True
        raise
    except (ValueError, RuntimeError):
        report[prefix + "validation_error"] = True
        raise


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


def registry_image(expected, reference, role, report):
    value = json.loads(run(["docker", "image", "inspect", reference]))[0]
    # Docker verifies the pinned manifest while pulling. Classic stores expose its
    # config digest as Id; containerd stores expose the manifest digest instead.
    report[role + "_registry_digest_bound"] = reference in value.get("RepoDigests", [])
    report[role + "_registry_identity_matches"] = value.get("Id") in {
        expected, reference.split("@", 1)[1],
    }
    require(report[role + "_registry_digest_bound"])
    require(report[role + "_registry_identity_matches"])
    return value


PULL_FAILURE_SUMMARIES = {
    "authentication": "Registry authentication or authorization failed.",
    "not_found": "Registry image or manifest was not found.",
    "storage": "Local image storage is unavailable.",
    "certificate": "Registry certificate verification failed.",
    "integrity": "Image reference or content verification failed.",
    "rate_limit": "Registry rate limit was reached.",
    "transient_network": "Registry network connection was interrupted.",
    "process_timeout": "Registry pull exceeded its command time budget.",
    "local_command": "Local registry pull command could not start.",
    "unknown": "Registry pull failed for an unclassified reason.",
}


def classify_pull_failure(error):
    """Only fixed labels leave this boundary; never return any provider output."""
    error = error.lower()
    categories = (
        ("storage", ("no space left", "disk quota exceeded", "read-only file system",
                     "permission denied")),
        ("authentication", ("unauthorized", "authentication required", "authentication failed",
                            "failed to authorize", "insufficient_scope", "denied:",
                            "requested access to the resource is denied", "403 forbidden")),
        ("not_found", ("manifest unknown", "not found", "name unknown",
                       "repository does not exist")),
        ("certificate", ("x509:", "certificate signed", "certificate has expired",
                         "certificate is not valid", "tls: failed to verify")),
        ("integrity", ("digest mismatch", "checksum mismatch", "verification failed",
                       "invalid reference format", "unsupported media type")),
        ("rate_limit", ("toomanyrequests", "too many requests")),
        ("transient_network", ("unexpected eof", "connection reset by peer", "connection refused",
                               "tls handshake timeout", "i/o timeout", "connection timed out",
                               "timeout awaiting response headers", "client.timeout exceeded",
                               "network is unreachable", "no route to host",
                               "temporary failure in name resolution")),
    )
    for category, patterns in categories:
        if any(pattern in error for pattern in patterns):
            return category
    return "unknown"


def pull_registry_image(reference, private, role, report):
    """Retry only explicit transport failures, within the existing 600-second pull budget."""
    require(role in {"api", "web", "gateway"})
    require(bool(re.fullmatch(r"ghcr\.io/huyanxius/everplain-" + role + r"@sha256:[0-9a-f]{64}",
                              reference)))
    command = ["docker", "--config", private, "pull", "--platform", "linux/amd64", reference]
    prefix = role + "_pull_"
    deadline = time.monotonic() + 600
    report[prefix + "retry_count"] = 0
    for attempt in range(1, 4):
        report[prefix + "attempts"] = attempt
        report.update({prefix + key: False for key in
                       ("command_succeeded", "exit_1", "no_space", "missing_file",
                        "permission_denied", "unsupported_format", "timed_out")})
        try:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise subprocess.TimeoutExpired(command, 600)
            result = subprocess.run(command, capture_output=True, text=True,
                                    timeout=remaining, check=False)
            error = result.stderr.lower()
            report.update({
                prefix + "command_succeeded": result.returncode == 0,
                prefix + "exit_1": result.returncode == 1,
                prefix + "no_space": "no space left" in error,
                prefix + "missing_file": "no such file" in error,
                prefix + "permission_denied": "permission denied" in error,
                prefix + "unsupported_format": any(word in error for word in
                                                     ("unsupported", "invalid tar",
                                                      "invalid argument", "unrecognized")),
            })
            if result.returncode == 0:
                return result.stdout
            category = classify_pull_failure(error)
        except subprocess.TimeoutExpired:
            category = "process_timeout"
            report[prefix + "timed_out"] = True
        except OSError:
            category = "local_command"
        report[prefix + "last_failure_class"] = category
        report[prefix + "failure_summary"] = PULL_FAILURE_SUMMARIES[category]
        delay = 5 * attempt
        if (category != "transient_network" or attempt == 3
                or deadline - time.monotonic() <= delay):
            raise RuntimeError("registry pull failed (" + category + ")") from None
        report[prefix + "retry_count"] += 1
        time.sleep(delay)


def pull_registry_images(manifest, stage, report, roles=("api", "web")):
    """Use the job's temporary read token; Docker reuses local content-addressed layers."""
    token = sys.stdin.readline(8193).strip()
    require(0 < len(token) <= 8192 and not any(c.isspace() for c in token))
    images = {}
    private = None
    try:
        with tempfile.TemporaryDirectory(prefix="registry-auth-", dir=stage) as private:
            login = subprocess.run(
                ["docker", "--config", private, "login", "ghcr.io", "--username", "huyanxius",
                 "--password-stdin"],
                input=token + "\n", capture_output=True, text=True, timeout=30, check=False,
            )
            report["registry_authentication_succeeded"] = login.returncode == 0
            require(login.returncode == 0, "registry authentication failed")
            for role, reference in manifest["registry_images"].items():
                if role not in roles:
                    continue
                output = pull_registry_image(reference, private, role, report)
                report[role + "_reused_layer_count"] = len(set(re.findall(
                    r"^([a-f0-9]+): Already exists", output, re.MULTILINE)))
                report[role + "_downloaded_layer_count"] = len(set(re.findall(
                    r"^([a-f0-9]+): Pull complete", output, re.MULTILINE)))
                run(["docker", "tag", reference, "everplain-" + role + ":" + REVISION])
                info = registry_image(manifest["images"][role], reference, role, report)
                require(info["Architecture"] == "amd64" and info["Os"] == "linux")
                require(info["Config"]["Labels"].get("org.opencontainers.image.revision")
                        == REVISION)
                images[role] = info["Id"]
                report[role + "_image_verified"] = True
    finally:
        if private is not None:
            report["registry_credentials_removed"] = not Path(private).exists()
    return images


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


def data_entries(source):
    """Only regular files and directories inside the existing product mount are data."""
    entries = []
    pending = sorted(source.iterdir(), reverse=True)
    while pending:
        path = pending.pop()
        info = path.lstat()
        require(path.resolve() == path)
        require(stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode))
        if stat.S_ISDIR(info.st_mode):
            require(path.parent != source or path.name not in DATABASE_FILES)
            pending.extend(sorted(path.iterdir(), reverse=True))
        else:
            require(info.st_nlink == 1)
        entries.append((path, info))
    return entries


def data_bytes(source):
    return sum(info.st_size for _, info in data_entries(source) if stat.S_ISREG(info.st_mode))


def copy_ancillary_data(source, target):
    # Active SQLite files use stopped-writer snapshots. Other material is copied,
    # never linked, so writes to the candidate cannot change the retained old data.
    entries = [
        (path, info) for path, info in data_entries(source)
        if not (path.parent == source and path.name in DATABASE_FILES)
    ]
    for path, info in entries:
        destination = target / path.relative_to(source)
        if stat.S_ISDIR(info.st_mode):
            destination.mkdir(mode=0o700)
        else:
            shutil.copy2(path, destination)
            require(digest(destination) == digest(path))
            current = path.lstat()
            require((current.st_size, current.st_mtime_ns) == (info.st_size, info.st_mtime_ns))
        os.chown(destination, info.st_uid, info.st_gid)
        destination.chmod(stat.S_IMODE(info.st_mode))
    # Restore directory timestamps after children have been created.
    for path, info in reversed(entries):
        destination = target / path.relative_to(source)
        os.utime(destination, ns=(info.st_atime_ns, info.st_mtime_ns))



def configure_billing_policy(current, policy, report):
    """Apply only explicit, checksum-bound additive writing/summary billing policies."""
    user_requested = policy.get("add_user_billing_phases", [])
    operator_requested = policy.get("add_operator_billing_phases", [])
    require(
        user_requested == [] or user_requested == ["writing"],
        "unsupported billing policy update",
    )
    require(
        operator_requested == [] or operator_requested == ["conversation_summary"],
        "unsupported billing policy update",
    )
    report["writing_user_policy_update_requested"] = bool(user_requested)
    report["conversation_summary_operator_policy_update_requested"] = bool(operator_requested)
    report["billing_policy_update_requested"] = bool(user_requested or operator_requested)
    report["billing_policy_changed"] = False
    result = dict(current)
    if not report["billing_policy_update_requested"]:
        return result

    def unique_mapping(pairs):
        value = {}
        for key, item in pairs:
            require(key not in value, "duplicate billing policy entry")
            value[key] = item
        return value

    try:
        phases = json.loads(
            current.get("EVERPLAIN_BILLING_PHASE_POLICIES", "{}"),
            object_pairs_hook=unique_mapping,
        )
    except (ValueError, TypeError):
        raise RuntimeError("existing billing policy requires review") from None
    require(isinstance(phases, dict), "existing billing policy requires review")
    require(
        all(isinstance(k, str) and v in ("user", "operator") for k, v in phases.items()),
        "existing billing policy requires review",
    )
    additions = {}
    if user_requested:
        require(phases.get("writing") in (None, "user"), "existing writing policy requires review")
        if "writing" not in phases:
            additions["writing"] = "user"
    if operator_requested:
        require(
            phases.get("conversation_summary") in (None, "operator"),
            "existing conversation summary policy requires review",
        )
        if "conversation_summary" not in phases:
            additions["conversation_summary"] = "operator"
    if additions:
        phases.update(additions)
        result["EVERPLAIN_BILLING_PHASE_POLICIES"] = json.dumps(
            phases, sort_keys=True, separators=(",", ":")
        )
        report["billing_policy_changed"] = True
    return result


def verify_live_overlays(api, policy):
    reviewed = policy.get("reviewed_live_file_overlays", {})
    require(set(reviewed) <= COMPATIBILITY_DESTINATIONS)
    for mount in api["Mounts"]:
        if mount["Destination"] == "/data":
            continue
        path = Path(mount["Source"])
        require(mount["Type"] == "bind" and not mount["RW"])
        require(path.is_absolute() and path.resolve() == path and path.is_file())
        require(path.stat().st_size < 1024**2)
        require(mount["Destination"] in reviewed)
        require(digest(path) == reviewed[mount["Destination"]], "unreviewed live source overlay")


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
    mounts = [item for item in api["Mounts"] if item["Destination"] == "/data"]
    require(all(item["Destination"] == "/data" or (
        item["Destination"] in COMPATIBILITY_DESTINATIONS
        and item["Type"] == "bind" and not item["RW"]
    ) for item in api["Mounts"]))
    require(len(mounts) == 1 and mounts[0]["Destination"] == "/data" and mounts[0]["RW"])
    mount = mounts[0]
    require(mount["Type"] in {"volume", "bind"})
    if mount["Type"] == "volume":
        require(mount.get("Name", "").startswith("everplain"))
    source = Path(mount["Source"])
    require(source.is_absolute() and source.resolve() == source)
    require(any(part.startswith("everplain") for part in source.parts))
    require((source / "everplain.db").is_file())
    data_entries(source)
    environment(api)
    return source, api_network


def save_json(path, value):
    atomic_bytes(path, (json.dumps(value, indent=2) + "\n").encode())


def http(url):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    request = urllib.request.Request(url, headers={"User-Agent": "Everplain-Release/1.0"})
    with opener.open(request, timeout=5) as response:
        require(response.url == url and response.status == 200)
        return response.read(16 * 1024**2 + 1)


def public_health(manifest, mode, api_revision=None):
    for _attempt in range(12):
        try:
            health = json.loads(http("https://e.qunxue.xyz/api/health?revision=" + REVISION))
            require(health.get("status") == "ok"
                    and health.get("release_revision") == (api_revision or REVISION))
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
        self.gateway = None
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
                "forward_only_migration_review_verified",
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

    def complete(self, manifest):
        actual = snapshot(run, metadata)
        if self.report.get("billing_policy_update_requested"):
            active_env = environment(metadata(NAMES["api"]))
            require(
                active_env.get("EVERPLAIN_BILLING_PHASE_POLICIES") == self.expected_billing_policy,
                "activated billing policy differs from reviewed update",
            )
            if self.report.get("writing_user_policy_update_requested"):
                self.report["writing_user_policy_verified"] = True
            if self.report.get("conversation_summary_operator_policy_update_requested"):
                self.report["conversation_summary_operator_policy_verified"] = True
        require(actual["api"] == manifest["runtime_identity"]["api"])
        require(actual["web_tree"] == manifest["runtime_identity"]["web_tree"])
        require(actual["api_image"] in {API_IMAGE, self.images["api"]})
        require(actual["web_image"] in {WEB_IMAGE, self.images["web"]})
        save_json(self.state_path, {
            "format": 1, "application": "everplain", "revision": REVISION,
            "run_id": int(RUN_ID), "run_attempt": int(RUN_ATTEMPT),
            "archive_sha256": ARCHIVE_SHA256, "runtime": actual,
        })
        self.report["runtime_identity_verified"] = True

    def recover(self):
        # After API start, even background writes belong to the new database/schema.
        if self.started and self.report.get("candidate_local_acceptance_verified"):
            # A remote edge rejection must not take a locally verified service down.
            self.report["candidate_kept_running"] = True
        elif self.started:
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
                    direct = json.loads(http("http://127.0.0.1:8297/api/health"))
                    require(direct.get("status") == "ok")
                    require(direct.get("release_revision") == self.old_revision)
                    break
                except Exception:
                    if attempt == 11:
                        raise RuntimeError("previous API readiness failed") from None
                    time.sleep(2)
            repair_web()
            self.report["old_web_upstream_repaired"] = True
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
        if self.gateway is not None:
            self.gateway.recover(api_kept_running=self.report.get(
                "candidate_local_acceptance_verified", False))
        self.record()

    def activate_web_only(self, manifest, api, web, network):
        """Replace Web while API, its configuration and its live data mount keep running."""
        require(len(web["Mounts"]) == 1
                and web["Mounts"][0]["Destination"] == "/etc/nginx/conf.d/default.conf")
        require(snapshot(run, metadata) == self.baseline)
        require(read_state(self.state_path, os.geteuid()) == self.previous_state)
        run(["docker", "run", "--rm", "--network", network,
             "--volumes-from", web["Id"] + ":ro", "--entrypoint", "nginx",
             self.images["web"], "-t"])
        stopped, renamed = False, False
        self.report["web_only_release"] = True
        try:
            stopped = True
            run(["docker", "stop", "--time", "45", NAMES["web"]])
            run(["docker", "rename", NAMES["web"], self.old_names["web"]])
            renamed = True
            run(["docker", "run", "-d", "--name", NAMES["web"], "--restart", "unless-stopped",
                 "--network", network, "--security-opt", "no-new-privileges:true",
                 "-p", "127.0.0.1:5196:8080", "--volumes-from", self.old_names["web"] + ":ro",
                 self.images["web"]])
            public_health(manifest, environment(api)["EVERPLAIN_RUNTIME_MODE"], self.old_revision)
            active_api = metadata(NAMES["api"])
            require(active_api["Id"] == api["Id"] and active_api["State"]["Running"])
            require(active_api["Config"] == api["Config"] and active_api["Mounts"] == api["Mounts"])
            self.report["api_unchanged_verified"] = True
            self.complete(manifest)
            self.report.update(api_health_ok=True, web_health_ok=True, public_health_ok=True,
                               deployment_succeeded=True)
            self.record()
            return self.report
        except BaseException:
            if renamed:
                with contextlib.suppress(Exception):
                    run(["docker", "rm", "-f", NAMES["web"]])
                run(["docker", "rename", self.old_names["web"], NAMES["web"]])
            if stopped:
                run(["docker", "start", NAMES["web"]])
                self.report["old_service_restored"] = True
            self.record()
            raise

    def execute(self):
        api, web = metadata(NAMES["api"]), metadata(NAMES["web"])
        source, network = existing_layout(api, web)
        old_env = environment(api)
        require(bool(SHA.fullmatch(old_env.get("EVERPLAIN_RELEASE_REVISION", ""))))
        self.old_revision = old_env["EVERPLAIN_RELEASE_REVISION"]
        self.report["live_layout_verified"] = True
        self.base.mkdir(mode=0o700, exist_ok=True)
        require(
            self.base.is_dir() and not self.base.is_symlink() and self.base.resolve() == self.base
        )
        require(self.base.stat().st_uid == os.geteuid() and self.base.stat().st_mode & 0o022 == 0)
        total_data_bytes = data_bytes(source)
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
            # A used candidate is never resumed. Only its checksum-verified immutable
            # input files may seed a fresh stage, with separate new data/config paths.
            inputs = reusable_stage(self.base, inputs_only=True)
            if inputs:
                source_stage, manifest = inputs
                self.stage = Path(tempfile.mkdtemp(prefix=REVISION[:8] + "-", dir=self.base))
                link_verified_payload(source_stage, self.stage, manifest)
                frozen = self.stage / "release.tar.gz"
                release = self.stage / "releases" / REVISION
                self.report["immutable_payload_reused"] = True
            else:
                require(
                    shutil.disk_usage(self.base).free
                    > archive_bytes + MAX_BYTES + total_data_bytes * 3 + reserve
                )
                self.report["copy_budget_verified"] = True
                self.stage = Path(tempfile.mkdtemp(prefix=REVISION[:8] + "-", dir=self.base))
                frozen = self.stage / "release.tar.gz"
                shutil.copyfile(self.archive, frozen)
                release = self.stage / "releases" / REVISION
                release.parent.mkdir()
                manifest = unpack(frozen, release, REVISION, ARCHIVE_SHA256)
        self.old_names = {role: NAMES[role] + "-before-" + self.stage.name for role in NAMES}
        require(manifest["images"].get("api") == API_IMAGE
                and manifest["images"].get("web") == WEB_IMAGE)
        validate_provenance(manifest, REVISION, RUN_ID, RUN_ATTEMPT)
        self.state_path = self.base / "pipeline-state.json"
        self.previous_state = read_state(self.state_path, os.geteuid())
        self.report["baseline_available"] = (
            self.previous_state is not None or manifest.get("initial_live_fingerprint") is not None
        )
        self.baseline = snapshot(run, metadata)
        verify_baseline(
            self.baseline, self.previous_state, manifest.get("initial_live_fingerprint"),
            REVISION, RUN_ID, ARCHIVE_SHA256,
        )
        policy = json.loads((release / "ops/cd/policy.json").read_text())
        verify_live_overlays(api, policy)
        env = configure_billing_policy(old_env, policy, self.report)
        channel_values = configuration() if "gateway" in manifest["images"] else None
        self.report["channel_configured"] = channel_values is not None
        if channel_values is not None:
            env = backend_environment(env, channel_values)
        self.expected_billing_policy = env.get("EVERPLAIN_BILLING_PHASE_POLICIES")
        self.report["forward_only_migration_review_verified"] = check_existing_migration_transition(
            {"migration_tree": self.baseline["api"]["migration_tree"]}, manifest, policy,
        )
        self.report["live_overlay_guard_verified"] = True
        self.report["artifact_verified"] = True
        registry = "registry_images" in manifest
        web_only = (registry and manifest["runtime_identity"]["api"] == self.baseline["api"]
                    and env == old_env and channel_values is None)
        image_bytes = (sum(manifest["image_sizes"].values()) if registry else sum(
            (release / "images" / (role + ".tar")).stat().st_size for role in ("api", "web")
        ))
        remaining_budget = image_bytes * 3 + total_data_bytes * 3 + reserve
        docker_root = Path(run(["docker", "info", "--format", "{{.DockerRootDir}}"]).strip())
        require(docker_root.is_absolute() and docker_root.is_dir())
        # Check both destinations with a combined budget, including on shared filesystems.
        require(shutil.disk_usage(self.base).free > remaining_budget)
        self.report["stage_load_budget_verified"] = True
        require(shutil.disk_usage(docker_root).free > remaining_budget)
        self.report["docker_load_budget_verified"] = True
        roles = ("api", "web", "gateway") if channel_values is not None else ("api", "web")
        if registry:
            self.images = pull_registry_images(manifest, self.stage, self.report,
                                               ("web",) if web_only else roles)
            if web_only:
                self.images["api"] = api["Image"]
        for role, image in (() if registry else
                            ((role, manifest["images"][role]) for role in roles)):
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
        if channel_values is not None:
            self.gateway = GatewayRelease(values=channel_values, image=self.images["gateway"],
                                          revision=REVISION, stage=self.stage, network=network,
                                          run=run, metadata=metadata, atomic=atomic_bytes,
                                          report=self.report)
            self.gateway.prepare()
        if web_only:
            return self.activate_web_only(manifest, api, web, network)
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
            > frozen.stat().st_size * 3 + data_bytes(source) * 3
        )
        self.report["backup_budget_verified"] = True
        validation = self.stage / "online-validation"
        validation.mkdir(mode=0o700)
        copy_primary(
            source / "everplain.db",
            validation / "everplain.db",
            self.report,
            prefix="online_backup_",
        )
        # The online snapshot only proves capability. Final cutover data is backed
        # up independently after stopping writers, never copied from this snapshot.
        require(
            shutil.disk_usage(self.base).free
            > data_bytes(source) * 2 + reserve
        )
        self.record()
        if (
            self.old_revision == REVISION
            and channel_values is None
            and not self.report.get("billing_policy_changed")
            and api.get("Image") == self.images["api"]
            and web.get("Image") == self.images["web"]
        ):
            Controller(self.stage).health(REVISION)
            public_health(manifest, mode)
            self.complete(manifest)
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
        # Catch a manual overlay or another writer between inspection and cutover.
        require(snapshot(run, metadata) == self.baseline)
        require(read_state(self.state_path, os.geteuid()) == self.previous_state)
        try:
            # Only these exact Everplain containers are stopped; old containers/config stay intact.
            self.stopped = True
            self.report["service_stop_started"] = True
            if self.gateway is not None:
                self.gateway.stop()
            run(["docker", "stop", "--time", "45", NAMES["web"], NAMES["api"]])
            self.record()
            backups, data = self.stage / "backups", self.stage / "data"
            backups.mkdir(mode=0o700)
            data.mkdir(mode=stat.S_IMODE(source.stat().st_mode))
            os.chown(data, source.stat().st_uid, source.stat().st_gid)
            copy_primary(source / "everplain.db", backups / "everplain.db", self.report)
            for name in ("everplain.db", "everplain-retrieval.db"):
                origin, target = source / name, data / name
                if not origin.exists():
                    continue
                backup = backups / name
                if name != "everplain.db":
                    copy_preserving_sidecar_owner(origin, backup)
                    self.report["retrieval_backup_complete"] = True
                copy_index(backup, target)
                self.report[
                    "primary_candidate_copied"
                    if name == "everplain.db"
                    else "retrieval_candidate_copied"
                ] = True
                info = origin.stat()
                os.chown(target, info.st_uid, info.st_gid)
                target.chmod(stat.S_IMODE(info.st_mode))
            copy_ancillary_data(source, data)
            self.report["ancillary_data_preserved"] = True
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
            if self.gateway is not None:
                config = nginx_routes(config, self.gateway.start())
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
            self.complete(manifest)
            self.report["candidate_local_acceptance_verified"] = True
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
        require(os.geteuid() == 0 and len(sys.argv) == 6)
        archive, REVISION, ARCHIVE_SHA256, RUN_ID, RUN_ATTEMPT = sys.argv[1:]
        request = load_request(Path(archive), REVISION, ARCHIVE_SHA256, RUN_ID, RUN_ATTEMPT)
        API_IMAGE, WEB_IMAGE = request["images"]["api"], request["images"]["web"]
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
