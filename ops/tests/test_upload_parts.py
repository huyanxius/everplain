"""Synthetic public-archive splitting, prefix validation and exact assembly."""

import hashlib
import importlib.util
import os
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("upload_parts", ROOT / "ops/cd/upload_parts.py")
parts = importlib.util.module_from_spec(spec)
spec.loader.exec_module(parts)


class ParallelUploadTests(unittest.TestCase):
    @unittest.skipUnless(
        shutil.which("sftp") and Path("/usr/lib/openssh/sftp-server").is_file(),
        "local OpenSSH sftp-server is not installed",
    )
    def test_real_sftp_creates_new_shards_and_resumes_existing_prefixes(self):
        body = b"checked-candidate" * 1234
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            source, destination, batch = root / "source", root / "remote", root / "batch"
            source.write_bytes(body)
            # Reproduce the original bug with an actually missing remote target.
            batch.write_text(parts.upload_command(source, destination, 1))
            command = ["sftp", "-q", "-D", "/usr/lib/openssh/sftp-server", "-b", str(batch)]
            failed = parts.transfer(command, 5)
            self.assertTrue(failed["missing_file"])
            self.assertTrue(failed["exit_1"])
            self.assertFalse(destination.exists())
            # New file, existing empty file and two non-zero resumptions all use real SFTP.
            for received in (0, 0, 31, 791):
                if destination.exists():
                    destination.write_bytes(body[:received])
                batch.write_text(parts.upload_command(source, destination, received))
                result = parts.transfer(command, 5)
                self.assertTrue(result["ok"], result)
                self.assertEqual(parts.digest(destination), hashlib.sha256(body).hexdigest())
                self.assertTrue(all(type(value) is bool for value in result.values()))

    def test_split_and_assemble_preserve_prefix_and_exact_bytes(self):
        body = b"fixed-candidate" * 137
        prefix = body[:317]
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            archive = root / "source"
            archive.write_bytes(body)
            plan = parts.make_parts(
                archive, len(prefix), hashlib.sha256(prefix).hexdigest(), root / "parts"
            )
            self.assertEqual(len(plan["parts"]), 3)
            (root / "release.tar.gz").write_bytes(prefix)
            with patch.object(parts, "no_writer"):
                parts.assemble(
                    root, root / "parts", plan, os.getuid(), hashlib.sha256(body).hexdigest()
                )
            self.assertEqual((root / "release.tar.gz").read_bytes(), body)
            self.assertEqual((root / "prefix.saved.tar.gz").read_bytes(), prefix)

    def test_wrong_prefix_is_rejected_before_splitting(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "source"
            path.write_bytes(b"fixed-candidate")
            with self.assertRaises(RuntimeError):
                parts.make_parts(path, 3, "0" * 64, Path(d) / "parts")
            self.assertFalse((Path(d) / "parts").exists())

    def test_bad_final_hash_never_replaces_prefix(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            archive = root / "source"
            archive.write_bytes(b"candidate-bytes")
            plan = parts.make_parts(archive, 3, hashlib.sha256(b"can").hexdigest(), root / "parts")
            (root / "release.tar.gz").write_bytes(b"can")
            with patch.object(parts, "no_writer"), self.assertRaises(RuntimeError):
                parts.assemble(root, root / "parts", plan, os.getuid(), "0" * 64)
            self.assertEqual((root / "release.tar.gz").read_bytes(), b"can")

    def test_partial_chunk_status_supports_verified_resume(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            path = root / "source"
            path.write_bytes(b"candidate-bytes" * 10)
            plan = parts.make_parts(path, 0, hashlib.sha256(b"").hexdigest(), root / "parts")
            chunk = root / "parts/part-0"
            prefix = chunk.read_bytes()[:5]
            chunk.write_bytes(prefix)
            with patch.object(parts, "no_writer"):
                status = parts.part_status(root / "parts", plan, os.getuid())
            self.assertEqual(status[0]["size"], 5)
            self.assertEqual(status[0]["sha256"], hashlib.sha256(prefix).hexdigest())


if __name__ == "__main__":
    unittest.main()
