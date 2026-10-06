"""One stable CI result over the existing path-optimized jobs.

This is a workflow result, not branch protection. Configure Required checks as
required separately. A cancelled workflow cannot manufacture a successful gate.
"""
import json
import os
import sys

JOBS = ("changes", "release-build", "channel-gateway", "backend", "frontend")


def failures(needs, event_name):
    if not isinstance(needs, dict):
        return ["needs must be a job-result object"]
    errors = []
    # Reusable workflows retain the caller event. Current callers are PR CI and
    # deploy.yml on push; a new event must deliberately define release policy.
    if event_name not in {"pull_request", "push"}:
        errors.append("missing or unsupported CI event")
    if set(needs) != set(JOBS):
        errors.append("unexpected or missing jobs in CI results")
    changes = needs.get("changes", {})
    outputs = changes.get("outputs", {}) if isinstance(changes, dict) else {}
    if not isinstance(outputs, dict):
        outputs = {}
    flags = {name: outputs.get(name) for name in ("backend", "frontend", "release")}
    for name, value in flags.items():
        if value not in ("true", "false"):
            errors.append(f"changes.{name} is missing or invalid")
    required = {
        "changes": True,
        # Release safety runs here even for documentation-only changes.
        "backend": True,
        "frontend": flags["frontend"] == "true",
        "channel-gateway": "true" in (flags["backend"], flags["release"]),
        # Main builds the publishable artifact in deploy.yml, not twice in CI.
        "release-build": event_name == "pull_request" and flags["release"] == "true",
    }
    for job in JOBS:
        entry = needs.get(job, {})
        result = entry.get("result") if isinstance(entry, dict) else None
        if result == "success" or (result == "skipped" and not required[job]):
            continue
        errors.append(f"{job}: {result!r}; required={required[job]}")
    return errors


def main():
    try:
        needs = json.loads(os.environ.get("CI_NEEDS", ""))
    except json.JSONDecodeError:
        print("Invalid CI job results", file=sys.stderr)
        return 1
    errors = failures(needs, os.environ.get("CI_EVENT_NAME", ""))
    if errors:
        print("Required checks failed:\n" + "\n".join(errors), file=sys.stderr)
        return 1
    print("Required checks passed; all applicable jobs succeeded.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
