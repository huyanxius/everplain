"""Offline impact/cache invariants, not a claim of a real Docker build."""

import importlib.util
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("changed_paths", ROOT / "ops/cd/changed_paths.py")
changed_paths = importlib.util.module_from_spec(spec)
spec.loader.exec_module(changed_paths)


class ReleaseEfficiencyTests(unittest.TestCase):
    def test_missing_or_failed_diff_fails_closed(self):
        for paths, ok in (([], True), (["docs/example.md"], False)):
            self.assertEqual(set(changed_paths.impact(paths, diff_ok=ok).values()), {True})

    def test_unknown_runtime_workflow_and_root_paths_run_every_gate(self):
        for path in ("ops/api.Dockerfile", "ops/web.Dockerfile", "ops/new.py",
                     ".github/workflows/ci.yml", ".dockerignore", "Makefile",
                     "new-component/source.ts", "backend-new/source.py"):
            with self.subTest(path=path):
                self.assertEqual(set(changed_paths.impact([path]).values()), {True})

    def test_docs_do_not_build_runtime(self):
        self.assertEqual(set(changed_paths.impact(["docs/run.md"]).values()), {False})

    def test_backend_runtime_keeps_contract_and_release_checks(self):
        self.assertEqual(set(changed_paths.impact(["backend/src/service.py"]).values()), {True})

    def test_web_and_clipper_keep_frontend_and_release(self):
        for path in ("frontend/src/main.tsx", "extensions/clipper/build.mjs"):
            self.assertEqual(changed_paths.impact([path]),
                             {"backend": False, "frontend": True, "release": True})

    def test_excluded_tests_keep_checks_without_runtime_build(self):
        for path in ("backend/tests/test_api.py", "ops/tests/test_cd.py"):
            self.assertEqual(changed_paths.impact([path]),
                             {"backend": True, "frontend": False, "release": False})

    def test_mixed_changes_are_union_not_first_match(self):
        for paths in (["docs/run.md", "backend/src/service.py"],
                      ["frontend/src/main.tsx", "ops/tests/test_cd.py"]):
            self.assertEqual(set(changed_paths.impact(paths).values()), {True})

    def test_runtime_rename_into_docs_still_runs_every_gate(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            def git(*args):
                return subprocess.check_output(["git", *args], cwd=root, text=True).strip()
            git("init", "-q")
            (root / "backend").mkdir()
            (root / "backend/source.py").write_text("original runtime content\n" * 20)
            git("add", ".")
            git("-c", "user.name=Test", "-c", "user.email=test@example.invalid",
                "commit", "-qm", "initial")
            base = git("rev-parse", "HEAD")
            (root / "docs").mkdir()
            git("mv", "backend/source.py", "docs/source.py")
            git("-c", "user.name=Test", "-c", "user.email=test@example.invalid",
                "commit", "-qm", "rename")
            output = root / "output"
            subprocess.run([sys.executable, str(ROOT / "ops/cd/changed_paths.py")],
                           cwd=root, env={**os.environ, "BASE_SHA": base,
                                          "GITHUB_OUTPUT": str(output)}, check=True)
            self.assertEqual(set(output.read_text().splitlines()),
                             {"backend=true", "frontend=true", "release=true"})

    def test_frontend_test_files_remain_conservative(self):
        self.assertTrue(changed_paths.impact(["frontend/src/main.test.tsx"])["release"])

    def test_every_deploy_exclusion_is_excluded_from_docker_context(self):
        deploy = (ROOT / ".github/workflows/deploy.yml").read_text()
        ignores = set((ROOT / ".dockerignore").read_text().splitlines())
        self.assertIn("needs.changes.outputs.release == 'true'", deploy)
        self.assertIn("run: python3 ops/cd/changed_paths.py", deploy)
        self.assertNotIn("paths-ignore:", deploy)
        paths = {"docs", "backend/tests", "ops/tests"}
        for path in paths:
            self.assertIn(path, ignores)
            self.assertFalse(changed_paths.impact([path + "/example.py"])["release"])

    def test_stable_pr_job_and_release_safety_are_retained(self):
        ci = (ROOT / ".github/workflows/ci.yml").read_text()
        self.assertIn("  release-build:\n", ci)
        self.assertIn("needs.changes.outputs.release == 'true'", ci)
        self.assertIn("run: python3 ops/cd/changed_paths.py", ci)
        self.assertIn("uv run python -m unittest discover -s ../ops/tests -v", ci)
        self.assertNotIn("continue-on-error", ci)

    def test_revision_arg_cannot_invalidate_dependency_or_asset_build(self):
        docker = (ROOT / "ops/web.Dockerfile").read_text()
        build, revision, stamp = (docker.index("RUN npm --prefix ../extensions/clipper run build"),
                                  docker.index("ARG RELEASE_REVISION="),
                                  docker.index("RUN printf"))
        self.assertLess(docker.index("RUN npm ci --ignore-scripts"), build)
        self.assertLess(build, revision)
        self.assertLess(revision, stamp)
        self.assertNotIn("RELEASE_REVISION", docker[:revision])
        self.assertIn('"$RELEASE_REVISION" > dist/revision.json', docker)
        self.assertIn("COPY --from=build /app/frontend/dist /usr/share/nginx/html", docker)

    def test_builder_cache_is_optional_publish_only_and_separate_from_release(self):
        build = (ROOT / "ops/cd/build.sh").read_text()
        target = build.index('docker build "${web_build[@]}" --target build')
        guard = build.rfind('if [[ "$publish" == true ]]; then', 0, target)
        self.assertGreater(guard, build.index("web_build=("))
        self.assertIn(
            "docker pull ghcr.io/huyanxius/everplain-web:builder-cache >/dev/null 2>&1 || true",
            build,
        )
        self.assertIn("docker push ghcr.io/huyanxius/everplain-web:builder-cache || echo", build)
        self.assertIn("--cache-from ghcr.io/huyanxius/everplain-web:builder-cache", build)
        self.assertIn('docker image inspect "everplain-web:$GITHUB_SHA"', build)
        self.assertLess(target, build.index('-t "everplain-web:$GITHUB_SHA"'))
        ci = (ROOT / ".github/workflows/ci.yml").read_text()
        self.assertNotIn("EVERPLAIN_PUBLISH_IMAGES", ci)
        deploy = (ROOT / ".github/workflows/deploy.yml").read_text()
        self.assertIn("github.event_name == 'push' && github.ref == 'refs/heads/main'", deploy)

    def test_artifact_and_oci_identity_still_bind_exact_commit(self):
        build = (ROOT / "ops/cd/build.sh").read_text()
        self.assertIn('"$(git rev-parse HEAD)" == "$GITHUB_SHA"', build)
        self.assertIn('--build-arg "RELEASE_REVISION=$GITHUB_SHA"', build)
        self.assertEqual(build.count('--label "org.opencontainers.image.revision=$GITHUB_SHA"'), 3)
        self.assertIn('-f gateway/Dockerfile', build)
        self.assertIn('--gateway-image "$gateway_id"', build)
        self.assertIn('python ops/cd/artifact.py "$GITHUB_SHA"', build)


if __name__ == "__main__":
    unittest.main()
