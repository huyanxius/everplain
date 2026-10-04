"""Nonsecret runtime fingerprints and provenance for the existing release channel."""

import hashlib
import json
import re
import stat
from pathlib import Path

SHA256 = re.compile(r"[0-9a-f]{64}\Z")
SHA = re.compile(r"[0-9a-f]{40}\Z")
IMAGE = re.compile(r"sha256:[0-9a-f]{64}\Z")
API_KEYS = {"source_tree", "dependency_tree", "migration_tree", "ops_tree", "tokenizer_tree"}

# This executes stdlib-only code. It neither imports the app nor opens a database.
API_PROBE = r"""
import hashlib,importlib.metadata,importlib.util,json,pathlib,sys,sysconfig

def tree(root):
    values={}
    if not root.is_dir() or root.is_symlink():
        raise RuntimeError('runtime source unavailable')
    for p in sorted(root.rglob('*')):
        if '__pycache__' in p.parts or p.suffix=='.pyc':
            continue
        if p.is_symlink():
            raise RuntimeError('unexpected runtime symlink')
        if p.is_file():
            values[p.relative_to(root).as_posix()]=hashlib.sha256(p.read_bytes()).hexdigest()
    if not values:
        raise RuntimeError('empty runtime source')
    return values

def digest(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True).encode()).hexdigest()

spec=importlib.util.find_spec('qunxue_api')
root=pathlib.Path(next(iter(spec.submodule_search_locations)))
source=tree(root)
storage={
    'migrations/'+k:v
    for k,v in tree(pathlib.Path('/app/backend/migrations')).items() if k.endswith('.py')
}
storage['schema/sqlite_index.py']=hashlib.sha256((root/'adapters/retrieval/sqlite_index.py').read_bytes()).hexdigest()
deps=[]
prefix=pathlib.Path(sys.prefix).resolve()
for d in importlib.metadata.distributions():
    if d.files is None:
        raise RuntimeError('dependency file inventory unavailable')
    files={}
    for item in sorted(d.files):
        if '__pycache__' in item.parts or item.suffix=='.pyc':
            continue
        file=pathlib.Path(d.locate_file(item))
        if file.is_symlink() or not file.resolve().is_relative_to(prefix):
            raise RuntimeError('unexpected dependency file location')
        if not file.is_file():
            raise RuntimeError('dependency file unavailable')
        files[str(item)]=hashlib.sha256(file.read_bytes()).hexdigest()
    deps.append((d.metadata['Name'].lower().replace('_','-'),d.version,files))
deps.sort(key=lambda row:(row[0],row[1]))
# RECORDs do not enumerate an untracked same-version patch. Hash the complete
# installed library trees too, including added files, but not runtime caches.
libraries={}
for key in ('purelib','platlib'):
    location=pathlib.Path(sysconfig.get_path(key)).resolve()
    if not location.is_relative_to(prefix):
        raise RuntimeError('unexpected dependency library location')
    libraries[key]=tree(location)
deps={'inventory_and_recorded_files':deps,'installed_libraries':libraries}

print(json.dumps({
    'source_tree':digest(source),
    'dependency_tree':digest(deps),
    'migration_tree':digest(storage),
    'ops_tree':digest(tree(pathlib.Path('/app/ops'))),
    'tokenizer_tree':digest(tree(pathlib.Path('/opt/tiktoken-cache'))),
},sort_keys=True))
"""
WEB_PROBE = (
    "cd /usr/share/nginx/html && "
    'test -z "$(find . -type l -print -quit)" && '
    "find . -type f -exec sha256sum {} \\;"
)


def require(condition, message="release identity mismatch"):
    if not condition:
        raise ValueError(message)


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()


def validate_api(value):
    require(isinstance(value, dict) and set(value) == API_KEYS)
    require(all(isinstance(v, str) and SHA256.fullmatch(v) for v in value.values()))
    return value


def web_fingerprint(output):
    files = {}
    for line in output.splitlines():
        require(len(line) > 68 and line[64:66] == "  ")
        checksum, name = line[:64], line[66:]
        require(bool(SHA256.fullmatch(checksum)) and name.startswith("./"))
        name = name[2:]
        path = Path(name)
        require(name == path.as_posix() and not path.is_absolute() and ".." not in path.parts)
        require(name not in files and "\n" not in name and "\r" not in name)
        files[name] = checksum
    require("index.html" in files and any(p.startswith("assets/") for p in files))
    return fingerprint(files)


def validate_snapshot(value):
    require(isinstance(value, dict) and set(value) == {"api_image", "web_image", "api", "web_tree"})
    require(
        all(
            isinstance(value[k], str) and IMAGE.fullmatch(value[k])
            for k in ("api_image", "web_image")
        )
    )
    validate_api(value["api"])
    require(isinstance(value["web_tree"], str) and SHA256.fullmatch(value["web_tree"]))
    return value


def snapshot(run, metadata):
    api = json.loads(run(["docker", "exec", "everplain-api", "python", "-c", API_PROBE]))
    web = web_fingerprint(run(["docker", "exec", "everplain-web", "sh", "-c", WEB_PROBE]))
    return validate_snapshot(
        {
            "api_image": metadata("everplain-api")["Image"],
            "web_image": metadata("everplain-web")["Image"],
            "api": api,
            "web_tree": web,
        }
    )


def validate_provenance(manifest, revision, run_id, run_attempt):
    require(isinstance(revision, str) and SHA.fullmatch(revision), "invalid release revision")
    require(manifest.get("revision") == revision)
    require(str(run_id).isdigit() and int(run_id) > 0)
    require(str(run_attempt).isdigit() and int(run_attempt) > 0)
    provenance = manifest.get("provenance", {})
    require(str(provenance.get("run_id")) == str(run_id), "artifact belongs to another run")
    require(
        str(provenance.get("run_attempt")) == str(run_attempt),
        "artifact belongs to another attempt",
    )
    require(
        provenance.get("workflow_ref")
        == "huyanxius/everplain/.github/workflows/deploy.yml@refs/heads/main"
    )
    identity = manifest.get("runtime_identity", {})
    require(set(identity) == {"api", "web_tree"}, "artifact runtime fingerprints missing")
    validate_api(identity["api"])
    require(isinstance(identity["web_tree"], str) and SHA256.fullmatch(identity["web_tree"]))
    require(identity["api"]["migration_tree"] == manifest.get("migration_tree"))
    return manifest


def read_state(path, owner):
    if not path.exists() and not path.is_symlink():
        return None
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_uid == owner and info.st_mode & 0o077 == 0)
    value = json.loads(path.read_text())
    require(value.get("format") == 1 and value.get("application") == "everplain")
    require(isinstance(value.get("revision"), str) and SHA.fullmatch(value["revision"]))
    require(type(value.get("run_id")) is int and value["run_id"] > 0)
    require(
        isinstance(value.get("archive_sha256"), str) and SHA256.fullmatch(value["archive_sha256"])
    )
    validate_snapshot(value.get("runtime"))
    return value


def verify_baseline(actual, state, initial, revision, run_id, checksum):
    validate_snapshot(actual)
    if state is None:
        require(
            isinstance(initial, dict) and initial.get("format") == 1,
            "first release needs a freshly reviewed live fingerprint",
        )
        expected = validate_snapshot(initial.get("runtime"))
    else:
        expected = state["runtime"]
        require(
            int(run_id) > state["run_id"]
            or (
                int(run_id) == state["run_id"]
                and revision == state["revision"]
                and checksum == state["archive_sha256"]
            ),
            "stale or changed replay of completed release",
        )
    require(actual == expected, "live source/image drift; preserve overlays and reconcile first")
    return expected


def load_request(archive, revision, checksum, run_id, run_attempt):
    import tarfile

    from artifact import MAX_BYTES, digest, validate_manifest

    require(isinstance(checksum, str) and SHA256.fullmatch(checksum), "invalid archive digest")
    require(archive.is_file() and not archive.is_symlink() and archive.stat().st_size <= MAX_BYTES)
    require(digest(archive) == checksum, "artifact SHA-256 mismatch")
    with tarfile.open(archive, "r:gz") as bundle:
        members = bundle.getmembers()
        require(len({m.name for m in members}) == len(members))
        require(sum(m.size for m in members) <= MAX_BYTES)
        item = bundle.getmember("manifest.json")
        require(item.isfile() and item.size <= 1024 * 1024)
        manifest = validate_manifest(json.load(bundle.extractfile(item)), revision)
    return validate_provenance(manifest, revision, run_id, run_attempt)


if __name__ == "__main__":
    import subprocess
    import sys

    if len(sys.argv) == 3 and sys.argv[1] == "probe-image":
        require(bool(IMAGE.fullmatch(sys.argv[2])))
        output = subprocess.run(
            [
                "docker",
                "run",
                "--rm",
                "--network",
                "none",
                "--entrypoint",
                "python",
                sys.argv[2],
                "-c",
                API_PROBE,
            ],
            capture_output=True,
            text=True,
            check=True,
            timeout=60,
        ).stdout
        print(json.dumps(validate_api(json.loads(output)), sort_keys=True))
    elif len(sys.argv) == 2 and sys.argv[1] == "inspect":

        def observe(args):
            result = subprocess.run(args, capture_output=True, text=True, timeout=60, check=False)
            require(result.returncode == 0, "runtime fingerprint inspection failed")
            return result.stdout

        def image_only(name):
            return {
                "Image": json.loads(
                    observe(["docker", "inspect", "--format", "{{json .Image}}", name])
                )
            }

        print(json.dumps({"format": 1, "runtime": snapshot(observe, image_only)}, sort_keys=True))
    elif len(sys.argv) == 7 and sys.argv[1] == "verify":
        load_request(Path(sys.argv[2]), *sys.argv[3:])
        print('{"artifact_verified":true}')
    else:
        raise SystemExit("unsupported identity operation")
