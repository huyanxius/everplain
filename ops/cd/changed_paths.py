"""Conservative CI impact detection; unknown or missing diffs run every gate."""

import os
import subprocess


def impact(paths, *, diff_ok=True):
    result = dict.fromkeys(("backend", "frontend", "release"), False)
    if not diff_ok or not paths:
        return dict.fromkeys(result, True)
    for path in paths:
        if path.startswith("docs/"):
            continue
        if path.startswith("backend/tests/"):
            result["backend"] = True
        elif path.startswith("ops/tests/"):
            # Release safety always runs in the backend job.
            result["backend"] = True
        elif path.startswith("backend/"):
            result.update(backend=True, frontend=True, release=True)
        elif path.startswith(("frontend/", "extensions/")):
            result.update(frontend=True, release=True)
        else:
            # Includes Dockerfiles, ops, workflows, root config and new components.
            return dict.fromkeys(result, True)
    return result


def main():
    diff = subprocess.run(
        ["git", "diff", "--name-only", "--no-renames", "-z",
         os.environ.get("BASE_SHA", ""), "HEAD", "--"],
        capture_output=True, check=False,
    )
    paths = os.fsdecode(diff.stdout).split("\0")
    result = impact([path for path in paths if path], diff_ok=diff.returncode == 0)
    with open(os.environ["GITHUB_OUTPUT"], "a") as output:
        for role, changed in result.items():
            output.write(f"{role}={str(changed).lower()}\n")


if __name__ == "__main__":
    main()
