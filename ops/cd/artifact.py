"""Build/validate the allowlisted, immutable release payload (no credentials)."""

import argparse
import hashlib
import json
import os
import re
import shutil
import tarfile
import tempfile
from html.parser import HTMLParser
from pathlib import Path

from release_identity import fingerprint, validate_api

SHA = re.compile(r"[0-9a-f]{40}\Z")
FORMAT = 1
MAX_BYTES = 2 * 1024**3


def digest(path):
    checksum = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            checksum.update(block)
    return checksum.hexdigest()


def tree_hash(path):
    items = {p.relative_to(path).as_posix(): digest(p) for p in sorted(path.rglob("*.py"))}
    return hashlib.sha256(json.dumps(items, sort_keys=True).encode()).hexdigest()


class EntrypointAssets(HTMLParser):
    def __init__(self):
        super().__init__()
        self.paths = set()

    def handle_starttag(self, tag, attributes):
        for key, value in attributes:
            if key in {"src", "href"} and value and value.startswith("/assets/"):
                if ".." in Path(value).parts or "?" in value or "#" in value:
                    raise ValueError("unexpected entrypoint asset path")
                self.paths.add(value)


def web_checks(web):
    parser = EntrypointAssets()
    parser.feed((web / "index.html").read_text())
    if not any(path.endswith(".js") for path in parser.paths):
        raise ValueError("frontend entrypoint has no built JavaScript asset")
    return {path: digest(web / path.lstrip("/")) for path in sorted({"/index.html", *parser.paths})}


def validate_manifest(value, revision):
    if not SHA.fullmatch(revision) or value.get("revision") != revision:
        raise ValueError("artifact revision does not match requested commit")
    if value.get("format") != FORMAT or value.get("repository") != "huyanxius/everplain":
        raise ValueError("unsupported artifact identity")
    if value.get("runtime") != "docker-linux-amd64":
        raise ValueError("unsupported artifact runtime")
    for item, checksum in value.get("files", {}).items():
        path = Path(item)
        if (
            path.is_absolute()
            or ".." in path.parts
            or item != path.as_posix()
            or not re.fullmatch(r"[0-9a-f]{64}", checksum)
        ):
            raise ValueError("invalid artifact entry")
        if path.parts[0] not in {"backend", "images", "ops"}:
            raise ValueError("unexpected artifact entry")
    roles = set(value.get("images", {}))
    if roles not in ({"api", "web"}, {"api", "web", "gateway"}):
        raise ValueError("invalid application image roles")
    required = {"ops/cd/policy.json"}
    if "registry_images" in value:
        references = value["registry_images"]
        sizes = value.get("image_sizes", {})
        if set(references) != roles or set(sizes) != roles:
            raise ValueError("incomplete registry images")
        for role in roles:
            if not re.fullmatch(r"ghcr\.io/huyanxius/everplain-" + role + r"@sha256:[0-9a-f]{64}",
                                references[role]):
                raise ValueError("registry image must use the repository's immutable digest")
            if type(sizes[role]) is not int or not 0 < sizes[role] <= MAX_BYTES:
                raise ValueError("invalid registry image size")
        if any(name.startswith("images/") for name in value.get("files", {})):
            raise ValueError("registry release must not carry complete image archives")
    else:
        required.update({"images/" + role + ".tar" for role in roles})
    if any(
        not re.fullmatch(r"sha256:[0-9a-f]{64}", image) for image in value["images"].values()
    ):
        raise ValueError("invalid immutable Docker image IDs")
    if not required <= value.get("files", {}).keys():
        raise ValueError("incomplete artifact")
    if not re.fullmatch(r"[0-9a-f]{64}", value.get("migration_tree", "")):
        raise ValueError("missing migration fingerprint")
    checks = value.get("web_checks", {})
    if "/index.html" not in checks or not any(path.endswith(".js") for path in checks):
        raise ValueError("missing frontend byte fingerprints")
    for path, checksum in checks.items():
        if (
            path != "/index.html" and not re.fullmatch(r"/assets/[A-Za-z0-9_.-]+", path)
        ) or not re.fullmatch(r"[0-9a-f]{64}", checksum):
            raise ValueError("invalid frontend fingerprint")
    return value


def unpack(archive, destination, revision, checksum):
    if digest(archive) != checksum:
        raise ValueError("artifact SHA-256 mismatch")
    if destination.exists():
        raise ValueError("release destination already exists")
    with tarfile.open(archive, "r:gz") as bundle:
        members = bundle.getmembers()
        names = [entry.name for entry in members]
        if len(names) != len(set(names)) or sum(e.size for e in members) > MAX_BYTES:
            raise ValueError("duplicate entries or oversized artifact")
        for entry in members:
            path = Path(entry.name)
            if (
                not entry.isfile()
                or path.is_absolute()
                or ".." in path.parts
                or entry.name != path.as_posix()
            ):
                raise ValueError("artifact permits regular relative files only")
        source = bundle.extractfile("manifest.json")
        if source is None:
            raise ValueError("missing manifest")
        manifest = validate_manifest(json.load(source), revision)
        if set(names) != {"manifest.json", *manifest["files"]}:
            raise ValueError("artifact file list differs from manifest")
        destination.mkdir(mode=0o755)
        try:
            for entry in members:
                target = destination / entry.name
                target.parent.mkdir(parents=True, exist_ok=True)
                with bundle.extractfile(entry) as src, target.open("xb") as dst:
                    shutil.copyfileobj(src, dst)
                target.chmod(0o644)
                if (
                    entry.name != "manifest.json"
                    and digest(target) != manifest["files"][entry.name]
                ):
                    raise ValueError("artifact entry checksum mismatch")
            if tree_hash(destination / "backend") != manifest["migration_tree"]:
                raise ValueError("migration fingerprint mismatch")
        except BaseException:
            shutil.rmtree(destination)
            raise
    return manifest


def build(root, prepared, output, revision, images, bases):
    if not SHA.fullmatch(revision):
        raise ValueError("expected full Git commit")
    output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as temporary:
        stage = Path(temporary)
        for item in ("backend/migrations", "ops/cd/policy.json"):
            source, target = root / item, stage / item
            target.parent.mkdir(parents=True, exist_ok=True)
            if source.is_dir():
                shutil.copytree(
                    source, target, ignore=shutil.ignore_patterns("__pycache__", "*.pyc")
                )
            else:
                shutil.copyfile(source, target)
        (stage / "backend/schema").mkdir()
        shutil.copyfile(
            root / "backend/src/qunxue_api/adapters/retrieval/sqlite_index.py",
            stage / "backend/schema/sqlite_index.py",
        )
        registry = prepared / "registry.json"
        if not registry.exists():
            shutil.copytree(prepared / "images", stage / "images")
        files = {
            p.relative_to(stage).as_posix(): digest(p)
            for p in sorted(stage.rglob("*"))
            if p.is_file()
        }
        if any(p.is_symlink() for p in stage.rglob("*")):
            raise ValueError("symlinks are not permitted in release payload")
        manifest = {
            "format": FORMAT,
            "repository": "huyanxius/everplain",
            "revision": revision,
            "runtime": "docker-linux-amd64",
            "files": files,
            "images": images,
            "base_images": bases,
            "web_checks": web_checks(prepared / "web"),
            "migration_tree": tree_hash(stage / "backend"),
            "runtime_identity": {
                "api": validate_api(json.loads((prepared / "api-identity.json").read_text())),
                "web_tree": fingerprint({
                    p.relative_to(prepared / "web").as_posix(): digest(p)
                    for p in sorted((prepared / "web").rglob("*")) if p.is_file()
                }),
            },
            "initial_live_fingerprint": (
                json.loads((root / "ops/cd/live-baseline.json").read_text())
                if (root / "ops/cd/live-baseline.json").is_file() else None
            ),
            "provenance": {
                "run_id": os.environ.get("GITHUB_RUN_ID"),
                "run_attempt": os.environ.get("GITHUB_RUN_ATTEMPT"),
                "workflow_ref": os.environ.get("GITHUB_WORKFLOW_REF"),
                "backend_lock_sha256": digest(root / "backend/uv.lock"),
                "frontend_lock_sha256": digest(root / "frontend/package-lock.json"),
                "clipper_lock_sha256": digest(root / "extensions/clipper/package-lock.json"),
            },
        }
        if "gateway" in images:
            manifest["provenance"]["gateway_lock_sha256"] = digest(root / "gateway/uv.lock")
        if registry.exists():
            manifest["registry_images"] = json.loads(registry.read_text())
            manifest["image_sizes"] = json.loads((prepared / "image-sizes.json").read_text())
        validate_manifest(manifest, revision)
        (stage / "manifest.json").write_text(json.dumps(manifest, sort_keys=True, indent=2) + "\n")
        archive = output / "everplain.tar.gz"
        with tarfile.open(archive, "w:gz") as bundle:
            for path in sorted(stage.rglob("*")):
                if path.is_file():
                    info = bundle.gettarinfo(str(path), path.relative_to(stage).as_posix())
                    info.uid = info.gid = 0
                    info.uname = info.gname = ""
                    info.mode = 0o644
                    with path.open("rb") as stream:
                        bundle.addfile(info, stream)
        shutil.copyfile(stage / "manifest.json", output / "manifest.json")
        (output / "SHA256SUMS").write_text(f"{digest(archive)}  everplain.tar.gz\n")
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("revision")
    parser.add_argument("--prepared", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    for role in ("api-image", "web-image", "python-base", "node-base", "nginx-base"):
        parser.add_argument("--" + role, required=True)
    parser.add_argument("--gateway-image")
    args = parser.parse_args()
    build(
        Path(__file__).resolve().parents[2],
        args.prepared,
        args.output,
        args.revision,
        {"api": args.api_image, "web": args.web_image,
         **({"gateway": args.gateway_image} if args.gateway_image else {})},
        {"python": args.python_base, "node": args.node_base, "nginx": args.nginx_base},
    )
