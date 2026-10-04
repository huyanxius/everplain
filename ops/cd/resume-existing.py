"""Read-only verification of the accepted release configuration."""
import fcntl
import json
import subprocess
from pathlib import Path

REVISION = "214ff0b6826c3a0f36a868688561240a95b312f5"

def metadata(name):
    result = subprocess.run(["docker", "inspect", name], capture_output=True,
                            text=True, timeout=30, check=True)
    return json.loads(result.stdout)[0]

def environment(value):
    return dict(item.split("=", 1) for item in value["Config"]["Env"])

with Path("/run/lock/everplain-release.lock").open("a") as lock:
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    api = metadata("everplain-api")
    env = environment(api)
    data = next(Path(item["Source"]) for item in api["Mounts"]
                if item["Destination"] == "/data")
    assert data.resolve() == data and data.parent.parent == Path("/srv/everplain-updates")
    transaction = json.loads((data.parent / "transaction.json").read_text())
    assert transaction["revision"] == REVISION and transaction["report"]["deployment_succeeded"]
    previous = environment(metadata(transaction["old_names"]["api"]))
    expected = dict(previous)
    expected.update(EVERPLAIN_RELEASE_REVISION=REVISION, EVERPLAIN_MIGRATIONS_MANAGED="1")
    phases = json.loads(env["EVERPLAIN_BILLING_PHASE_POLICIES"])
    report = {
        "accepted_revision_verified": env["EVERPLAIN_RELEASE_REVISION"] == REVISION,
        "api_running": api["State"]["Running"],
        "free_embedding_preserved": env.get("EVERPLAIN_EMBEDDING_MODEL") == "BAAI/bge-m3",
        "free_reranker_preserved": env.get("EVERPLAIN_RERANKER_MODEL") == "BAAI/bge-reranker-v2-m3",
        "existing_configuration_preserved": env == expected,
        "billing_phase_names": sorted(phases),
        "search_billing_configuration_preserved": env["EVERPLAIN_BILLING_PHASE_POLICIES"] == previous["EVERPLAIN_BILLING_PHASE_POLICIES"],
        "writing_user_policy_verified": phases.get("writing") == "user",
        "other_billing_policies_preserved": env["EVERPLAIN_BILLING_PHASE_POLICIES"]
            == previous["EVERPLAIN_BILLING_PHASE_POLICIES"],
        "compatibility_mounts_removed": len(api["Mounts"]) == 1,
        "host_changes": False,
    }
    print(json.dumps(report))
    assert all(value for key, value in report.items() if key not in {"host_changes", "billing_phase_names"})
