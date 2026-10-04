"""Resume only the already migrated candidate from the reviewed main release."""

import fcntl
import hashlib
import json
import os
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path

REVISION = "97b2f9e83135cc730894ebb47700b47aa7809dfa"
BASE = Path("/srv/everplain-updates")


def run(args):
    result = subprocess.run(args, capture_output=True, text=True, timeout=60, check=True)
    return result.stdout


def probe(url):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open(url, timeout=8) as response:
            body = response.read(16 * 1024**2)
            return response.status, body
    except urllib.error.HTTPError as error:
        return error.code, b""
    except OSError:
        return 0, b""


assert os.geteuid() == 0
with Path("/run/lock/everplain-release.lock").open("a") as lock:
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    containers = [json.loads(run(["docker", "inspect", "everplain-" + role]))[0]
                  for role in ("api", "web")]
    for value in containers:
        assert value["Config"]["Labels"]["org.opencontainers.image.revision"] == REVISION
    api = containers[0]
    env = dict(item.split("=", 1) for item in api["Config"]["Env"])
    assert env["EVERPLAIN_RELEASE_REVISION"] == REVISION
    data = next(Path(m["Source"]) for m in api["Mounts"] if m["Destination"] == "/data")
    assert data.resolve() == data and data.parent.parent == BASE
    transaction = json.loads((data.parent / "transaction.json").read_text())
    assert transaction["revision"] == REVISION and transaction["candidate_started"]
    assert transaction["report"]["backup_complete"] and transaction["report"]["migration_complete"]
    for role in ("api", "web"):
        assert transaction["images"][role] == json.loads(
            run(["docker", "inspect", "everplain-" + role]))[0]["Image"]
        run(["docker", "start", "everplain-" + role])
    for attempt in range(20):
        code, body = probe("http://127.0.0.1:5196/api/health")
        if code == 200 and json.loads(body).get("release_revision") == REVISION:
            break
        time.sleep(1)
    else:
        raise RuntimeError("resumed candidate readiness failed")
    print(json.dumps({"candidate_resumed": True, "local_health_ok": True,
                      "data_mount_unchanged": True}))
    release = data.parent / "releases" / REVISION
    manifest = json.loads((release / "manifest.json").read_text())
    for name, path in (("api", "/api/health"), ("web", "/revision.json")):
        code, body = probe("https://e.qunxue.xyz" + path + "?revision=" + REVISION)
        value = json.loads(body) if code == 200 else {}
        print(json.dumps({"public_endpoint": name, "http_status": code,
                          "revision_matches": value.get("release_revision", value.get("revision"))
                          == REVISION}))
    for path, expected in manifest["web_checks"].items():
        if path == "/index.html":
            continue
        code, body = probe("https://e.qunxue.xyz" + path)
        print(json.dumps({"public_asset": path, "http_status": code,
                          "digest_matches": hashlib.sha256(body).hexdigest() == expected}))
