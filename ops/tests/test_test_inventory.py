"""Test selection drift is a release-safety check, including documentation-only CI."""
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location(
    "test_inventory", ROOT / "ops/cd/check_test_inventory.py",
)
inventory = importlib.util.module_from_spec(spec)
spec.loader.exec_module(inventory)


class TestInventoryTests(unittest.TestCase):
    def test_repository_test_files_are_selected_or_explicitly_recorded(self):
        self.assertEqual(inventory.violations(ROOT), [])

    def test_unknown_new_tests_and_stale_duplicate_registrations_fail(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            tests = root / "backend/tests"
            tests.mkdir(parents=True)
            (tests / "test_new.py").write_text("def test_new(): pass\n")
            (tests / "product-suite.txt").write_text(
                "tests/test_deleted.py\ntests/test_deleted.py\n",
            )
            (tests / "deferred-suite.json").write_text(json.dumps({"groups": []}))
            errors = inventory.violations(root)
            self.assertIn("unclassified test: backend/tests/test_new.py", errors)
            self.assertIn("stale product registration: backend/tests/test_deleted.py", errors)
            self.assertIn("duplicate product registration: backend/tests/test_deleted.py", errors)

    def test_automatic_lanes_match_their_actual_discovery_scope(self):
        for path in ("ops/tests/nested/test_lost.py", "ops/tests/test_lost.test.mjs",
                     "gateway/tests/lost.test.mjs", "gateway/tests/lost.test.py",
                     "gateway/tests/dist/test_lost.py", "gateway/tests/.hidden/test_lost.py",
                     "extensions/clipper/test/nested/lost.test.mjs"):
            self.assertIsNone(inventory.selected_lane(path, []), path)

    def test_deferred_hash_and_double_classification_are_not_silent(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            tests = root / "backend/tests"
            tests.mkdir(parents=True)
            (tests / "test_changed.py").write_text("def test_changed(): pass\n")
            (tests / "product-suite.txt").write_text("tests/test_changed.py\n")
            (tests / "deferred-suite.json").write_text(json.dumps({"groups": [{
                "category": "baseline_review_pending", "reason": "Not a pass claim",
                "files": [{"path": "backend/tests/test_changed.py", "sha256": "stale"},
                          {"path": "backend/tests/test_removed.py", "sha256": "stale"}],
            }]}))
            errors = inventory.violations(root)
            self.assertIn(
                "test is both selected and deferred: backend/tests/test_changed.py", errors,
            )
            self.assertIn("changed deferred test requires reclassification: "
                          "backend/tests/test_changed.py", errors)
            self.assertIn("stale deferred registration: backend/tests/test_removed.py", errors)

    def test_existing_workflow_runs_each_automatic_nonbackend_lane(self):
        ci = (ROOT / ".github/workflows/ci.yml").read_text()
        self.assertIn("uv run python -m unittest discover -s ../ops/tests -v", ci)
        self.assertIn("npm --prefix frontend run check:boundaries", ci)
        self.assertIn("npm --prefix frontend run check:styles", ci)
        self.assertIn("npm --prefix frontend run test", ci)
        self.assertIn("npm --prefix extensions/clipper test", ci)
        self.assertIn("run: make bootstrap", ci)
        makefile = (ROOT / "Makefile").read_text()
        self.assertIn("bootstrap: bootstrap-backend bootstrap-frontend bootstrap-clipper", makefile)
        self.assertIn("cd extensions/clipper && npm ci --ignore-scripts", makefile)
        self.assertIn("python3 extensions/clipper/test/setup.test.py", ci)
        gateway = (ROOT / "gateway/scripts/verify-local.sh").read_text()
        self.assertIn("gateway/.venv/bin/pytest gateway/tests", gateway)
        self.assertIn("gateway/.venv/bin/pytest gateway/integration/test_http_contract.py", gateway)


if __name__ == "__main__":
    unittest.main()
