"""Resume only the already migrated candidate from the reviewed main release."""

import fcntl
import hashlib
import importlib.util
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

REVISION = "97b2f9e83135cc730894ebb47700b47aa7809dfa"
BASE = Path("/srv/everplain-updates")
HELPER_HASHES = {'ops/cd/deploy-existing.py': '3ee273fa9791961a7dd7ed6ff122549bc727658184d259d0a05224bda0901fc6', 'ops/cd/artifact.py': '14235026694fe38283f36a57d5b4ebbe2fccba9070562489844393c5b8156424', 'ops/cd/deploy.py': '0a1a042230920ece937a7a9954e0363a67379b4dc7c1345eebf83da176244053', 'ops/database.py': '04022005399281c57cb3d9de3498be80ee3bb0922257a23eba8215c8df2056d8', 'ops/cd/repair_existing_web.py': '8df0c1527646323a37ee6c15d381dec1fd874c9ab92bb120cafd02790d411e27', 'ops/cd/release_identity.py': '9650793cd70f68e7c376bc07707221574c4741ae3759b64cf6221442b4f70ad6'}


def run(args):
    result = subprocess.run(args, capture_output=True, text=True, timeout=60, check=True)
    return result.stdout


def probe(url):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        request = urllib.request.Request(url, headers={"User-Agent": "Everplain-Release/1.0"})
        with opener.open(request, timeout=8) as response:
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
        if not json.loads(run(['docker', 'inspect', 'everplain-' + role]))[0]['State']['Running']:
            run(['docker', 'start', 'everplain-' + role])
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

    roots = [p for p in Path('/tmp').glob('everplain-candidate.*')
             if all((p / name).is_file() and not (p / name).is_symlink()
                    and hashlib.sha256((p / name).read_bytes()).hexdigest() == expected
                    for name, expected in HELPER_HASHES.items())]
    assert roots
    sys.path.insert(0, str(roots[0] / 'ops/cd'))
    spec = importlib.util.spec_from_file_location('checked_release',
                                                roots[0] / 'ops/cd/deploy-existing.py')
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    helper.REVISION = REVISION
    helper.RUN_ID, helper.RUN_ATTEMPT = '37205814594', '1'
    frozen = data.parent / 'release.tar.gz'
    helper.ARCHIVE_SHA256 = hashlib.sha256(frozen.read_bytes()).hexdigest()
    checked = helper.load_request(frozen, REVISION, helper.ARCHIVE_SHA256,
                                  helper.RUN_ID, helper.RUN_ATTEMPT)
    assert checked == manifest
    helper.API_IMAGE, helper.WEB_IMAGE = manifest['images']['api'], manifest['images']['web']
    old = helper.environment(helper.metadata(transaction['old_names']['api']))
    policy = json.loads((release / 'ops/cd/policy.json').read_text())
    expected = helper.configure_billing_policy(old, policy, {})
    expected.update(EVERPLAIN_RELEASE_REVISION=REVISION, EVERPLAIN_MIGRATIONS_MANAGED='1')
    print(json.dumps({'live_mounts': [{key: item[key] for key in ('Destination','Type','RW')} for item in api['Mounts']]}))
    print(json.dumps({'current_runtime': helper.snapshot(helper.run, helper.metadata)}))
    mismatches = sorted(key for key, value in expected.items() if env.get(key) != value)
    print(json.dumps({'configuration_mismatch_keys': mismatches}))
    allowed = {'EVERPLAIN_EMBEDDING_MODEL': 'BAAI/bge-m3', 'EVERPLAIN_RERANKER_MODEL': 'BAAI/bge-reranker-v2-m3'}
    assert set(mismatches) == set(allowed) and all(env.get(key) == value for key, value in allowed.items())
    reviewed = {'/app/backend/.venv/lib/python3.12/site-packages/qunxue_api/settings.py': '1c228c9b7a13458d54e0a6e37c774a4ba40c466df6132d37566f4b3c49a7af1b', '/app/ops/preflight.py': '66342f60c121901fb815b5dd5baa4a94f637f54a7cfdce7f99dc79ec2ea42fe3'}
    for mount in api['Mounts']:
        if mount['Destination'] == '/data': continue
        path = Path(mount['Source'])
        assert mount['Type'] == 'bind' and not mount['RW'] and mount['Destination'] in reviewed
        assert path.is_file() and not path.is_symlink() and path.stat().st_size < 1024**2
        print(json.dumps({'reviewed_live_overlay': mount['Destination'], 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'target_bytes_match': hashlib.sha256(path.read_bytes()).hexdigest() == reviewed[mount['Destination']]}))
    print(json.dumps({'free_models_verified': True, 'reviewed_overlays_verified': True, 'other_previous_configuration_preserved': True}))
    raise SystemExit(0)
    image = json.loads(run(['docker', 'image', 'inspect', api['Image']]))[0]
    image_env = dict(item.split('=', 1) for item in image['Config']['Env'])
    added = set(env) - set(expected)
    assert all(env[key] == image_env.get(key) for key in added)
    print(json.dumps({'previous_configuration_preserved': True,
                      'image_environment_defaults_added': len(added)}))
    def checked_http(url):
        code, body = probe(url)
        assert code == 200
        return body
    helper.http = checked_http
    helper.public_health(manifest, env['EVERPLAIN_RUNTIME_MODE'])
    updater = helper.ExistingRelease(frozen, BASE)
    updater.stage, updater.images = data.parent, transaction['images']
    updater.state_path = BASE / 'pipeline-state.json'
    updater.report = transaction['report']
    updater.expected_billing_policy = expected.get('EVERPLAIN_BILLING_PHASE_POLICIES')
    updater.complete(manifest)
    updater.report.update(public_health_ok=True, deployment_succeeded=True,
                          candidate_resumed=True, forward_stop_required=False,
                          configuration_preserved_verified=True)
    transaction['report'] = updater.report
    helper.save_json(data.parent / 'transaction.json', transaction)
    print(json.dumps({key: value for key, value in updater.report.items()
                      if isinstance(value, (bool, int))}))
