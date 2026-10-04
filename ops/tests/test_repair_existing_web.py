"""Synthetic exact upstream repair; no SSH, Docker, or production configuration."""

import importlib.util
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location(
    "repair_existing_web", ROOT / "ops/cd/repair_existing_web.py"
)
repair = importlib.util.module_from_spec(spec)
spec.loader.exec_module(repair)


class WebRepairTests(unittest.TestCase):
    def test_changes_only_unique_upstream_and_preserves_inode_owner_and_mode(self):
        original = b"server { listen 8080; location /api/ { proxy_pass http://172.17.0.5:8297; } }"
        changed = repair.replacement(original, "172.17.0.4")
        self.assertEqual(changed, original.replace(b"172.17.0.5", b"172.17.0.4"))
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "everplain-nginx.conf"
            path.write_bytes(original)
            path.chmod(0o640)
            before = path.stat()
            with path.open("r+b") as stream:
                repair.write_same_inode(stream, changed)
                self.assertEqual(path.read_bytes(), changed)
                repair.write_same_inode(stream, original)
            after = path.stat()
            self.assertEqual(
                (before.st_ino, before.st_uid, before.st_gid, before.st_mode),
                (after.st_ino, after.st_uid, after.st_gid, after.st_mode),
            )
            self.assertEqual(path.read_bytes(), original)

    def test_rejects_multiple_or_absent_api_upstreams_and_non_private_address(self):
        directive = b"proxy_pass http://172.17.0.5:8297;"
        for original, address in (
            (b"other config", "172.17.0.4"),
            (directive * 2, "172.17.0.4"),
            (directive, "8.8.8.8"),
        ):
            with self.assertRaises(RuntimeError):
                repair.replacement(original, address)

    def test_only_explicit_repair_workflow_can_invoke_repair_mode(self):
        workflow = (ROOT / ".github/workflows/repair-existing-web.yml").read_text()
        self.assertIn("preflight-ssh.sh repair-web", workflow)
        self.assertIn("group: everplain-production", workflow)
        self.assertNotIn("  push:", workflow)
        self.assertIn("  workflow_dispatch:", workflow)
        self.assertNotIn("deploy-existing-ssh.sh", workflow)
        inspection = (ROOT / ".github/workflows/production-preflight.yml").read_text()
        self.assertNotIn("repair-web", inspection)
        source = (ROOT / "ops/cd/repair_existing_web.py").read_text()
        self.assertNotIn('["docker", "stop"', source)
        self.assertNotIn('["docker", "restart"', source)


if __name__ == "__main__":
    unittest.main()
