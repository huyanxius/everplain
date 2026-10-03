"""Synthetic existing-container update; no network, Docker, secrets, or production."""

import hashlib
import importlib.util
import io
import json
import shutil
import sqlite3
import subprocess
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "ops/cd"))
spec = importlib.util.spec_from_file_location(
    "existing_release", ROOT / "ops/cd/deploy-existing.py"
)
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


def container(role, source):
    ports = {"api": ("8297", "8297/tcp"), "web": ("5196", "8080/tcp")}
    port, inside = ports[role]
    return {
        "Id": "fixture-" + role,
        "Name": "/everplain-" + role,
        "State": {"Running": True},
        "HostConfig": {
            "Privileged": False,
            "RestartPolicy": {"Name": "unless-stopped"},
            "PortBindings": {
                inside: [{"HostIp": "127.0.0.1", "HostPort": port}],
            },
        },
        "NetworkSettings": {"Networks": {"bridge": {"IPAddress": "172.17.0.5"}}},
        "Mounts": [
            {
                "Type": "volume",
                "Name": "everplain-data",
                "Source": str(source),
                "Destination": "/data",
                "RW": True,
            }
        ]
        if role == "api"
        else [],
        "Config": {
            "Env": [
                "EVERPLAIN_RUNTIME_MODE=base",
                "EVERPLAIN_ALLOW_MODEL_FALLBACK=true",
                "EVERPLAIN_DATABASE_URL=sqlite:////data/everplain.db",
                "EVERPLAIN_RETRIEVAL_INDEX_PATH=/data/everplain-retrieval.db",
                "EVERPLAIN_RELEASE_REVISION=" + release.PREVIOUS_REVISION,
                "EVERPLAIN_RESEND_API_KEY=synthetic-private-value",
            ]
        },
    }


class ExistingReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / "everplain-data"
        self.source.mkdir()
        with sqlite3.connect(self.source / "everplain.db") as db:
            db.executescript(
                "CREATE TABLE writes(value TEXT); CREATE TABLE schema_marker(value TEXT);"
                "INSERT INTO schema_marker VALUES ('old');"
            )
        self.archive = self.root / "candidate.tar.gz"
        self.archive.write_bytes(b"synthetic archive")
        self.calls = []
        self.failure = None
        self.api_started = False
        self.disk_results = None
        self.updater = release.ExistingRelease(self.archive, self.root / "updates")

    def snapshot(self, path, table):
        with sqlite3.connect(path) as db:
            return db.execute("SELECT * FROM " + table).fetchall()

    def metadata(self, name):
        return container(name.removeprefix("everplain-"), self.source)

    def unpack(self, archive, destination, revision, checksum):
        self.assertEqual(revision, release.REVISION)
        self.assertEqual(checksum, release.ARCHIVE_SHA256)
        destination.mkdir()
        (destination / "images").mkdir()
        for role in ("api", "web"):
            (destination / "images" / (role + ".tar")).write_bytes(b"fixture")
        return {"images": {"api": release.API_IMAGE, "web": release.WEB_IMAGE}, "web_checks": {}}

    def command(self, args, **_kwargs):
        self.calls.append(args)
        self.assertNotIn("synthetic-private-value", " ".join(map(str, args)))
        if args[:2] == ["docker", "info"]:
            return str(self.root)
        if args[:3] == ["docker", "image", "inspect"]:
            return json.dumps(
                [
                    {
                        "Id": args[3],
                        "Architecture": "amd64",
                        "Os": "linux",
                        "Config": {
                            "Labels": {"org.opencontainers.image.revision": release.REVISION},
                        },
                    }
                ]
            )
        if "backup" in args:
            shutil.copyfile(
                self.source / "everplain.db", self.updater.stage / "backups/everplain.db"
            )
        if "alembic" in args:
            with sqlite3.connect(self.updater.stage / "data/everplain.db") as db:
                db.execute("UPDATE schema_marker SET value='new'")
            if self.failure == "migration":
                raise RuntimeError("synthetic failure")
        if (
            args[:3] == ["docker", "run", "-d"]
            and args[args.index("--name") + 1] == "everplain-api"
        ):
            self.api_started = True
            with sqlite3.connect(self.updater.stage / "data/everplain.db") as db:
                db.execute("INSERT INTO writes VALUES ('accepted-background-write')")
        return ""

    def health(self, _revision, **_kwargs):
        if self.failure == "api-health":
            raise RuntimeError("synthetic failure")

    def public(self, *_args):
        if self.failure == "public-health":
            raise RuntimeError("synthetic failure")

    def disk_usage(self, _path):
        from types import SimpleNamespace

        if self.disk_results is not None:
            return next(self.disk_results)
        return SimpleNamespace(free=2**60)

    def execute(self):
        with (
            patch.object(release.shutil, "disk_usage", side_effect=self.disk_usage),
            patch.object(release, "metadata", side_effect=self.metadata),
            patch.object(release, "unpack", side_effect=self.unpack),
            patch.object(release, "reusable_stage", return_value=None),
            patch.object(release, "inspect_image_archive"),
            patch.object(
                release,
                "loaded_image",
                side_effect=lambda image, *_: json.loads(
                    self.command(["docker", "image", "inspect", image])
                )[0],
            ),
            patch.object(release, "run", side_effect=self.command),
            patch.object(release.Controller, "health", side_effect=self.health),
            patch.object(release, "public_health", side_effect=self.public),
            patch.object(
                release,
                "http",
                return_value=json.dumps(
                    {
                        "status": "ok",
                        "release_revision": release.PREVIOUS_REVISION,
                    }
                ).encode(),
            ),
        ):
            return self.updater.execute()

    def test_success_keeps_original_data_and_uses_candidate_snapshot(self):
        report = self.execute()
        self.assertTrue(report["deployment_succeeded"])
        self.assertEqual(self.snapshot(self.source / "everplain.db", "schema_marker"), [("old",)])
        self.assertEqual(
            self.snapshot(self.updater.stage / "data/everplain.db", "schema_marker"), [("new",)]
        )
        self.assertEqual(
            self.snapshot(self.updater.stage / "data/everplain.db", "writes"),
            [("accepted-background-write",)],
        )
        self.assertTrue(all(type(value) is bool for value in report.values()))
        env = next(self.updater.stage.glob("releases/*/runtime.env"))
        self.assertEqual(env.stat().st_mode & 0o777, 0o600)
        self.assertIn("synthetic-private-value", env.read_text())
        self.assertNotIn("synthetic-private-value", json.dumps(report))
        stopped = next(i for i, call in enumerate(self.calls) if call[:2] == ["docker", "stop"])
        backup = next(i for i, call in enumerate(self.calls) if "backup" in call)
        migrate = next(i for i, call in enumerate(self.calls) if "alembic" in call)
        self.assertLess(stopped, backup)
        self.assertLess(backup, migrate)
        self.assertFalse(any(call[:3] == ["docker", "network", "create"] for call in self.calls))

    def test_migration_failure_restores_untouched_old_containers_and_data(self):
        self.failure = "migration"
        with self.assertRaises(RuntimeError):
            self.execute()
        self.assertFalse(self.api_started)
        self.assertTrue(self.updater.report["old_service_restored"])
        self.assertEqual(self.snapshot(self.source / "everplain.db", "schema_marker"), [("old",)])
        self.assertIn(["docker", "start", "everplain-api"], self.calls)

    def test_failure_after_api_start_never_restarts_old_app_or_discards_new_writes(self):
        for failure in ("api-health", "public-health"):
            with self.subTest(failure=failure):
                self.failure = failure
                self.calls.clear()
                self.updater = release.ExistingRelease(self.archive, self.root / "updates")
                with self.assertRaises(RuntimeError):
                    self.execute()
                self.assertTrue(self.updater.report["forward_stop_required"])
                self.assertFalse(self.updater.report["old_service_restored"])
                self.assertFalse(any(call[:2] == ["docker", "start"] for call in self.calls))
                self.assertEqual(
                    self.snapshot(self.updater.stage / "data/everplain.db", "writes"),
                    [("accepted-background-write",)],
                )

    def test_wrong_product_mount_or_port_fails_before_mutation(self):
        for change in ("mount", "port", "network"):
            api, web = container("api", self.source), container("web", self.source)
            if change == "mount":
                api["Mounts"][0]["Name"] = "other-product-data"
            elif change == "port":
                api["HostConfig"]["PortBindings"]["8297/tcp"][0]["HostIp"] = "0.0.0.0"
            else:
                api["NetworkSettings"]["Networks"] = {"other-product": {}}
            with self.subTest(change=change), self.assertRaises(RuntimeError):
                release.existing_layout(api, web)

    def test_low_disk_blocks_before_copy_or_before_image_load(self):
        from collections import namedtuple

        Usage = namedtuple("Usage", "total used free")
        for checks in ([Usage(1, 1, 0)], [Usage(2**60, 0, 2**60), Usage(1, 1, 0)]):
            with self.subTest(checks=len(checks)):
                self.calls.clear()
                self.updater = release.ExistingRelease(self.archive, self.root / "updates")
                self.disk_results = iter(checks)
                with (
                    patch.object(release.shutil, "copyfile", wraps=shutil.copyfile) as copy,
                    self.assertRaises(RuntimeError),
                ):
                    self.execute()
                self.assertFalse(any(call[:2] == ["docker", "load"] for call in self.calls))
                self.assertFalse(any(call[:2] == ["docker", "stop"] for call in self.calls))
                if len(checks) == 1:
                    copy.assert_not_called()

    def test_old_always_restart_policy_is_rejected_without_modification(self):
        for role in ("api", "web"):
            api, web = container("api", self.source), container("web", self.source)
            selected = api if role == "api" else web
            selected["HostConfig"]["RestartPolicy"]["Name"] = "always"
            with self.subTest(role=role), self.assertRaises(RuntimeError):
                release.existing_layout(api, web)
            self.assertEqual(selected["HostConfig"]["RestartPolicy"]["Name"], "always")

    def test_failed_command_never_exposes_argv_or_secret_output(self):
        result = subprocess.CompletedProcess(
            [], 1, "synthetic-private-value", "synthetic-private-value"
        )
        with (
            patch.object(release.subprocess, "run", return_value=result),
            self.assertRaises(RuntimeError) as error,
        ):
            release.run(["fixture", "synthetic-private-value"])
        self.assertNotIn("synthetic-private-value", str(error.exception))

    def test_reusable_stage_rechecks_payload_and_rejects_transaction_or_modified_files(self):
        base = self.root / "stages"
        stage = base / (release.REVISION[:8] + "-fixture")
        target = stage / "releases" / release.REVISION
        target.mkdir(parents=True)
        stage.chmod(0o700)
        (target / "backend").mkdir()
        (target / "payload").write_bytes(b"immutable")
        (stage / "release.tar.gz").write_bytes(b"archive")
        manifest = {
            "files": {"payload": release.digest(target / "payload")},
            "migration_tree": release.tree_hash(target / "backend"),
        }
        (target / "manifest.json").write_text(json.dumps(manifest))
        with (
            patch.object(release, "ARCHIVE_SHA256", release.digest(stage / "release.tar.gz")),
            patch.object(release, "validate_manifest", return_value=manifest),
        ):
            self.assertEqual(release.reusable_stage(base)[0], stage)
            for item in ("data", "backups", "transaction.json"):
                marker = stage / item
                marker.touch()
                self.assertIsNone(release.reusable_stage(base))
                marker.unlink()
            (target / "payload").write_bytes(b"changed")
            with self.assertRaises(RuntimeError):
                release.reusable_stage(base)

    def test_archive_format_and_image_identity_are_only_boolean_diagnostics(self):
        path = self.root / "image.tar"
        config = b'{"architecture":"amd64","os":"linux"}'
        image_id = "sha256:" + hashlib.sha256(config).hexdigest()
        with tarfile.open(path, "w") as archive:
            for name, content in (("oci-layout", b"{}"), ("blobs/sha256/" + image_id[7:], config)):
                info = tarfile.TarInfo(name)
                info.size = len(content)
                archive.addfile(info, io.BytesIO(content))
        report = {}
        release.inspect_image_archive(path, image_id, report, "api")
        self.assertTrue(report["api_archive_config_matches_image"])
        self.assertTrue(report["api_archive_linux_amd64"])
        self.assertTrue(report["api_archive_oci_layout"])
        self.assertFalse(report["api_archive_docker_manifest"])
        self.assertTrue(all(type(value) is bool for value in report.values()))

    def test_loaded_image_distinguishes_identity_architecture_and_missing_label_privately(self):
        value = {
            "Id": release.API_IMAGE,
            "Architecture": "amd64",
            "Os": "linux",
            "Config": {"Labels": None, "Env": ["PRIVATE=must-not-print"]},
        }
        result = subprocess.CompletedProcess([], 0, json.dumps([value]), "")
        report = {}
        with patch.object(release.subprocess, "run", return_value=result):
            self.assertEqual(release.loaded_image(release.API_IMAGE, "api", report), value)
        self.assertTrue(report["api_id_identity_matches"])
        self.assertTrue(report["api_id_amd64"])
        self.assertFalse(report["api_id_revision_label_matches"])
        self.assertNotIn("must-not-print", json.dumps(report))
        self.assertTrue(all(type(value) is bool for value in report.values()))

    def test_failed_preflight_reports_only_known_field_flags(self):
        value = {"invalid_fields": ["EVERPLAIN_SESSION_COOKIE_SECURE", "private-field-value"]}
        result = subprocess.CompletedProcess([], 1, json.dumps(value), "private-value")
        report = {}
        with (
            patch.object(release.subprocess, "run", return_value=result),
            self.assertRaises(RuntimeError),
        ):
            release.run(["fixture"], report=report, prefix="configuration_")
        self.assertTrue(report["invalid_session_cookie_secure"])
        self.assertTrue(report["invalid_other_configuration"])
        self.assertNotIn("private", json.dumps(report))

    def test_workflow_reuses_fixed_artifact_without_application_build(self):
        text = (ROOT / ".github/workflows/publish-checked-candidate.yml").read_text()
        self.assertIn("run-id: 37101235437", text)
        self.assertIn(release.REVISION, text)
        self.assertIn("if: github.ref == 'refs/heads/main'", text)
        self.assertNotIn("pull_request", text)
        self.assertNotIn("build.sh", text)
        transport = (ROOT / "ops/cd/deploy-existing-ssh.sh").read_text()
        self.assertIn(release.ARCHIVE_SHA256, transport)
        self.assertIn("StrictHostKeyChecking=yes", transport)
        self.assertLess(transport.index(release.ARCHIVE_SHA256), transport.index("sftp "))


if __name__ == "__main__":
    unittest.main()
