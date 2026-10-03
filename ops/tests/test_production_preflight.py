"""Offline preflight tests: no SSH connection or real credential is used."""

import hashlib
import importlib.util
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location(
    "production_inspection", ROOT / "ops/cd/inspect-production.py"
)
inspection = importlib.util.module_from_spec(spec)
spec.loader.exec_module(inspection)
FINGERPRINT = "SHA256:" + "a" * 43


class SSHPreflightTests(unittest.TestCase):
    def run_script(self, *, matched=True, secret=True, scan_ok=True):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            observed = FINGERPRINT if matched else "SHA256:wrong"
            scripts = {
                "ssh-keyscan": "echo fixture-public-key\nexit " + ("0" if scan_ok else "1"),
                "ssh-keygen": f"echo '256 {observed} fixture ED25519'",
                "ssh": 'printf "%s\\n" "$@" > "$CALLS"; cat >/dev/null; echo inspection-stub',
            }
            for name, script in scripts.items():
                path = root / name
                path.write_text("#!/bin/sh\n" + script + "\n")
                path.chmod(0o755)
            env = {
                "PATH": f"{root}:/usr/bin:/bin",
                "CALLS": str(root / "calls"),
                "EVERPLAIN_DEPLOY_HOST": "host.invalid",
                "EVERPLAIN_DEPLOY_USER": "ubuntu",
                "EVERPLAIN_DEPLOY_PORT": "22",
                "EVERPLAIN_SSH_HOST_KEY_FINGERPRINT": FINGERPRINT,
            }
            if secret:
                env["EVERPLAIN_SSH_PRIVATE_KEY"] = "synthetic-not-a-real-credential"
            result = subprocess.run(
                ["bash", str(ROOT / "ops/cd/preflight-ssh.sh")],
                env=env,
                capture_output=True,
                text=True,
                check=False,
            )
            calls = (root / "calls").read_text() if (root / "calls").exists() else ""
            return result, calls

    def test_ubuntu_uses_verified_host_with_strict_checking_and_read_only_command(self):
        result, calls = self.run_script()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("ubuntu@host.invalid", calls)
        self.assertIn("StrictHostKeyChecking=yes", calls)
        self.assertIn("sudo -n python3 -", calls)
        self.assertNotIn("synthetic-not-a-real-credential", result.stdout + result.stderr + calls)
        key = Path(calls.splitlines()[1])
        self.assertFalse(key.exists())

    def test_fingerprint_mismatch_never_authenticates(self):
        result, calls = self.run_script(matched=False)
        self.assertEqual(result.returncode, 2)
        self.assertIn("Host-key verification failed", result.stderr)
        self.assertEqual(calls, "")

    def test_failed_scan_never_authenticates(self):
        result, calls = self.run_script(scan_ok=False)
        self.assertEqual(result.returncode, 2)
        self.assertIn("Host-key lookup failed", result.stderr)
        self.assertEqual(calls, "")

    def test_missing_secret_fails_without_authentication(self):
        result, calls = self.run_script(secret=False)
        self.assertEqual(result.returncode, 2)
        self.assertIn("EVERPLAIN_SSH_PRIVATE_KEY", result.stderr)
        self.assertEqual(calls, "")


class InspectionTests(unittest.TestCase):
    def setUp(self):
        probe = patch.object(inspection, "inspect_upload", return_value={})
        probe.start()
        self.addCleanup(probe.stop)
        release = patch.object(inspection, "inspect_release", return_value={})
        release.start()
        self.addCleanup(release.stop)

    def test_output_contains_only_booleans_and_no_private_metadata(self):
        result = subprocess.CompletedProcess([], 0, "everplain-api\nprivate-fixture\n", "")
        with (
            patch.object(inspection.subprocess, "run", return_value=result) as run,
            patch.object(inspection, "healthy", return_value=True),
        ):
            data = inspection.inspect()
        self.assertTrue(data["ssh_authenticated"])
        self.assertTrue(data["everplain_container_present"])
        self.assertTrue(all(type(value) is bool for value in data.values()))
        self.assertNotIn("private-fixture", json.dumps(data))
        self.assertNotIn("Config.Env", str(run.call_args))
        self.assertNotIn("inspect", run.call_args.args[0])
        self.assertFalse(data["host_changes"])

    def test_other_products_never_count_as_everplain(self):
        result = subprocess.CompletedProcess([], 0, "qunxue-api\neverplainx-api\n", "")
        with (
            patch.object(inspection.subprocess, "run", return_value=result),
            patch.object(inspection, "healthy", return_value=False),
        ):
            self.assertFalse(inspection.inspect()["everplain_container_present"])

    def test_failed_docker_read_does_not_claim_container_exists(self):
        result = subprocess.CompletedProcess([], 1, "", "private-error-must-not-escape")
        with (
            patch.object(inspection.subprocess, "run", return_value=result),
            patch.object(inspection, "healthy", return_value=False),
        ):
            data = inspection.inspect()
        self.assertFalse(data["docker_readable"])
        self.assertNotIn("private-error", json.dumps(data))

    def test_workflow_is_main_only_and_reuses_existing_secret(self):
        text = (ROOT / ".github/workflows/production-preflight.yml").read_text()
        self.assertIn("if: github.ref == 'refs/heads/main'", text)
        self.assertIn("branches: [main]", text)
        self.assertNotIn("pull_request", text)
        self.assertIn("secrets.EVERPLAIN_SSH_PRIVATE_KEY", text)
        self.assertIn("SHA256:2QamxRsk36HjNhAek1+zT6Db1PtPKuuDoplLOCdTTmA", text)
        self.assertNotIn("transport.sh", text)


class UploadInspectionTests(unittest.TestCase):
    def test_release_diagnostic_checks_budget_images_and_file_without_reading_env(self):
        with tempfile.TemporaryDirectory() as d:
            base = Path(d)
            release = (
                base / (inspection.REVISION[:8] + "-fixture") / "releases" / inspection.REVISION
            )
            release.mkdir(parents=True)
            release.parents[1].chmod(0o700)
            (release / "images").mkdir()
            for role in ("api", "web"):
                (release / "images" / (role + ".tar")).write_bytes(b"fixture")
            (release / "runtime.env").write_text("private-env-must-not-be-read")
            source = base / "private-data"
            source.mkdir()
            (source / "everplain.db").write_bytes(b"private-data")

            def command(args):
                if args[1] == "image":
                    return "amd64 linux " + inspection.REVISION
                if args[1] == "inspect":
                    return json.dumps([{"Source": str(source), "Destination": "/data"}])
                return str(base)

            with patch.object(inspection, "read_command", side_effect=command):
                result = inspection.inspect_release(base)
            self.assertTrue(result["release_api_image_verified"])
            self.assertTrue(result["release_web_image_verified"])
            self.assertTrue(result["release_private_env_present"])
            self.assertNotIn("private-", json.dumps(result))

    def test_release_diagnostic_never_writes_or_outputs_metadata(self):
        text = (ROOT / "ops/cd/inspect-production.py").read_text()
        function = text.split("def inspect_release(", 1)[1].split("def upload_snapshot(", 1)[0]
        self.assertNotIn('"run"', function)
        self.assertNotIn("write_text", function)
        self.assertNotIn("unlink", function)
        self.assertNotIn("Config.Env", function)
        with tempfile.TemporaryDirectory() as d:
            result = inspection.inspect_release(Path(d))
        self.assertEqual(len(result), 4)
        self.assertTrue(all(type(value) is bool and not value for value in result.values()))

    def test_parallel_progress_counts_separate_shards_once(self):
        prefix = Path("/tmp/everplain-candidate.fixture/release.tar.gz")
        shard = prefix.parent / "parts/part-0"
        snapshot = {prefix: (20, 1), shard: (45, 1)}
        with (
            patch.object(inspection, "upload_snapshot", return_value=snapshot),
            patch.object(inspection, "upload_writers", return_value=set(snapshot)),
            patch.object(inspection.time, "sleep"),
            patch.object(inspection, "PUBLIC_ARTIFACT_BYTES", 120),
        ):
            result = inspection.inspect_upload()
        self.assertTrue(result["upload_bytes_at_least_50_percent"])
        self.assertFalse(result["upload_bytes_at_least_75_percent"])
        self.assertFalse(result["upload_complete"])

    def test_progress_is_conservative_and_never_claims_integrity(self):
        path = Path("/fixture/release.tar.gz")
        with (
            patch.object(inspection, "upload_snapshot", return_value={path: (80, 1)}),
            patch.object(inspection, "upload_writers", return_value={path}),
            patch.object(inspection.time, "sleep"),
            patch.object(inspection, "PUBLIC_ARTIFACT_BYTES", 120),
        ):
            result = inspection.inspect_upload()
        self.assertTrue(result["upload_bytes_at_least_25_percent"])
        self.assertTrue(result["upload_bytes_at_least_50_percent"])
        self.assertFalse(result["upload_bytes_at_least_75_percent"])
        self.assertFalse(result["upload_complete"])

    def test_growing_or_open_upload_is_not_hashed(self):
        path = Path("/private-fixture/release.tar.gz")
        with (
            patch.object(
                inspection, "upload_snapshot", side_effect=[{path: (1, 1)}, {path: (2, 2)}]
            ),
            patch.object(inspection, "upload_writers", return_value={path}),
            patch.object(inspection.time, "sleep"),
            patch.object(Path, "open", side_effect=AssertionError("must not open growing file")),
        ):
            result = inspection.inspect_upload()
        self.assertTrue(result["upload_growing"])
        self.assertTrue(result["upload_writer_present"])
        self.assertFalse(result["upload_complete"])
        self.assertTrue(all(type(value) is bool for value in result.values()))

    def test_stable_upload_requires_exact_digest(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "release.tar.gz"
            path.write_bytes(b"known-archive")
            snapshot = {path: (13, 1)}
            with (
                patch.object(inspection, "upload_snapshot", return_value=snapshot),
                patch.object(inspection, "upload_writers", return_value=set()),
                patch.object(inspection.time, "sleep"),
                patch.object(
                    inspection, "UPLOAD_SHA256", hashlib.sha256(b"known-archive").hexdigest()
                ),
            ):
                self.assertTrue(inspection.inspect_upload()["upload_complete"])
                path.write_bytes(b"wrong-archive")
                self.assertFalse(inspection.inspect_upload()["upload_complete"])

    def test_snapshot_rejects_other_directories_and_symlinks(self):
        with tempfile.TemporaryDirectory() as d:
            parent = Path(d)
            directory = parent / "everplain-candidate.valid"
            directory.mkdir(mode=0o700)
            (directory / "release.tar.gz").write_bytes(b"fixture")
            (parent / "everplain-candidate.link").symlink_to(directory)
            with patch.dict(os.environ, {"SUDO_UID": str(os.getuid())}):
                self.assertEqual(
                    list(inspection.upload_snapshot(parent)), [directory / "release.tar.gz"]
                )

    def test_detects_only_write_descriptors_for_known_upload(self):
        with tempfile.TemporaryDirectory() as d:
            parent = Path(d)
            (parent / "123/fd").mkdir(parents=True)
            (parent / "123/fdinfo").mkdir()
            target = Path("/fixture/release.tar.gz")
            (parent / "123/fd/4").symlink_to(target)
            (parent / "123/fdinfo/4").write_text("flags:\t0100001\n")
            self.assertEqual(inspection.upload_writers({target}, parent), {target})
            (parent / "123/fdinfo/4").write_text("flags:\t0100000\n")
            self.assertEqual(inspection.upload_writers({target}, parent), set())


if __name__ == "__main__":
    unittest.main()
