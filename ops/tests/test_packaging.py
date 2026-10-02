"""Source-level release packaging checks; these do not build Docker images."""

import tomllib
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


class PackagingTests(unittest.TestCase):
    def test_web_build_generates_clipper_zip_in_frontend_public_directory(self):
        dockerfile = (ROOT / "ops/web.Dockerfile").read_text()
        self.assertIn("apt-get install -y --no-install-recommends python3", dockerfile)
        self.assertIn("COPY extensions/clipper/ ./extensions/clipper/", dockerfile)
        self.assertIn("RUN npm --prefix extensions/clipper ci --ignore-scripts", dockerfile)
        frontend_workdir = dockerfile.index("WORKDIR /app/frontend")
        clipper_build = dockerfile.index("npm --prefix ../extensions/clipper run build")
        frontend_build = dockerfile.index("npm run build", clipper_build)
        self.assertLess(frontend_workdir, clipper_build)
        self.assertLess(clipper_build, frontend_build)
        self.assertIn(
            "COPY --from=build /app/frontend/dist /usr/share/nginx/html", dockerfile
        )
        script = (ROOT / "extensions/clipper/build.mjs").read_text()
        self.assertIn("../../frontend/public/downloads", script)

    def test_api_runtime_locks_official_yt_dlp_dependency(self):
        project = tomllib.loads((ROOT / "backend/pyproject.toml").read_text())
        self.assertTrue(
            any(value.startswith("yt-dlp>=") for value in project["project"]["dependencies"])
        )
        lock = tomllib.loads((ROOT / "backend/uv.lock").read_text())
        packages = {package["name"]: package for package in lock["package"]}
        self.assertIn({"name": "yt-dlp"}, packages["qunxue-api"]["dependencies"])
        self.assertEqual(
            packages["yt-dlp"]["source"], {"registry": "https://pypi.org/simple"}
        )
        dockerfile = (ROOT / "ops/api.Dockerfile").read_text()
        self.assertIn("uv sync --frozen --no-dev --no-editable", dockerfile)
        self.assertIn("PATH=/app/backend/.venv/bin:$PATH", dockerfile)


if __name__ == "__main__":
    unittest.main()
