"""Offline additive operator summary policy, exact activation, and privacy checks."""

import contextlib
import importlib.util
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "ops/cd"))
spec = importlib.util.spec_from_file_location("summary_release", ROOT / "ops/cd/deploy-existing.py")
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)

SUMMARY = {"add_operator_billing_phases": ["conversation_summary"]}
MIXED = {**SUMMARY, "add_user_billing_phases": ["writing"]}


class SummaryBillingPolicyTests(unittest.TestCase):
    def configure(self, phases, policy=SUMMARY):
        current = {
            "EVERPLAIN_BILLING_PHASE_POLICIES": phases,
            "EVERPLAIN_MODEL_API_KEY": "synthetic-private-value",
            "EVERPLAIN_BILLING_MODEL_PRICES": '{ "private-model": { "input": 12 } }',
            "EVERPLAIN_BILLING_POINTS_PER_CNY": "100",
        }
        before = dict(current)
        report = {}
        output = io.StringIO()
        with contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
            result = release.configure_billing_policy(current, policy, report)
        self.assertEqual(current, before)
        self.assertIsNot(result, current)
        self.assertEqual(
            {k: v for k, v in result.items() if k != "EVERPLAIN_BILLING_PHASE_POLICIES"},
            {k: v for k, v in before.items() if k != "EVERPLAIN_BILLING_PHASE_POLICIES"},
        )
        self.assertEqual(output.getvalue(), "")
        self.assertTrue(all(type(value) is bool for value in report.values()))
        self.assertNotIn("synthetic-private-value", json.dumps(report))
        self.assertNotIn("private-model", json.dumps(report))
        return result, report

    def test_summary_adds_only_operator_phase_and_preserves_unrequested_modes_and_costs(self):
        result, report = self.configure(
            '{"search":"user","research":"operator","writing":"operator"}'
        )
        self.assertEqual(
            json.loads(result["EVERPLAIN_BILLING_PHASE_POLICIES"]),
            {
                "search": "user",
                "research": "operator",
                "writing": "operator",
                "conversation_summary": "operator",
            },
        )
        self.assertTrue(report["billing_policy_changed"])
        self.assertTrue(report["conversation_summary_operator_policy_update_requested"])
        self.assertFalse(report["writing_user_policy_update_requested"])

    def test_absent_environment_adds_only_requested_phase(self):
        report = {}
        current = {"KEEP": "synthetic-private-value"}
        result = release.configure_billing_policy(current, SUMMARY, report)
        self.assertEqual(current, {"KEEP": "synthetic-private-value"})
        self.assertEqual(
            result,
            {**current, "EVERPLAIN_BILLING_PHASE_POLICIES": '{"conversation_summary":"operator"}'},
        )

    def test_existing_operator_preserves_exact_raw_json(self):
        phases = (
            '{ "writing": "operator", "conversation_summary" : "operator", "search": "user" }\n'
        )
        result, report = self.configure(phases)
        self.assertEqual(result["EVERPLAIN_BILLING_PHASE_POLICIES"], phases)
        self.assertFalse(report["billing_policy_changed"])

    def test_repeated_addition_is_exactly_idempotent(self):
        first, _ = self.configure('{"search":"user"}', MIXED)
        raw = first["EVERPLAIN_BILLING_PHASE_POLICIES"]
        second, report = self.configure(raw, MIXED)
        self.assertEqual(second, first)
        self.assertEqual(second["EVERPLAIN_BILLING_PHASE_POLICIES"], raw)
        self.assertFalse(report["billing_policy_changed"])

    def test_mixed_request_adds_both_without_changing_other_phases(self):
        result, report = self.configure('{"search":"user","research":"operator"}', MIXED)
        self.assertEqual(
            json.loads(result["EVERPLAIN_BILLING_PHASE_POLICIES"]),
            {
                "search": "user",
                "research": "operator",
                "writing": "user",
                "conversation_summary": "operator",
            },
        )
        self.assertTrue(report["writing_user_policy_update_requested"])
        self.assertTrue(report["conversation_summary_operator_policy_update_requested"])

    def test_mixed_request_preserves_exact_raw_json_without_delta(self):
        phases = '{ "writing" : "user", "conversation_summary" : "operator" }\n'
        result, report = self.configure(phases, MIXED)
        self.assertEqual(result["EVERPLAIN_BILLING_PHASE_POLICIES"], phases)
        self.assertFalse(report["billing_policy_changed"])

    def test_mixed_request_adds_only_missing_phase(self):
        for phases in (
            '{"writing":"user","search":"user"}',
            '{"conversation_summary":"operator","search":"user"}',
        ):
            with self.subTest(phases=phases):
                result, report = self.configure(phases, MIXED)
                self.assertEqual(
                    json.loads(result["EVERPLAIN_BILLING_PHASE_POLICIES"]),
                    {"search": "user", "writing": "user", "conversation_summary": "operator"},
                )
                self.assertTrue(report["billing_policy_changed"])

    def test_empty_requests_preserve_unparsed_policy(self):
        result, report = self.configure(
            "not-JSON", {"add_user_billing_phases": [], "add_operator_billing_phases": []}
        )
        self.assertEqual(result["EVERPLAIN_BILLING_PHASE_POLICIES"], "not-JSON")
        self.assertFalse(report["billing_policy_update_requested"])

    def test_refuses_existing_user_summary_without_mutation_or_private_output(self):
        for policy in (SUMMARY, MIXED):
            current = {
                "EVERPLAIN_BILLING_PHASE_POLICIES": (
                    '{"synthetic-private-phase":"operator","conversation_summary":"user"}'
                ),
                "KEEP": "synthetic-private-value",
            }
            before = dict(current)
            report, output = {}, io.StringIO()
            with (
                contextlib.redirect_stdout(output),
                contextlib.redirect_stderr(output),
                self.assertRaises(RuntimeError) as error,
            ):
                release.configure_billing_policy(current, policy, report)
            self.assertEqual(current, before)
            self.assertFalse(report["billing_policy_changed"])
            for private in ("synthetic-private-phase", "synthetic-private-value"):
                self.assertNotIn(
                    private, str(error.exception) + json.dumps(report) + output.getvalue()
                )

    def test_mixed_conflict_never_partially_applies_writing_or_summary(self):
        for phases in ('{"writing":"operator"}', '{"conversation_summary":"user"}'):
            current, report = {"EVERPLAIN_BILLING_PHASE_POLICIES": phases}, {}
            with self.subTest(phases=phases), self.assertRaises(RuntimeError):
                release.configure_billing_policy(current, MIXED, report)
            self.assertEqual(current, {"EVERPLAIN_BILLING_PHASE_POLICIES": phases})
            self.assertFalse(report["billing_policy_changed"])

    def test_refuses_duplicate_json_keys_and_invalid_existing_policy(self):
        for phases in (
            '{"conversation_summary":"operator","conversation_summary":"operator"}',
            '{"search":"user","search":"operator"}',
            '{"search":"other"}',
            '{"search":null}',
            '{"search":{"mode":"user"}}',
            "[]",
            "null",
            "not-JSON",
        ):
            with self.subTest(phases=phases), self.assertRaises(RuntimeError):
                self.configure(phases)

    def test_refuses_unsupported_operator_and_user_requests(self):
        for requested in (
            ["writing"],
            ["search"],
            ["conversation_summary", "search"],
            ["conversation_summary", "conversation_summary"],
            "conversation_summary",
            None,
            {},
            True,
        ):
            with self.subTest(requested=requested), self.assertRaises(RuntimeError):
                release.configure_billing_policy({}, {"add_operator_billing_phases": requested}, {})
        for requested in (["conversation_summary"], ["writing", "conversation_summary"]):
            with self.subTest(requested=requested), self.assertRaises(RuntimeError):
                release.configure_billing_policy(
                    {}, {**SUMMARY, "add_user_billing_phases": requested}, {}
                )

    def test_shipped_policy_requests_only_reviewed_additions(self):
        policy = json.loads((ROOT / "ops/cd/policy.json").read_text())
        self.assertEqual(policy["add_user_billing_phases"], ["writing"])
        self.assertEqual(policy["add_operator_billing_phases"], ["conversation_summary"])


class BillingPolicyActivationTests(unittest.TestCase):
    def complete(self, directory, policy, active):
        update = release.ExistingRelease(Path(directory) / "archive")
        expected = release.configure_billing_policy(
            {"EVERPLAIN_BILLING_PHASE_POLICIES": '{"search":"user"}'}, policy, update.report
        )
        update.expected_billing_policy = expected["EVERPLAIN_BILLING_PHASE_POLICIES"]
        update.state_path = Path(directory) / "state.json"
        update.images = {"api": "api-image", "web": "web-image"}
        actual = {
            "api": {"source_tree": "public-hash"},
            "web_tree": "public-hash",
            "api_image": "api-image",
            "web_image": "web-image",
        }
        manifest = {"runtime_identity": {"api": actual["api"], "web_tree": actual["web_tree"]}}
        if active is None:
            active = update.expected_billing_policy
        info = {
            "Config": {
                "Env": [
                    "EVERPLAIN_RUNTIME_MODE=base",
                    "EVERPLAIN_DATABASE_URL=sqlite:////data/everplain.db",
                    "EVERPLAIN_RETRIEVAL_INDEX_PATH=/data/everplain-retrieval.db",
                    "EVERPLAIN_BILLING_PHASE_POLICIES=" + active,
                    "KEEP=synthetic-private-value",
                ]
            }
        }
        with (
            patch.object(release, "snapshot", return_value=actual),
            patch.object(release, "metadata", return_value=info),
            patch.object(release, "RUN_ID", "200"),
            patch.object(release, "RUN_ATTEMPT", "1"),
        ):
            update.complete(manifest)
        return update

    def test_reports_exact_activation_only_for_requested_modes_and_never_private_values(self):
        for policy, writing, summary in (
            (SUMMARY, False, True),
            (MIXED, True, True),
            ({"add_user_billing_phases": ["writing"]}, True, False),
        ):
            with self.subTest(policy=policy), tempfile.TemporaryDirectory() as directory:
                update = self.complete(directory, policy, None)
                self.assertEqual(update.report.get("writing_user_policy_verified", False), writing)
                self.assertEqual(
                    update.report.get("conversation_summary_operator_policy_verified", False),
                    summary,
                )
                self.assertTrue(update.report["runtime_identity_verified"])
                self.assertNotIn("synthetic-private-value", json.dumps(update.report))
                self.assertNotIn("synthetic-private-value", update.state_path.read_text())

    def test_refuses_any_activated_json_difference_even_equivalent_formatting(self):
        for active in (
            '{"search":"user","writing":"user"}',
            '{"conversation_summary":"user","search":"user","writing":"user"}',
            '{"conversation_summary":"operator","search":"operator","writing":"user"}',
            '{"conversation_summary":"operator","search":"user","writing":"operator"}',
            '{"conversation_summary":"operator","search":"user","writing":"user","extra":"user"}',
            '{ "conversation_summary": "operator", "search": "user", "writing": "user" }',
        ):
            with self.subTest(active=active), tempfile.TemporaryDirectory() as directory:
                with self.assertRaisesRegex(RuntimeError, "activated billing policy differs"):
                    self.complete(directory, MIXED, active)
                self.assertFalse((Path(directory) / "state.json").exists())


if __name__ == "__main__":
    unittest.main()
