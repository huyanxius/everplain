"""Synthetic interrupted-upload recovery; no SSH or production data."""

import fcntl
import hashlib
import importlib.util
import json
import os
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("upload_state", ROOT / "ops/cd/upload-state.py")
upload = importlib.util.module_from_spec(spec)
spec.loader.exec_module(upload)


class UploadStateTests(unittest.TestCase):
    def test_finds_partial_and_complete_uploads_but_never_symlinks_or_other_directories(self):
        with tempfile.TemporaryDirectory() as d:
            parent = Path(d)
            complete = b"fixed-public-artifact-bytes"
            expected = hashlib.sha256(complete).hexdigest()
            for name, data in (("a", complete[:5]), ("b", complete), ("c", b"x" * len(complete))):
                directory = parent / ("everplain-candidate." + name)
                directory.mkdir(mode=0o700)
                (directory / "release.tar.gz").write_bytes(data)
            linked = parent / "everplain-candidate.link"
            linked.symlink_to(parent / "everplain-candidate.b")
            other = parent / "other-application"
            other.mkdir()
            (other / "release.tar.gz").write_bytes(complete)
            with patch.object(upload, "EXPECTED", expected):
                found = upload.discover(len(complete), os.getuid(), parent)
                self.assertEqual(
                    [Path(x["directory"]).name for x in found],
                    [
                        "everplain-candidate.b",
                        "everplain-candidate.a",
                    ],
                )
                upload.verify(parent / "everplain-candidate.b", len(complete), os.getuid(), parent)
                with self.assertRaises(RuntimeError):
                    upload.verify(
                        parent / "everplain-candidate.a", len(complete), os.getuid(), parent
                    )

    def test_new_artifact_skips_abandoned_multipart_plan_without_removing_it(self):
        with tempfile.TemporaryDirectory() as d:
            parent = Path(d)
            expected = hashlib.sha256(b"new candidate").hexdigest()
            for suffix, checksum in (("old", "a" * 64), ("current", expected)):
                directory = parent / ("everplain-candidate." + suffix)
                directory.mkdir(mode=0o700)
                (directory / "release.tar.gz").write_bytes(b"")
                (directory / "parts").mkdir(mode=0o700)
                (directory / "parts/plan.json").write_text(json.dumps({
                    "archive_sha256": checksum,
                }))
            with patch.object(upload, "EXPECTED", expected):
                found = upload.discover(len(b"new candidate"), os.getuid(), parent)
            self.assertEqual([Path(x["directory"]).name for x in found],
                             ["everplain-candidate.current"])
            self.assertTrue((parent / "everplain-candidate.old/parts/plan.json").exists())

    def test_live_release_lock_blocks_even_a_transfer_restart(self):
        with tempfile.TemporaryDirectory() as d:
            lock = Path(d) / "release.lock"
            lock.write_text("")
            with lock.open("rb") as owner:
                fcntl.flock(owner.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                with self.assertRaises(BlockingIOError):
                    upload.idle(lock)
            upload.idle(lock)

    def test_local_prefix_verification_selects_only_identical_artifact_bytes(self):
        script = (ROOT / "ops/cd/deploy-existing-ssh.sh").read_text()
        selector = script.split("<<'PYSELECT'\n", 1)[1].split("\nPYSELECT", 1)[0]
        body = b"exact-known-public-candidate"
        with tempfile.TemporaryDirectory() as d:
            source, state = Path(d) / "archive", Path(d) / "state.json"
            source.write_bytes(body)
            state.write_text(
                json.dumps(
                    [
                        {
                            "directory": "/tmp/everplain-candidate.bad",
                            "size": 12,
                            "sha256": "0" * 64,
                        },
                        {
                            "directory": "/tmp/everplain-candidate.good",
                            "size": 7,
                            "sha256": hashlib.sha256(body[:7]).hexdigest(),
                        },
                    ]
                )
            )
            result = subprocess.run(
                [sys.executable, "-", str(source), str(state)],
                input=selector,
                capture_output=True,
                text=True,
                check=True,
            )
            self.assertEqual(
                result.stdout.splitlines()[:2], ["/tmp/everplain-candidate.good", "false"]
            )

    def test_transport_reuses_complete_package_and_has_bounded_resume_and_separate_apply(self):
        script = (ROOT / "ops/cd/deploy-existing-ssh.sh").read_text()
        self.assertIn('if [[ "$complete" != true ]]', script)
        self.assertIn("upload_parts.py", script)
        self.assertIn("duration=1800", script)
        self.assertIn("duration=120", script)
        self.assertIn('[[ "$mode" != upload ]] || exit 0', script)
        self.assertLess(
            script.index(" verify $size $EXPECTED_SHA256 $upload"),
            script.index("echo '{\"upload_completed\":true}'"),
        )
        workflow = (ROOT / ".github/workflows/deploy.yml").read_text()
        deploy = workflow.split("\n  deploy:\n", 1)[1]
        job_minutes = int(re.search(r"timeout-minutes: (\d+)", deploy).group(1))
        upload_seconds = int(re.search(r"duration=(\d+)", script).group(1))
        attempts = int(re.search(r"attempts=(\d+)", script).group(1))
        # Upload must finish before the runner can cancel verification and cutover.
        self.assertGreaterEqual(job_minutes * 60, upload_seconds * attempts + 5 * 60)
        self.assertIn("deploy-existing-ssh.sh all", workflow)
        self.assertIn("EXPECTED_SHA256: ${{ needs.build.outputs.digest }}", workflow)

    def test_upload_timeout_resumes_same_request_once_but_errors_stop(self):
        script = (ROOT / "ops/cd/deploy-existing-ssh.sh").read_text()
        block = script.split("  attempts=2\n", 1)[1].split('  if [[ "$status" == 3', 1)[0]
        block = "  attempts=2\n" + block
        for mode, outcomes, count, expected in (
            ("all", "3 0", 2, 0),
            ("all", "2 0", 1, 2),
            ("all", "3 3", 2, 3),
            ("trial", "3 0", 1, 3),
        ):
            with self.subTest(mode=mode, outcomes=outcomes):
                harness = '''set -euo pipefail
root=/repo
archive=/artifact
upload=/candidate
private=/scratch
port=22
target=server
prefix_size=0
prefix_hash=known
duration=1800
opts=(-o strict)
calls=0
python3() {
  calls=$((calls + 1))
  [[ "$*" == '/repo/ops/cd/upload_parts.py local /artifact /candidate /scratch 22 server 0 known 1800 -o strict' ]]
  return "${results[calls-1]}"
}
'''
                harness += f"mode={mode}\nresults=({outcomes})\n" + block
                harness += 'printf "%s %s\\n" "$calls" "$status"\n'
                result = subprocess.run(["bash"], input=harness, capture_output=True,
                                        text=True, check=True)
                self.assertEqual(result.stdout.splitlines()[-1], f"{count} {expected}")


if __name__ == "__main__":
    unittest.main()
