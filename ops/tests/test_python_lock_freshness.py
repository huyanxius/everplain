"""Run real uv against offline wheels through the shipped install commands.

CI supplies its pinned uv. To also verify the gateway image's pinned uv, put that
version first on PATH and run this file again. No registry or Docker is needed;
these tests validate install commands, not complete image builds.
"""

import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def wheel(directory, name, version):
    """A tiny valid pure-Python wheel, with no build backend or network access."""
    info = f"{name}-{version}.dist-info"
    with zipfile.ZipFile(directory / f"{name}-{version}-py3-none-any.whl", "w") as archive:
        archive.writestr(f"{name}.py", f"VERSION = {version!r}\n")
        archive.writestr(
            f"{info}/METADATA",
            f"Metadata-Version: 2.1\nName: {name}\nVersion: {version}\n",
        )
        archive.writestr(
            f"{info}/WHEEL",
            "Wheel-Version: 1.0\nGenerator: fixture\nRoot-Is-Purelib: true\n"
            "Tag: py3-none-any\n",
        )
        archive.writestr(f"{info}/RECORD", "")


class PythonLockFreshnessTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.uv = shutil.which("uv")
        if cls.uv is None:
            raise AssertionError("Install the CI or Docker pinned uv before running these tests")
        version = subprocess.check_output([cls.uv, "--version"], text=True).split()[1]
        if version not in {"0.11.29", "0.12.19"}:
            raise AssertionError(f"Use an existing repository uv pin, not {version}")

    def consumers(self):
        # Execute the actual Make target rather than duplicating its uv flags.
        yield "make-backend", ["make", "bootstrap-backend"], "backend", False
        # Preserve each real Make uv run prefix; replace only the application
        # payload so contract exports, test runners and dev servers are not run.
        makefile = (ROOT / "Makefile").read_text()
        commands = re.findall(r"uv --cache-dir \$\(UV_CACHE_DIR\) run ([^\n]+)", makefile)
        self.assertEqual(len(commands), 5)
        for index, command in enumerate(commands):
            arguments = shlex.split(command)
            flags = []
            while arguments and arguments[0].startswith("--"):
                flags.append(arguments.pop(0))
            yield f"make-run-{index}", ["uv", "run", *flags, "python", "-c",
                                       "import fixture_dep; from pathlib import Path; "
                                       "Path('command-ran').touch()"], "backend", True
        workflow = (ROOT / ".github/workflows/channel-gateway.yml").read_text()
        commands = re.findall(r"^\s+(uv sync --project (backend|gateway) [^\n]+)$", workflow, re.M)
        self.assertEqual(len(commands), 2)
        for command, project in commands:
            yield f"workflow-{project}", shlex.split(command), project, False
        for source, project, count in (
            ("ops/api.Dockerfile", "backend", 2),
            ("gateway/Dockerfile", "gateway", 1),
        ):
            commands = re.findall(
                r"^RUN (uv sync[^\n&\\]+)", (ROOT / source).read_text(), re.M,
            )
            self.assertEqual(len(commands), count)
            for index, command in enumerate(commands):
                yield f"{source}-{index}", shlex.split(command), project, True

    def test_install_consumers_reject_stale_locks_without_rewriting(self):
        for name, command, project_name, project_cwd in self.consumers():
            for mutation in (None, "new-dependency", "incompatible-pin", "missing-lock"):
                with (
                    self.subTest(consumer=name, mutation=mutation),
                    tempfile.TemporaryDirectory() as d,
                ):
                    root = Path(d)
                    project = root / project_name
                    project.mkdir()
                    wheels = root / "wheels"
                    wheels.mkdir()
                    wheel(wheels, "fixture_dep", "1.0.0")
                    wheel(wheels, "fixture_dep", "2.0.0")
                    wheel(wheels, "fixture_new", "1.0.0")
                    pyproject = project / "pyproject.toml"
                    declaration = (
                        '[project]\nname = "lock-fixture"\nversion = "0.1.0"\n'
                        'requires-python = ">=3.12"\ndependencies = ["fixture-dep==1.0.0"]\n'
                        f'[tool.uv]\nno-index = true\nfind-links = [{json.dumps(str(wheels))}]\n'
                    )
                    pyproject.write_text(declaration)
                    shutil.copyfile(ROOT / "Makefile", root / "Makefile")
                    # Use a private cache and interpreter; prevent downloads or inherited
                    # frozen/no-sync settings from weakening the freshness check.
                    env = {k: v for k, v in os.environ.items() if not k.startswith("UV_")}
                    env.update(
                        UV_OFFLINE="1", UV_PYTHON_DOWNLOADS="never", UV_PYTHON=sys.executable,
                        UV_CACHE_DIR=str(root / "cache"),
                        PATH=str(Path(self.uv).parent) + os.pathsep + os.environ["PATH"],
                    )
                    result = subprocess.run(
                        [self.uv, "lock", "--project", str(project)], env=env,
                        capture_output=True, text=True, timeout=30,
                    )
                    self.assertEqual(result.returncode, 0, result.stderr)
                    lock = project / "uv.lock"
                    original = lock.read_bytes()
                    if mutation == "new-dependency":
                        pyproject.write_text(declaration.replace(
                            '"fixture-dep==1.0.0"]',
                            '"fixture-dep==1.0.0", "fixture-new==1.0.0"]',
                        ))
                    elif mutation == "incompatible-pin":
                        pyproject.write_text(declaration.replace(
                            "fixture-dep==1.0.0", "fixture-dep==2.0.0",
                        ))
                    elif mutation == "missing-lock":
                        lock.unlink()
                    result = subprocess.run(
                        command, cwd=project if project_cwd else root, env=env,
                        capture_output=True, text=True, timeout=30,
                    )
                    if mutation:
                        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
                        self.assertIn("lockfile", result.stderr.lower())
                    else:
                        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                        installed = subprocess.check_output(
                            [str(project / ".venv/bin/python"), "-c",
                             "import fixture_dep; print(fixture_dep.VERSION)"], text=True,
                        )
                        self.assertEqual(installed.strip(), "1.0.0")
                    if name.startswith("make-run-"):
                        self.assertEqual((project / "command-ran").exists(), mutation is None)
                    if mutation == "missing-lock":
                        self.assertFalse(lock.exists(), "Install must not create a missing lock")
                    else:
                        self.assertEqual(lock.read_bytes(), original, "Install rewrote uv.lock")
                    if mutation:
                        # Positive control: the changed declaration is solvable offline.
                        # Failure above must be freshness, not unavailable packages.
                        control = subprocess.run(
                            [self.uv, "lock", "--project", str(project)], env=env,
                            capture_output=True, text=True, timeout=30,
                        )
                        self.assertEqual(control.returncode, 0, control.stderr)
                        if mutation != "missing-lock":
                            self.assertNotEqual(lock.read_bytes(), original)


if __name__ == "__main__":
    unittest.main()
