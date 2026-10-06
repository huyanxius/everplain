"""Final-check failures must be visible even when conditional jobs are skipped."""
import importlib.util
import itertools
import json
import os
import subprocess
import sys
import unittest
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "ops/cd/ci_gate.py"


def needs(*, backend="true", frontend="true", release="true", event="pull_request"):
    return {
        "changes": {"result": "success", "outputs": {
            "backend": backend, "frontend": frontend, "release": release,
        }},
        "backend": {"result": "success"},
        "frontend": {"result": "success" if frontend == "true" else "skipped"},
        "channel-gateway": {"result": "success" if "true" in (backend, release) else "skipped"},
        "release-build": {"result": "success" if event == "pull_request" and release == "true"
                          else "skipped"},
    }


def workflow_gate_errors(source, expected_jobs):
    # PyYAML is already locked in the backend environment that runs ops tests.
    # Parse legal YAML forms (comments, quoted keys, flow maps and anchors), not
    # a text-layout subset that can accidentally hide a newly added job.
    try:
        workflow = yaml.safe_load(source)
    except yaml.YAMLError:
        return ["invalid workflow YAML"]
    if not isinstance(workflow, dict) or not isinstance(workflow.get("jobs"), dict):
        return ["workflow has no jobs mapping"]
    jobs = workflow["jobs"]
    gate = jobs.get("required-checks")
    if not isinstance(gate, dict):
        return ["workflow has no final gate mapping"]
    needed = gate.get("needs")
    if isinstance(needed, str):
        needed = [needed]
    if not isinstance(needed, list) or not all(isinstance(name, str) for name in needed):
        return ["gate needs is not an explicit job list"]
    errors = []
    if set(jobs) - {"required-checks"} != set(expected_jobs):
        errors.append("workflow jobs differ from gate policy")
    if set(needed) != set(jobs) - {"required-checks"}:
        errors.append("gate does not need every other workflow job")
    return errors


class FinalCIGateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not SCRIPT.is_file():
            raise AssertionError("Final CI gate implementation is missing")
        spec = importlib.util.spec_from_file_location("ci_gate", SCRIPT)
        cls.gate = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.gate)

    def test_all_legal_path_combinations_and_reusable_main_skips(self):
        for event, flags in itertools.product(
            ("pull_request", "push"), itertools.product(("false", "true"), repeat=3),
        ):
            with self.subTest(event=event, flags=flags):
                self.assertEqual(self.gate.failures(needs(
                    backend=flags[0], frontend=flags[1], release=flags[2], event=event,
                ), event), [])

    def test_failure_cancel_missing_and_unknown_results_cannot_pass(self):
        for job, result in itertools.product(needs(), ("failure", "cancelled", "", "pending")):
            with self.subTest(job=job, result=result):
                payload = needs()
                payload[job]["result"] = result
                self.assertTrue(self.gate.failures(payload, "pull_request"))
        for job in needs():
            payload = needs()
            del payload[job]
            self.assertTrue(self.gate.failures(payload, "pull_request"))

    def test_required_job_skip_fails_and_unneeded_failure_still_fails(self):
        for job in needs():
            payload = needs()
            payload[job]["result"] = "skipped"
            self.assertTrue(self.gate.failures(payload, "pull_request"), job)
        payload = needs(backend="false", frontend="false", release="false")
        payload["frontend"]["result"] = "failure"
        self.assertTrue(self.gate.failures(payload, "pull_request"))

    def test_missing_unknown_event_and_unregistered_result_cannot_pass(self):
        for event in ("", "workflow_call", "workflow_dispatch", "schedule", None):
            payload = needs(event="push")
            self.assertTrue(self.gate.failures(payload, event), event)
        payload = needs()
        payload["new-check"] = {"result": "success"}
        self.assertTrue(self.gate.failures(payload, "pull_request"))

    def test_added_workflow_job_cannot_escape_aggregation(self):
        source = (ROOT / ".github/workflows/ci.yml").read_text()
        self.assertEqual(workflow_gate_errors(source, self.gate.JOBS), [])
        for declaration in (
            "  new-check:\n    runs-on: ubuntu-latest\n    steps: []\n",
            "  new-check: # required extra check\n    runs-on: ubuntu-latest\n    steps: []\n",
            '  "new-check": {runs-on: ubuntu-latest, steps: []}\n',
        ):
            changed = source + "\n" + declaration
            self.assertIn("gate does not need every other workflow job",
                          workflow_gate_errors(changed, self.gate.JOBS))
        parsed = yaml.safe_load(source)
        # A complete flow-style document must have the same coverage semantics.
        self.assertEqual(workflow_gate_errors(
            yaml.safe_dump(parsed, default_flow_style=True), self.gate.JOBS,
        ), [])

    def test_unknown_or_missing_path_flags_fail_closed(self):
        for flag, value in itertools.product(("backend", "frontend", "release"),
                                             (None, "", "TRUE", True, "unknown")):
            payload = needs()
            payload["changes"]["outputs"][flag] = value
            self.assertTrue(self.gate.failures(payload, "pull_request"))
        payload = needs()
        del payload["changes"]["outputs"]
        self.assertTrue(self.gate.failures(payload, "pull_request"))

    def test_unknown_changed_path_makes_skips_illegal(self):
        spec = importlib.util.spec_from_file_location(
            "changed_paths", ROOT / "ops/cd/changed_paths.py",
        )
        changed = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(changed)
        flags = {k: str(v).lower() for k, v in changed.impact(["new-component/source.py"]).items()}
        payload = needs(**flags)
        self.assertEqual(self.gate.failures(payload, "pull_request"), [])
        for job in ("frontend", "channel-gateway", "release-build"):
            skipped = json.loads(json.dumps(payload))
            skipped[job]["result"] = "skipped"
            self.assertTrue(self.gate.failures(skipped, "pull_request"))

    def test_cli_rejects_malformed_input_and_propagates_failure(self):
        for payload, expected in (("[]", 1), ("{", 1), (json.dumps(needs()), 0)):
            completed = subprocess.run([sys.executable, str(SCRIPT)],
                                       env={**os.environ, "CI_NEEDS": payload,
                                            "CI_EVENT_NAME": "pull_request"},
                                       capture_output=True, text=True)
            self.assertEqual(completed.returncode, expected, completed.stderr)

    def test_workflow_covers_all_five_existing_jobs_and_runs_after_failure(self):
        source = (ROOT / ".github/workflows/ci.yml").read_text()
        self.assertIn("  required-checks:\n", source)
        gate = source.split("  required-checks:\n", 1)[1]
        self.assertIn("    name: Required checks\n", gate)
        self.assertIn("    if: ${{ always() }}\n", gate)
        self.assertIn(
            "    needs: [changes, release-build, channel-gateway, backend, frontend]\n", gate,
        )
        self.assertIn("CI_NEEDS: ${{ toJSON(needs) }}", gate)
        self.assertIn("CI_EVENT_NAME: ${{ github.event_name }}", gate)
        self.assertIn("run: python3 ops/cd/ci_gate.py", gate)
        self.assertNotIn("continue-on-error", gate)


if __name__ == "__main__":
    unittest.main()
