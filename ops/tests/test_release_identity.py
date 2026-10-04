"""Current-run provenance and live-overlay guards
no Docker/SSH/provider requests."""

import copy
import hashlib
import importlib.util
import io
import json
import os
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "ops/cd"))
import release_identity as identity  # noqa: E402

REVISION = "a" * 40
CHECKSUM = "b" * 64
RUNTIME = {
    "api_image": "sha256:" + "c" * 64,
    "web_image": "sha256:" + "d" * 64,
    "api": {key: "e" * 64 for key in identity.API_KEYS},
    "web_tree": "f" * 64,
}


def manifest():
    return {
        "format": 1,
        "repository": "huyanxius/everplain",
        "runtime": "docker-linux-amd64",
        "revision": REVISION,
        "migration_tree": RUNTIME["api"]["migration_tree"],
        "images": {"api": RUNTIME["api_image"], "web": RUNTIME["web_image"]},
        "files": {p: "a" * 64 for p in ("images/api.tar", "images/web.tar", "ops/cd/policy.json")},
        "web_checks": {"/index.html": "a" * 64, "/assets/main.js": "b" * 64},
        "runtime_identity": {"api": copy.deepcopy(RUNTIME["api"]), "web_tree": RUNTIME["web_tree"]},
        "provenance": {
            "run_id": "200",
            "run_attempt": "2",
            "workflow_ref": "huyanxius/everplain/.github/workflows/deploy.yml@refs/heads/main",
        },
    }


def state():
    return {
        "format": 1,
        "application": "everplain",
        "revision": "b" * 40,
        "run_id": 199,
        "archive_sha256": CHECKSUM,
        "runtime": copy.deepcopy(RUNTIME),
    }


class ReleaseIdentityTests(unittest.TestCase):
    def test_exact_current_run_manifest_passes(self):
        self.assertEqual(identity.validate_provenance(manifest(), REVISION, "200", "2"), manifest())

    def test_wrong_run_attempt_ref_revision_or_missing_fingerprint_fails(self):
        changes = [
            ("provenance", "run_id", "201"),
            ("provenance", "run_attempt", "1"),
            (
                "provenance",
                "workflow_ref",
                "huyanxius/everplain/.github/workflows/ci.yml@refs/pull/1/merge",
            ),
            ("runtime_identity", "web_tree", "invalid"),
        ]
        for group, key, value in changes:
            with self.subTest(key=key):
                candidate = manifest()
                candidate[group][key] = value
                with self.assertRaises(ValueError):
                    identity.validate_provenance(candidate, REVISION, "200", "2")
        with self.assertRaises(ValueError):
            identity.validate_provenance(manifest(), "b" * 40, "200", "2")
        candidate = manifest()
        candidate.pop("runtime_identity")
        with self.assertRaises(ValueError):
            identity.validate_provenance(candidate, REVISION, "200", "2")

    def test_first_release_requires_reviewed_exact_live_baseline(self):
        for initial in (None, {}, {"format": 1, "runtime": {}}):
            with self.assertRaises(ValueError):
                identity.verify_baseline(RUNTIME, None, initial, REVISION, 200, CHECKSUM)
        self.assertEqual(
            identity.verify_baseline(
                RUNTIME, None, {"format": 1, "runtime": RUNTIME}, REVISION, 200, CHECKSUM
            ),
            RUNTIME,
        )

    def test_same_image_with_private_source_or_web_overlay_is_rejected(self):
        for field in (*identity.API_KEYS, "web_tree"):
            altered = copy.deepcopy(RUNTIME)
            if field == "web_tree":
                altered[field] = "1" * 64
            else:
                altered["api"][field] = "1" * 64
            with self.subTest(field=field), self.assertRaises(ValueError):
                identity.verify_baseline(altered, state(), None, REVISION, 200, CHECKSUM)

    def test_image_drift_is_rejected(self):
        altered = copy.deepcopy(RUNTIME)
        altered["api_image"] = "sha256:" + "1" * 64
        with self.assertRaises(ValueError):
            identity.verify_baseline(altered, state(), None, REVISION, 200, CHECKSUM)

    def test_stale_run_and_changed_replay_are_rejected(self):
        for run, revision, digest in [
            (198, REVISION, CHECKSUM),
            (199, REVISION, CHECKSUM),
            (199, "b" * 40, "c" * 64),
        ]:
            with self.assertRaises(ValueError):
                identity.verify_baseline(RUNTIME, state(), None, revision, run, digest)
        self.assertEqual(
            identity.verify_baseline(RUNTIME, state(), None, "b" * 40, 199, CHECKSUM), RUNTIME
        )

    def test_private_state_requires_owner_and_no_symlink_or_public_permissions(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "state.json"
            self.assertIsNone(identity.read_state(path, os.getuid()))
            path.write_text(json.dumps(state()))
            path.chmod(0o600)
            self.assertEqual(identity.read_state(path, os.getuid()), state())
            path.chmod(0o644)
            with self.assertRaises(ValueError):
                identity.read_state(path, os.getuid())
            path.chmod(0o600)
            with self.assertRaises(ValueError):
                identity.read_state(path, os.getuid() + 1)
            link = path.with_name("link.json")
            link.symlink_to(path)
            with self.assertRaises(ValueError):
                identity.read_state(link, os.getuid())

    def test_web_fingerprint_covers_all_assets_and_rejects_duplicates(self):
        text = "a" * 64 + "  ./index.html\n" + "b" * 64 + "  ./assets/a.js\n"
        original = identity.web_fingerprint(text)
        self.assertNotEqual(original, identity.web_fingerprint(text + "c" * 64 + "  ./extra.svg\n"))
        for extra in (text, "c" * 64 + "  ./../escape\n", "c" * 64 + "  /abs\n"):
            with self.assertRaises(ValueError):
                identity.web_fingerprint(text + extra)

    def test_archive_checksum_and_manifest_provenance_are_bound(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "release.tar.gz"
            body = json.dumps(manifest()).encode()
            with tarfile.open(path, "w:gz") as archive:
                info = tarfile.TarInfo("manifest.json")
                info.size = len(body)
                archive.addfile(info, io.BytesIO(body))
            checksum = hashlib.sha256(path.read_bytes()).hexdigest()
            self.assertEqual(
                identity.load_request(path, REVISION, checksum, "200", "2"), manifest()
            )
            with self.assertRaises(ValueError):
                identity.load_request(path, REVISION, CHECKSUM, "200", "2")
            with self.assertRaises(ValueError):
                identity.load_request(path, REVISION, checksum, "201", "2")

    def test_actual_probe_detects_same_version_dependency_edits_and_added_files(self):
        import contextlib
        import importlib.metadata
        import importlib.util
        import sysconfig
        from types import SimpleNamespace

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "site/qunxue_api"
            (source / "adapters/retrieval").mkdir(parents=True)
            (source / "__init__.py").write_text("")
            (source / "adapters/retrieval/sqlite_index.py").write_text("schema = 1")
            for name in ("migrations", "ops", "tokenizer"):
                (root / name).mkdir()
                (root / name / "fixture.py").write_text("fixture = 1")
            dependency = root / "site/dependency.py"
            dependency.write_text("version = 1")
            distribution = SimpleNamespace(
                metadata={"Name": "dependency"},
                version="1.0",
                files=[Path("dependency.py")],
                locate_file=lambda item: root / "site" / item,
            )
            code = identity.API_PROBE
            for original, replacement in (
                ("/app/backend/migrations", root / "migrations"),
                ("/app/ops", root / "ops"),
                ("/opt/tiktoken-cache", root / "tokenizer"),
            ):
                code = code.replace(repr(original), repr(str(replacement)))

            def probe():
                output = io.StringIO()
                with (
                    patch.object(sys, "prefix", str(root)),
                    patch.object(
                        importlib.util,
                        "find_spec",
                        return_value=SimpleNamespace(submodule_search_locations=[str(source)]),
                    ),
                    patch.object(importlib.metadata, "distributions", return_value=[distribution]),
                    patch.object(sysconfig, "get_path", return_value=str(root / "site")),
                    contextlib.redirect_stdout(output),
                ):
                    exec(code, {})
                return identity.validate_api(json.loads(output.getvalue()))

            original = probe()
            dependency.write_text("version = 2")
            edited = probe()
            self.assertNotEqual(original["dependency_tree"], edited["dependency_tree"])
            dependency.write_text("version = 1")
            (root / "site/untracked_dependency.py").write_text("new = True")
            added = probe()
            self.assertNotEqual(original["dependency_tree"], added["dependency_tree"])
            self.assertEqual(original["source_tree"], added["source_tree"])
            (root / "tokenizer/fixture.py").write_text("cache changed")
            self.assertNotEqual(original["tokenizer_tree"], probe()["tokenizer_tree"])

    def test_probe_is_stdlib_read_only_and_no_environment_or_database_content(self):
        for forbidden in ("os.environ", "sqlite3", "create_app", "requests", "httpx"):
            self.assertNotIn(forbidden, identity.API_PROBE)
        self.assertIn("importlib.util.find_spec", identity.API_PROBE)
        self.assertIn("__pycache__", identity.API_PROBE)

    def test_live_drift_blocks_existing_release_before_image_load_or_service_stop(self):
        spec = importlib.util.spec_from_file_location(
            "integration_fixture", ROOT / "ops/tests/test_existing_release.py"
        )
        fixture = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(fixture)
        case = fixture.ExistingReleaseTests(
            methodName="test_success_keeps_original_data_and_uses_candidate_snapshot"
        )
        case.setUp()
        try:
            with (
                patch.object(
                    fixture.release, "verify_baseline", side_effect=ValueError("live drift")
                ),
                self.assertRaises(ValueError),
            ):
                case.execute()
            self.assertFalse(
                any(args[:2] in (["docker", "stop"], ["docker", "load"]) for args in case.calls)
            )
        finally:
            case.doCleanups()


if __name__ == "__main__":
    unittest.main()
