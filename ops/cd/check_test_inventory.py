"""Fail closed on newly unselected tests and stale explicitly recorded exclusions.

The baseline backlog is intentionally not called passing or historical. This
inventory adds no permission to invoke live providers or native-platform tests.
"""
import hashlib
import json
import re
from collections import Counter
from fnmatch import fnmatchcase
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = "backend/tests/deferred-suite.json"


def is_test(path):
    name = Path(path).name
    return bool(
        (name.endswith(".py") and (name.startswith("test") or name.endswith("_test.py")))
        or re.search(r"\.(test|spec)\.[cm]?[jt]sx?$", name)
        or name.endswith(("-tests.mjs", ".test.py", ".test.ps1"))
    )


def discover(root):
    return {
        path.relative_to(root).as_posix()
        for path in root.rglob("*")
        if path.is_file() and not set(path.parts) & {".git", "node_modules", ".venv"}
        and is_test(path)
    }


def product_entries(root):
    return ["backend/" + line.strip() for line in
            (root / "backend/tests/product-suite.txt").read_text().splitlines()
            if line.strip() and not line.lstrip().startswith("#")]


def selected_lane(path, product):
    if path in product:
        return "backend_product"
    if (Path(path).parent.as_posix() == "ops/tests"
            and Path(path).name.startswith("test") and path.endswith(".py")):
        return "ops_unittest"
    pytest_name = any(fnmatchcase(Path(path).name, pattern)
                      for pattern in ("test_*.py", "*_test.py"))
    pytest_ignored = any(fnmatchcase(part, pattern) for part in Path(path).parts[2:-1]
                         for pattern in ("*.egg", ".*", "_darcs", "build", "CVS", "dist",
                                         "node_modules", "venv", "{arch}"))
    if ((path.startswith("gateway/tests/") and pytest_name and not pytest_ignored)
            or path == "gateway/integration/test_http_contract.py"):
        return "gateway_contracts"
    if path.startswith("frontend/src/") and re.search(r"\.(test|spec)\.[cm]?[jt]sx?$", path):
        return "frontend_vitest"
    if path in {"frontend/scripts/check-module-boundaries-tests.mjs",
                "frontend/scripts/check-style-tokens-tests.mjs"}:
        return "frontend_guard_tests"
    if (Path(path).parent.as_posix() == "extensions/clipper/test"
            and path.endswith(".test.mjs")):
        return "clipper_node"
    if path == "extensions/clipper/test/setup.test.py":
        return "clipper_bash_contract"
    return None


def violations(root=ROOT):
    root = Path(root)
    found, product = discover(root), product_entries(root)
    errors = [f"duplicate product registration: {path}" for path, count in Counter(product).items()
              if count != 1]
    errors += [f"stale product registration: {path}" for path in product if path not in found]
    manifest = json.loads((root / MANIFEST).read_text())
    deferred = {}
    for group in manifest["groups"]:
        if group["category"] not in {"baseline_review_pending", "explicit_live_provider",
                                     "platform_manual", "synthetic_browser_manual"}:
            errors.append(f"unknown deferred category: {group['category']}")
        if not group.get("reason"):
            errors.append("deferred group has no reason")
        for row in group["files"]:
            path = row["path"]
            if path in deferred:
                errors.append(f"duplicate deferred registration: {path}")
            deferred[path] = group["category"]
            if path not in found:
                errors.append(f"stale deferred registration: {path}")
                continue
            if selected_lane(path, product):
                errors.append(f"test is both selected and deferred: {path}")
            digest = hashlib.sha256((root / path).read_bytes()).hexdigest()
            if digest != row["sha256"]:
                errors.append(f"changed deferred test requires reclassification: {path}")
    errors += [f"unclassified test: {path}" for path in sorted(found)
               if not selected_lane(path, product) and path not in deferred]
    return sorted(errors)


def main():
    errors = violations()
    if errors:
        raise SystemExit("Test inventory failed:\n" + "\n".join(errors))
    print("Test inventory matches selection/exclusions; exclusions are not execution passes.")


if __name__ == "__main__":
    main()
