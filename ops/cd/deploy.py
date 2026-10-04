#!/usr/bin/env python3
"""Root-owned, fixed Everplain release controller. Install once; never run from incoming/."""

import argparse
import contextlib
import fcntl
import hashlib
import json
import os
import platform
import re
import shutil
import signal
import sqlite3
import stat
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

from artifact import SHA, digest, unpack

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from database import copy_database  # noqa: E402

ROOT = Path("/srv/everplain")
CONFIG = Path("/etc/everplain/deploy.json")
ENV_FILE = Path("/etc/everplain/production.env")


def atomic_bytes(target, value, reference=None, mode=0o600):
    """Replace content while explicitly retaining uid/gid/mode; copy2 is insufficient."""
    source = reference or (target if target.exists() else None)
    metadata = source.stat() if source else None
    descriptor, name = tempfile.mkstemp(prefix=".everplain-", dir=target.parent)
    temporary = Path(name)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(value)
            stream.flush()
            if metadata:
                os.fchown(stream.fileno(), metadata.st_uid, metadata.st_gid)
            os.fchmod(stream.fileno(), stat.S_IMODE(metadata.st_mode) if metadata else mode)
            os.fsync(stream.fileno())
        os.replace(temporary, target)
        sync_directory(target.parent)
    finally:
        temporary.unlink(missing_ok=True)


def sync_directory(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def atomic_link(target, destination):
    previous = target.lstat() if target.is_symlink() else None
    temporary = target.with_name(".current-" + str(os.getpid()))
    temporary.symlink_to(destination)
    try:
        if previous:
            os.chown(temporary, previous.st_uid, previous.st_gid, follow_symlinks=False)
        os.replace(temporary, target)
        sync_directory(target.parent)
    finally:
        temporary.unlink(missing_ok=True)


def runtime_bytes(source, revision, database):
    # dotenv's last definition wins. Original values/format stay private on the host.
    return (
        source
        + (
            f"\nEVERPLAIN_RELEASE_REVISION={revision}\n"
            "EVERPLAIN_DATABASE_URL=sqlite:////data/everplain.db\n"
            "EVERPLAIN_RETRIEVAL_INDEX_PATH=/data/everplain-retrieval.db\n"
            "EVERPLAIN_MIGRATIONS_MANAGED=1\n"
        ).encode()
    )


def check_compatible(old, new, policy):
    transition = {"from": old["migration_tree"], "to": new["migration_tree"]}
    reviewed = policy.get("reviewed_migration_transitions", [])
    exact_transition = isinstance(reviewed, list) and transition in reviewed
    if (
        old["migration_tree"] != new["migration_tree"]
        and not exact_transition
        and old["migration_tree"] not in policy.get("rollback_compatible_migration_trees", [])
    ):
        raise ValueError(
            "migration change lacks reviewed rollback compatibility; use maintenance plan"
        )


def runtime_environment(release):
    """Read only the protected, host-generated Docker env file, never HTTP claims."""
    path = release / "runtime.env"
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid() or info.st_mode & 0o027:
        raise ValueError("release runtime environment must be private and controller-owned")
    values = {}
    for line in path.read_text().splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        name, separator, value = line.partition("=")
        if not separator or not re.fullmatch(r"[A-Z0-9_]+", name):
            raise ValueError("runtime environment must use literal Docker NAME=value lines")
        values[name] = value
    return values


def expected_runtime_mode(release):
    values = runtime_environment(release)
    if values.get("EVERPLAIN_RUNTIME_MODE", "base") != "base":
        raise ValueError("release requires the real business backend runtime")
    fallback = values.get("EVERPLAIN_ALLOW_MODEL_FALLBACK", "").lower() in {
        "true", "1", "yes", "on",
    }
    if fallback and not values.get("EVERPLAIN_MODEL_API_KEY", "").strip():
        return "mock"
    return "base"


def copy_index(source, target):
    """Consistent snapshot of the separate derived retrieval SQLite, never raw-copy WAL."""
    if target.exists() or source.is_symlink() or not source.is_file():
        raise ValueError("invalid retrieval snapshot source/destination")
    descriptor, name = tempfile.mkstemp(prefix=".everplain-index-", dir=target.parent)
    os.close(descriptor)
    temporary = Path(name)
    try:
        with (
            contextlib.closing(
                sqlite3.connect(source.resolve().as_uri() + "?mode=ro", uri=True)
            ) as origin,
            contextlib.closing(sqlite3.connect(temporary)) as snapshot,
        ):
            origin.backup(snapshot, pages=256, sleep=0.05)
            snapshot.execute("PRAGMA journal_mode=DELETE")
            if snapshot.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
                raise ValueError("retrieval snapshot integrity failure")
            if snapshot.execute("PRAGMA foreign_key_check").fetchone() is not None:
                raise ValueError("retrieval snapshot foreign key failure")
        temporary.chmod(0o600)
        with temporary.open("rb") as handle:
            os.fsync(handle.fileno())
        os.link(temporary, target)
        sync_directory(target.parent)
    finally:
        temporary.unlink(missing_ok=True)


@contextlib.contextmanager
def recovery_signals():
    signals = (signal.SIGINT, signal.SIGTERM, signal.SIGHUP)
    previous = {number: signal.signal(number, signal.SIG_IGN) for number in signals}
    try:
        yield
    finally:
        for number, handler in previous.items():
            signal.signal(number, handler)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, file_pointer, code, message, headers, new_url):
        raise ValueError("health endpoint redirected")


class Controller:
    def __init__(self, root=ROOT):
        self.root = root
        self.journal = root / "transaction.json"
        self.state_path = root / "state.json"
        self.uid = self.gid = 10001
        self.active_database = None
        self.public_url = "https://e.qunxue.xyz"

    def write_json(self, path, value):
        atomic_bytes(path, (json.dumps(value, sort_keys=True) + "\n").encode())

    def state(self):
        value = json.loads(self.state_path.read_text())
        if not SHA.fullmatch(value["current"]):
            raise ValueError("invalid provisioned current release")
        self.database_path(value["database"])
        if self.current().name != value["current"]:
            raise ValueError("current pointer and state disagree; recover transaction first")
        return value

    def database_path(self, value):
        path = Path(value)
        if (
            not path.is_absolute()
            or path.resolve() != path
            or not path.is_relative_to(self.root / "data")
            or path.name != "everplain.db"
        ):
            raise ValueError("database must be a dedicated non-symlink Everplain data path")
        return path

    def current(self):
        path = self.root / "current"
        if not path.is_symlink():
            raise ValueError("one-time release layout not provisioned: current symlink missing")
        resolved = path.resolve(strict=True)
        if resolved.parent != self.root / "releases" or not SHA.fullmatch(resolved.name):
            raise ValueError("current must point to a versioned Everplain release")
        return resolved

    def manifest(self, release):
        return json.loads((release / "manifest.json").read_text())

    def command(self, args, purpose, *, cwd=None):
        result = subprocess.run(
            args,
            cwd=cwd,
            env={
                "PATH": "/usr/local/bin:/usr/bin:/bin",
                "LANG": "C.UTF-8",
                "PYTHONDONTWRITEBYTECODE": "1",
            },
            capture_output=True,
            text=True,
            timeout=180,
            check=False,
        )
        if result.returncode:
            # Never forward command output: settings/pip/provider exceptions can contain secrets.
            if purpose == "preflight":
                try:
                    fields = json.loads(result.stdout).get("invalid_fields", [])
                    safe = [name for name in fields if re.fullmatch(r"[A-Z0-9_]+", name)]
                except (ValueError, TypeError):
                    safe = []
                raise ValueError("production preflight failed; invalid fields: " + ",".join(safe))
            raise RuntimeError(
                f"{purpose} failed (exit {result.returncode}); inspect private host logs"
            )
        return result.stdout

    def service(self, name, action):
        if name not in {"api", "web"} or action not in {"start", "stop"}:
            raise ValueError("unsupported service action")
        container = f"everplain-{name}"
        if action == "stop":
            check = subprocess.run(
                [
                    "/usr/bin/docker",
                    "container",
                    "inspect",
                    "--format",
                    '{{index .Config.Labels "org.everplain.managed"}}',
                    container,
                ],
                capture_output=True,
                text=True,
                timeout=15,
                check=False,
            )
            if check.returncode:
                # Distinguish an absent container from an unavailable Docker daemon.
                self.command(
                    ["/usr/bin/docker", "info", "--format", "{{.ServerVersion}}"],
                    "Docker availability",
                )
                return
            if check.stdout.strip() != "release-v1":
                raise ValueError("container is not adopted into the Everplain release layout")
            self.command(["/usr/bin/docker", "stop", "--time", "45", container], f"{name} stop")
            self.command(["/usr/bin/docker", "rm", container], f"{name} remove stopped container")
            return
        release = self.current()
        manifest = self.manifest(release)
        args = [
            "/usr/bin/docker",
            "run",
            "-d",
            "--name",
            container,
            "--restart",
            "unless-stopped",
            "--network",
            "everplain-production",
            "--label",
            "org.everplain.managed=release-v1",
            "--label",
            f"org.everplain.revision={release.name}",
            "--security-opt",
            "no-new-privileges:true",
            "--log-opt",
            "max-size=10m",
            "--log-opt",
            "max-file=3",
        ]
        if name == "api":
            database = self.active_database
            if database is None:
                raise ValueError("active database path has not been selected")
            args += [
                "--network-alias",
                "api",
                "-p",
                "127.0.0.1:8297:8297",
                "--env-file",
                str(release / "runtime.env"),
                "--mount",
                f"type=bind,src={database.parent},dst=/data",
            ]
        else:
            args += ["-p", "127.0.0.1:5196:8080"]
        self.command([*args, manifest["images"][name]], f"{name} start")

    def app(self, release, action):
        image = self.manifest(release)["images"]["api"]
        args = [
            "/usr/bin/docker",
            "run",
            "--rm",
            "--network",
            "none",
            "--security-opt",
            "no-new-privileges:true",
        ]
        if action == "migrate":
            if self.active_database is None:
                raise ValueError("migration database not selected")
            args += [
                "--env",
                "EVERPLAIN_RUNTIME_MODE=mock",
                "--env",
                "EVERPLAIN_DATABASE_URL=sqlite:////data/everplain.db",
                "--mount",
                f"type=bind,src={self.active_database.parent},dst=/data",
                "--entrypoint",
                "alembic",
                image,
                "upgrade",
                "head",
            ]
        elif action == "preflight":
            args += [
                "--env-file",
                str(release / "runtime.env"),
                "--entrypoint",
                "python",
                image,
                "/app/ops/preflight.py",
            ]
        else:
            raise ValueError("unsupported runtime operation")
        self.command(args, action)

    def prepare(self, release):
        manifest = self.manifest(release)
        for role in ("api", "web"):
            self.command(
                ["/usr/bin/docker", "load", "--input", release / "images" / f"{role}.tar"],
                "load immutable image",
            )
            image = manifest["images"][role]
            result = json.loads(
                self.command(["/usr/bin/docker", "image", "inspect", image], "image identity")
            )[0]
            if (
                result["Id"] != image
                or result["Architecture"] != "amd64"
                or result["Os"] != "linux"
                or result["Config"]["Labels"].get("org.opencontainers.image.revision")
                != release.name
            ):
                raise ValueError("loaded image identity/runtime mismatch")

    def health(self, revision, public=False, web=True):
        # Explicit model fallback can coexist with the real business backend.
        # Derive the expected model mode from private configuration before HTTP.
        expected_mode = expected_runtime_mode(self.root / "releases" / revision)
        endpoints = [("http://127.0.0.1:8297/api/health", "release_revision")]
        frontends = []
        if web:
            frontends.append("http://127.0.0.1:5196")
        if public:
            frontends.append(self.public_url)
        for base in frontends:
            endpoints += [
                (base + "/revision.json", "revision"),
                (base + "/api/health", "release_revision"),
            ]
        checks = self.manifest(self.root / "releases" / revision)["web_checks"]
        opener = urllib.request.build_opener(NoRedirect())

        def fetch(url):
            request = urllib.request.Request(
                url + "?revision=" + revision,
                headers={"Cache-Control": "no-cache", "Accept-Encoding": "identity"},
            )
            with opener.open(request, timeout=3) as response:
                body = response.read(16 * 1024**2 + 1)
            if len(body) > 16 * 1024**2:
                raise ValueError("health response exceeded bound")
            return body

        for attempt in range(12):
            try:
                for url, field in endpoints:
                    body = json.loads(fetch(url))
                    if body.get(field) != revision:
                        raise ValueError("revision mismatch")
                    if field == "release_revision" and (
                        body.get("status") != "ok" or body.get("runtime_mode") != expected_mode
                    ):
                        raise ValueError("API does not match the configured model runtime")
                for base in frontends:
                    for path, checksum in checks.items():
                        if hashlib.sha256(fetch(base + path)).hexdigest() != checksum:
                            raise ValueError("frontend byte fingerprint mismatch")
                return
            except (OSError, ValueError):
                if attempt == 11:
                    raise RuntimeError(
                        "health/revision/frontend checks failed; no model smoke request was made"
                    ) from None
                time.sleep(2)

    def validate_host(self):
        if os.geteuid() != 0:
            raise ValueError("controller requires the explicitly provisioned privileged launcher")
        for path in (CONFIG, ENV_FILE):
            info = path.lstat()
            if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o027:
                raise ValueError(
                    "host configuration must be a root-owned regular file, mode 0600 or 0640"
                )
        settings = json.loads(CONFIG.read_text())
        if settings != {
            "format": 1,
            "application": "everplain",
            "public_url": self.public_url,
            "single_writer": True,
            "ingress_only_web": True,
            "layout_ready": True,
        }:
            raise ValueError("one-time host setup assertions missing or unsupported")
        if platform.machine() != "x86_64" or sys.version_info < (3, 11):
            raise ValueError("controller requires Linux x86_64 and host Python >= 3.11")
        network = json.loads(
            self.command(
                ["/usr/bin/docker", "network", "inspect", "everplain-production"],
                "pre-provisioned application network",
            )
        )[0]
        if (
            network.get("Driver") != "bridge"
            or network.get("Labels", {}).get("org.everplain.managed") != "release-v1"
        ):
            raise ValueError("dedicated Everplain network not provisioned")
        for folder in (
            self.root,
            self.root / "releases",
            self.root / "backups",
            self.root / "data",
        ):
            info = folder.lstat()
            if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
                raise ValueError(
                    "release/data/backup parents must be root-owned and non-writable by runtime"
                )
        if self.journal.exists():
            raise ValueError(
                "interrupted transaction detected; run rollback-previous recovery before deployment"
            )

    def validate_active(self, state):
        """Verify the real containers still match recorded revision, bindings and data."""
        release = self.current()
        manifest = self.manifest(release)
        expected_env = runtime_environment(release)
        for role, port, inside in (("api", "8297", "8297/tcp"), ("web", "5196", "8080/tcp")):
            container = json.loads(
                self.command(
                    ["/usr/bin/docker", "container", "inspect", f"everplain-{role}"],
                    "current runtime configuration",
                )
            )[0]
            config, host = container["Config"], container["HostConfig"]
            labels = config.get("Labels", {})
            if (
                container["Image"] != manifest["images"][role]
                or labels.get("org.everplain.managed") != "release-v1"
                or labels.get("org.everplain.revision") != release.name
                or host.get("Privileged")
                or host.get("PortBindings") != {inside: [{"HostIp": "127.0.0.1", "HostPort": port}]}
                or set(container["NetworkSettings"]["Networks"]) != {"everplain-production"}
            ):
                raise ValueError(
                    "current container identity/bindings drifted; operator reconciliation required"
                )
            mounts = container.get("Mounts", [])
            if role == "api":
                if (
                    len(mounts) != 1
                    or mounts[0]["Type"] != "bind"
                    or mounts[0]["Destination"] != "/data"
                    or not mounts[0]["RW"]
                    or Path(mounts[0]["Source"]) != self.database_path(state["database"]).parent
                ):
                    raise ValueError("current API data mount differs from recorded backup source")
                actual_env = dict(item.split("=", 1) for item in config["Env"])
                if any(actual_env.get(name) != value for name, value in expected_env.items()):
                    raise ValueError(
                        "current API environment differs from private release configuration"
                    )
                aliases = (
                    container["NetworkSettings"]["Networks"]["everplain-production"].get("Aliases")
                    or []
                )
                if "api" not in aliases:
                    raise ValueError("current API network alias missing")
            elif mounts:
                raise ValueError("immutable web container unexpectedly has host mounts")

    def restore(self, tx):
        old = self.root / "releases" / tx["old"]["current"]
        # Background workers start with the API, before public ingress. Retain all
        # candidate writes from that point and roll back only compatible app/config.
        database = self.database_path(
            tx["database"] if tx["runtime_started"] else tx["old"]["database"]
        )
        self.service("web", "stop")
        self.service("api", "stop")
        saved = self.root / "backups" / tx["config_snapshot"]
        restored = runtime_bytes(saved.read_bytes(), old.name, database)
        atomic_bytes(old / "runtime.env", restored, reference=saved)
        atomic_link(self.root / "current", old)
        self.active_database = database
        self.service("api", "start")
        self.health(old.name, web=False)
        self.service("web", "start")
        self.health(old.name, public=True)
        database_tree = (
            tx["candidate_database_tree"]
            if tx["runtime_started"]
            else tx["old"].get("database_migration_tree", self.manifest(old)["migration_tree"])
        )
        previous = dict(
            tx["old"],
            database=str(database),
            database_migration_tree=database_tree,
            last_run_id=tx["run_id"],
        )
        self.write_json(self.state_path, previous)
        self.journal.unlink()
        sync_directory(self.root)

    def activate(self, release, database, state, run_id, *, migrate):
        self.disk_preflight(state, 0)
        old = self.current()
        transaction_id = f"{run_id}-{release.name}-{time.time_ns()}"
        snapshot_name = transaction_id + "-runtime.env"
        snapshot = self.root / "backups" / snapshot_name
        if snapshot.exists():
            raise ValueError("transaction snapshot already exists; recover or use a new run")
        atomic_bytes(snapshot, (old / "runtime.env").read_bytes(), reference=old / "runtime.env")
        tx = {
            "old": state,
            "candidate": release.name,
            "database": str(database),
            "runtime_started": False,
            "config_snapshot": snapshot_name,
            "run_id": run_id,
            "candidate_database_tree": (
                self.manifest(release)["migration_tree"]
                if migrate
                else state.get("database_migration_tree", self.manifest(old)["migration_tree"])
            ),
        }
        self.write_json(self.journal, tx)
        try:
            self.service("web", "stop")
            self.service("api", "stop")
            original = self.database_path(state["database"])
            backup = self.root / "backups" / f"{transaction_id}.sqlite3"
            copy_database(original, backup)
            index = original.parent / "everplain-retrieval.db"
            index_backup = self.root / "backups" / f"{transaction_id}-retrieval.sqlite3"
            if index.exists():
                copy_index(index, index_backup)
            self.active_database = database
            if migrate:
                database.parent.mkdir(mode=0o750)
                os.chown(database.parent, self.uid, self.gid)
                copy_database(backup, database)
                info = original.stat()
                os.chown(database, info.st_uid, info.st_gid)
                database.chmod(stat.S_IMODE(info.st_mode))
                if index.exists():
                    candidate_index = database.parent / "everplain-retrieval.db"
                    copy_index(index_backup, candidate_index)
                    index_info = index.stat()
                    os.chown(candidate_index, index_info.st_uid, index_info.st_gid)
                    candidate_index.chmod(stat.S_IMODE(index_info.st_mode))
                self.app(release, "migrate")
            atomic_link(self.root / "current", release)
            # Persist BEFORE API startup: background workers can write/call providers even
            # while web is closed. Never discard those writes on a failed API health check.
            tx["runtime_started"] = True
            self.write_json(self.journal, tx)
            self.service("api", "start")
            self.health(release.name, web=False)
            self.service("web", "start")
            self.health(release.name, public=True)
            self.write_json(
                self.state_path,
                {
                    "current": release.name,
                    "previous": old.name,
                    "database": str(database),
                    "last_run_id": run_id,
                    "database_migration_tree": (
                        self.manifest(release)["migration_tree"]
                        if migrate
                        else state.get(
                            "database_migration_tree", self.manifest(old)["migration_tree"]
                        )
                    ),
                },
            )
            self.journal.unlink()
            sync_directory(self.root)
            return backup.name
        except BaseException:
            try:
                with recovery_signals():
                    self.restore(tx)
            except BaseException:
                # Keep journal and both databases for bounded recovery; never erase evidence.
                with contextlib.suppress(Exception):
                    self.service("web", "stop")
                raise RuntimeError(
                    "deployment failed; rollback failed; ingress stopped, transaction retained"
                ) from None
            raise RuntimeError(
                "deployment failed; previous app/config restored and health checked"
            ) from None

    def disk_preflight(self, state, archive_size):
        database = self.database_path(state["database"])
        allowed = {
            name + suffix
            for name in ("everplain.db", "everplain-retrieval.db")
            for suffix in ("", "-wal", "-shm", "-journal")
        }
        if any(
            path.name not in allowed or path.is_symlink() or not path.is_file()
            for path in database.parent.iterdir()
        ):
            raise ValueError(
                "unrecognized durable data sibling; add an explicit snapshot policy "
                "before deployment"
            )
        # Inventory both databases and committed WAL bytes; no derived state is discarded.
        source_size = sum(path.stat().st_size for path in database.parent.iterdir())
        reserve = source_size * 3 + 256 * 1024**2
        # Separate data/backup mounts must each have room, not just the release filesystem.
        for path, amount in (
            (self.root, reserve + archive_size * 3),
            (self.root / "data", reserve),
            (self.root / "backups", reserve),
        ):
            if shutil.disk_usage(path).free < amount:
                raise ValueError(
                    "insufficient space for artifact, database/WAL snapshot "
                    "and independent candidate"
                )

    def deploy(self, revision, checksum, run_id):
        state = self.state()
        if run_id < state["last_run_id"]:
            raise ValueError("stale workflow run rejected")
        self.validate_active(state)
        if state["current"] == revision:
            self.health(revision, public=True)
            return {
                "status": "already_active",
                "revision": revision,
                "runtime_mode": expected_runtime_mode(self.current()),
                "providers": "not_exercised",
            }
        release = self.root / "releases" / revision
        archive = self.root / "incoming" / f"{run_id}-{revision}.tar.gz"
        if archive.is_symlink() or not archive.is_file():
            raise ValueError("expected a regular uploaded artifact")
        # Freeze a private copy so the transport account cannot race verification/extraction.
        self.disk_preflight(state, archive.stat().st_size)
        with tempfile.TemporaryDirectory(prefix=".artifact-", dir=self.root) as temporary:
            frozen = Path(temporary) / "release.tar.gz"
            shutil.copyfile(archive, frozen)
            candidate = Path(temporary) / "release"
            manifest = unpack(frozen, candidate, revision, checksum)
            if release.exists():
                if self.manifest(release) != manifest or any(
                    digest(release / name) != checksum
                    for name, checksum in manifest["files"].items()
                ):
                    raise ValueError("immutable release already exists with different content")
            else:
                os.rename(candidate, release)
                sync_directory(release.parent)
        try:
            old = self.manifest(self.current())
            policy = json.loads((release / "ops/cd/policy.json").read_text())
            check_compatible(old, manifest, policy)
            database_tree = state.get("database_migration_tree", old["migration_tree"])
            if (
                database_tree != old["migration_tree"]
                and database_tree != manifest["migration_tree"]
            ):
                raise ValueError(
                    "database schema retained after rollback; deploy matching schema tree "
                    "or use maintenance plan"
                )
            self.prepare(release)
            database = self.root / "data" / f"{revision}-{run_id}-{time.time_ns()}" / "everplain.db"
            atomic_bytes(
                release / "runtime.env",
                runtime_bytes(ENV_FILE.read_bytes(), revision, database),
                reference=ENV_FILE,
            )
            self.app(release, "preflight")
            self.command(
                [
                    "/usr/bin/docker",
                    "run",
                    "--rm",
                    "--network",
                    "everplain-production",
                    "--entrypoint",
                    "nginx",
                    manifest["images"]["web"],
                    "-t",
                ],
                "web configuration",
            )
            self.health(state["current"])
            self.disk_preflight(state, 0)
        except BaseException:
            # Failed candidates are retained for audit, but are never automatically activated.
            raise
        backup_name = self.activate(release, database, state, run_id, migrate=True)
        return {
            "status": "deployed",
            "revision": revision,
            "artifact_sha256": checksum,
            "backup": backup_name,
            "checks": "local_and_public_health_revision",
            "runtime_mode": expected_runtime_mode(release),
            "providers": "not_exercised",
        }

    def rollback(self, run_id):
        if self.journal.exists():
            tx = json.loads(self.journal.read_text())
            tx["run_id"] = max(run_id, tx["run_id"])
            with recovery_signals():
                self.restore(tx)
            return {
                "status": "interrupted_transaction_recovered",
                "revision": tx["old"]["current"],
                "runtime_mode": expected_runtime_mode(self.current()),
                "providers": "not_exercised",
            }
        state = self.state()
        if run_id < state["last_run_id"]:
            raise ValueError("stale workflow run rejected")
        revision = state.get("previous", "")
        if not SHA.fullmatch(revision) or revision == state["current"]:
            raise ValueError("no recorded previous release")
        release = self.root / "releases" / revision
        # The CURRENT release declared compatibility with its predecessor at deployment.
        check_compatible(
            self.manifest(release),
            self.manifest(self.current()),
            json.loads((self.current() / "ops/cd/policy.json").read_text()),
        )
        database = self.database_path(state["database"])
        atomic_bytes(
            release / "runtime.env",
            runtime_bytes((release / "runtime.env").read_bytes(), revision, database),
        )
        self.app(release, "preflight")
        self.activate(release, database, state, run_id, migrate=False)
        return {
            "status": "rolled_back",
            "revision": revision,
            "database": "retained_without_downgrade",
            "runtime_mode": expected_runtime_mode(release),
            "providers": "not_exercised",
        }


def interrupted(signum, frame):
    raise RuntimeError("deployment interrupted; recovering transaction")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="operation", required=True)
    deploy = sub.add_parser("deploy")
    deploy.add_argument("revision")
    deploy.add_argument("checksum")
    deploy.add_argument("run_id", type=int)
    rollback = sub.add_parser("rollback-previous")
    rollback.add_argument("run_id", type=int)
    args = parser.parse_args()
    if args.run_id <= 0 or (
        args.operation == "deploy"
        and (not SHA.fullmatch(args.revision) or not re.fullmatch(r"[0-9a-f]{64}", args.checksum))
    ):
        parser.error("invalid bounded release identity")
    os.umask(0o022)
    controller = Controller()
    try:
        with (ROOT / ".deploy.lock").open("a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            # Recovery must pass every host assertion except the pending-journal check.
            if args.operation == "rollback-previous" and controller.journal.exists():
                pending = controller.journal
                controller.journal = ROOT / ".unused-recovery-check"
                try:
                    controller.validate_host()
                finally:
                    controller.journal = pending
            else:
                controller.validate_host()
            signal.signal(signal.SIGTERM, interrupted)
            signal.signal(signal.SIGINT, interrupted)
            signal.signal(signal.SIGHUP, interrupted)
            result = (
                controller.deploy(args.revision, args.checksum, args.run_id)
                if args.operation == "deploy"
                else controller.rollback(args.run_id)
            )
    except (Exception, KeyboardInterrupt) as error:
        # Only controlled controller messages are public. No traceback/config/SQL content.
        message = str(error) if type(error) in {ValueError, RuntimeError} else type(error).__name__
        print(json.dumps({"status": "failed", "error": message}))
        return 1
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
