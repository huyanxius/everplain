"""Offline preflight tests: no SSH connection or real credential is used."""

import importlib.util
import json
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


if __name__ == "__main__":
    unittest.main()
