"""Writing activation preserves every existing environment and billing policy."""

import importlib.util
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "ops/cd"))
spec = importlib.util.spec_from_file_location("writing_release", ROOT / "ops/cd/deploy-existing.py")
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class WritingBillingPolicyTests(unittest.TestCase):
    def configure(self, phases, requested=None):
        current = {"EVERPLAIN_BILLING_PHASE_POLICIES": phases, "KEEP": "synthetic-private-value"}
        report = {}
        result = release.configure_billing_policy(
            current, {"add_user_billing_phases": ["writing"] if requested is None else requested},
            report,
        )
        self.assertEqual(current["EVERPLAIN_BILLING_PHASE_POLICIES"], phases)
        self.assertEqual(result["KEEP"], current["KEEP"])
        return result, report

    def test_adds_writing_without_changing_other_phases(self):
        result, report = self.configure('{"search":"user","research":"operator"}')
        self.assertEqual(json.loads(result["EVERPLAIN_BILLING_PHASE_POLICIES"]),
                         {"search": "user", "research": "operator", "writing": "user"})
        self.assertTrue(report["billing_policy_changed"])

    def test_existing_user_policy_preserves_exact_bytes(self):
        phases = '{ "writing": "user", "search": "user" }'
        result, report = self.configure(phases)
        self.assertEqual(result["EVERPLAIN_BILLING_PHASE_POLICIES"], phases)
        self.assertFalse(report["billing_policy_changed"])

    def test_no_request_preserves_exact_bytes(self):
        result, report = self.configure("not-JSON", [])
        self.assertEqual(result["EVERPLAIN_BILLING_PHASE_POLICIES"], "not-JSON")
        self.assertFalse(report["billing_policy_update_requested"])

    def test_rejects_operator_writing_and_invalid_existing_policy(self):
        for phases in ('{"writing":"operator"}', '{"search":"other"}', '[]', 'null',
                       '{"search":"user","search":"operator"}', 'not-JSON'):
            with self.subTest(phases=phases), self.assertRaises(RuntimeError):
                self.configure(phases)

    def test_rejects_unapproved_phase_changes(self):
        for requested in (["search"], ["writing", "search"], "writing", None):
            with self.subTest(requested=requested), self.assertRaises(RuntimeError):
                release.configure_billing_policy({}, {"add_user_billing_phases": requested}, {})


if __name__ == "__main__":
    unittest.main()
