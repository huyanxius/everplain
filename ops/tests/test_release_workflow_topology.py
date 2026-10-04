"""Offline invariants for a single guarded Everplain release lane."""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORKFLOWS = ROOT / '.github' / 'workflows'


def job(source: str, name: str) -> str:
    match = re.search(rf'^  {re.escape(name)}:\n(.*?)(?=^  [\w-]+:\n|\Z)', source, re.M | re.S)
    if match is None:
        raise AssertionError(f'Missing job: {name}')
    return match.group(1)


class ReleaseWorkflowTopologyTests(unittest.TestCase):
    def test_build_is_parallel_but_deploy_retains_both_gates(self):
        text = (WORKFLOWS / 'deploy.yml').read_text()
        self.assertNotIn('needs: checks', job(text, 'build'))
        self.assertIn('needs: [checks, build]', job(text, 'deploy'))
        self.assertIn(
            "github.event_name == 'push' && github.ref == 'refs/heads/main'",
            job(text, 'deploy'),
        )
        self.assertIn('environment: everplain-production', job(text, 'deploy'))
        self.assertIn('EXPECTED_SHA256: ${{ needs.build.outputs.digest }}', job(text, 'deploy'))
        self.assertIn('name: everplain-${{ github.sha }}-${{ github.run_attempt }}', text)

    def test_first_release_requires_local_baseline_before_transfer(self):
        text = job((WORKFLOWS / 'deploy.yml').read_text(), 'deploy')
        self.assertIn('[[ ! -s ops/cd/live-baseline.json ]]', text)
        self.assertLess(text.index('Require a reviewed initial live baseline'),
                        text.index('actions/download-artifact@'))
        self.assertIn('exit 2', text)

    def test_legacy_fixed_candidate_cannot_be_dispatched(self):
        self.assertFalse((WORKFLOWS / 'publish-checked-candidate.yml').exists())
        for path in WORKFLOWS.glob('*.yml'):
            text = path.read_text()
            self.assertNotIn('37101235437', text)
            self.assertNotIn('everplain-0dae10baff6a78cb0e12f67cc6f5ad153336a8a4-1', text)

    def test_mutating_lanes_are_serialized_without_cancellation(self):
        for name in ('deploy.yml', 'repair-existing-web.yml'):
            text = (WORKFLOWS / name).read_text()
            self.assertIn('group: everplain-production\n  cancel-in-progress: false', text)
        repair = (WORKFLOWS / 'repair-existing-web.yml').read_text()
        self.assertIn('  workflow_dispatch:', repair)
        self.assertNotIn('  push:', repair)
        self.assertIn("if: github.ref == 'refs/heads/main'", repair)

    def test_existing_ci_and_security_boundaries_are_preserved(self):
        text = (WORKFLOWS / 'deploy.yml').read_text()
        self.assertIn('uses: ./.github/workflows/ci.yml', text)
        self.assertIn('permissions:\n  contents: read', text)
        self.assertIn('persist-credentials: false', text)
        self.assertNotIn("rollback-previous", text)
        self.assertNotIn("  workflow_dispatch:", text)
        self.assertNotIn('pull_request_target', text)
        self.assertNotIn('continue-on-error', text)


if __name__ == '__main__':
    unittest.main()
