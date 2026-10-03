"""Three bounded transfers of a fixed public artifact; host metadata stays private."""

import base64
import concurrent.futures
import hashlib
import json
import os
import re
import shutil
import signal
import stat
import subprocess
import sys
import time
from pathlib import Path

EXPECTED = "85f2b033ed68e94d9d0563800d3d5b078c4b4e2d7b6ad868c4a3fa2e0cf3ec03"


def require(value):
    if not value:
        raise RuntimeError("artifact transfer check failed")


def digest(path, count=None):
    value = hashlib.sha256()
    with path.open("rb") as stream:
        while count is None or count:
            chunk = stream.read(1024 * 1024 if count is None else min(count, 1024 * 1024))
            if not chunk:
                require(count is None)
                break
            value.update(chunk)
            if count is not None:
                count -= len(chunk)
    return value.hexdigest()


def make_parts(archive, prefix_size, prefix_hash, target):
    require(0 <= prefix_size < archive.stat().st_size)
    require(digest(archive, prefix_size) == prefix_hash)
    target.mkdir(mode=0o700, exist_ok=True)
    remaining = archive.stat().st_size - prefix_size
    width = (remaining + 2) // 3
    parts = []
    with archive.open("rb") as stream:
        stream.seek(prefix_size)
        for index in range(3):
            count = min(width, remaining)
            if not count:
                break
            path = target / f"part-{index}"
            with path.open("wb") as output:
                left = count
                while left:
                    data = stream.read(min(left, 1024 * 1024))
                    require(data)
                    output.write(data)
                    left -= len(data)
            parts.append({"name": path.name, "size": count, "sha256": digest(path)})
            remaining -= count
    return {
        "size": archive.stat().st_size,
        "prefix_size": prefix_size,
        "prefix_sha256": prefix_hash,
        "parts": parts,
    }


def regular(path, uid):
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_uid == uid and info.st_nlink == 1)
    return info


def no_writer(paths):
    for fd in Path("/proc").glob("[0-9]*/fd/*"):
        try:
            if Path(os.readlink(fd)) not in paths:
                continue
            flags = (fd.parent.parent / "fdinfo" / fd.name).read_text()
            match = re.search(r"^flags:\s+([0-7]+)$", flags, re.MULTILINE)
            require(not match or int(match[1], 8) & os.O_ACCMODE == os.O_RDONLY)
        except OSError:
            pass


def host_prepare(directory, plan, uid):
    require(re.fullmatch(r"/tmp/everplain-candidate\.[A-Za-z0-9]+", str(directory)))
    info = directory.lstat()
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == uid and info.st_mode & 0o077 == 0)
    require(0 <= plan["prefix_size"] < plan["size"] <= 2 * 1024**3)
    require(1 <= len(plan["parts"]) <= 3)
    require(sum(part["size"] for part in plan["parts"]) + plan["prefix_size"] == plan["size"])
    for index, part in enumerate(plan["parts"]):
        require(part["name"] == f"part-{index}" and part["size"] > 0)
        require(re.fullmatch(r"[a-f0-9]{64}", part["sha256"]))
    prefix = directory / "release.tar.gz"
    if prefix.exists():
        require(regular(prefix, uid).st_size == plan["prefix_size"])
        no_writer({prefix})
        require(digest(prefix) == plan["prefix_sha256"])
    else:
        require(
            plan["prefix_size"] == 0 and plan["prefix_sha256"] == hashlib.sha256(b"").hexdigest()
        )
        prefix.touch(mode=0o600, exist_ok=False)
        os.chown(prefix, uid, info.st_gid)
    # Original partial, all shards and one assembled copy coexist until final verification.
    require(shutil.disk_usage(directory).free > plan["size"] * 2 + 64 * 1024**2)
    parts = directory / "parts"
    if not parts.exists():
        parts.mkdir(mode=0o700)
        os.chown(parts, uid, info.st_gid)
    require(not parts.is_symlink() and parts.is_dir() and parts.stat().st_uid == uid)
    saved = parts / "plan.json"
    if saved.exists():
        require(not saved.is_symlink() and json.loads(saved.read_text()) == plan)
    else:
        with saved.open("x") as stream:
            json.dump(plan, stream)
        saved.chmod(0o600)
    return parts


def part_status(parts, plan, uid):
    result = []
    no_writer({parts / item["name"] for item in plan["parts"]})
    for item in plan["parts"]:
        path = parts / item["name"]
        size = regular(path, uid).st_size if path.exists() else 0
        require(size <= item["size"])
        result.append(
            {
                "name": item["name"],
                "size": size,
                "sha256": digest(path) if path.exists() else hashlib.sha256(b"").hexdigest(),
            }
        )
    return result


def assemble(directory, parts, plan, uid, expected=EXPECTED):
    status = part_status(parts, plan, uid)
    for item, actual in zip(plan["parts"], status, strict=True):
        require(item == actual)
    prefix = directory / "release.tar.gz"
    no_writer({prefix})
    if plan["prefix_size"]:
        require(regular(prefix, uid).st_size == plan["prefix_size"])
        require(digest(prefix) == plan["prefix_sha256"])
    output = directory / "assembled.tar.gz"
    with output.open("xb") as stream:
        if plan["prefix_size"]:
            with prefix.open("rb") as source:
                shutil.copyfileobj(source, stream)
        for part in plan["parts"]:
            with (parts / part["name"]).open("rb") as source:
                shutil.copyfileobj(source, stream)
        stream.flush()
        os.fsync(stream.fileno())
    require(output.stat().st_size == plan["size"] and digest(output) == expected)
    if prefix.exists():
        saved = directory / "prefix.saved.tar.gz"
        require(not saved.exists())
        shutil.copyfile(prefix, saved)
        saved.chmod(0o600)
    os.chown(output, uid, directory.stat().st_gid)
    output.chmod(0o600)
    os.replace(output, prefix)


def upload_command(source, destination, received):
    # OpenSSH cannot resume a remote file that does not exist yet.
    flag = "-a " if received else ""
    return f'put {flag}"{source}" "{destination}"\n'


def transfer(command, seconds):
    process = subprocess.Popen(
        command,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        text=True,
        start_new_session=True,
    )
    timed_out = False
    try:
        _stdout, error = process.communicate(timeout=seconds)
    except subprocess.TimeoutExpired:
        timed_out = True
        os.killpg(process.pid, signal.SIGTERM)
        try:
            _stdout, error = process.communicate(timeout=10)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            _stdout, error = process.communicate()
    # Raw stderr stays private; output only boolean classifications, never paths or argv.
    error = error.lower()
    return {
        "ok": process.returncode == 0,
        "timed_out": timed_out,
        "exit_1": process.returncode == 1,
        "exit_255": process.returncode == 255,
        "missing_file": "no such file" in error,
        "permission_denied": "permission denied" in error,
        "network_error": "connection" in error or "timed out" in error,
        "protocol_error": "protocol" in error,
    }


def local(args):
    archive, directory, scratch = Path(args[0]), args[1], Path(args[2])
    port, target, size, checksum, duration = args[3:8]
    options = args[8:]
    chunks = scratch / "chunks"
    plan = make_parts(archive, int(size), checksum, chunks)
    encoded = base64.b64encode(json.dumps(plan).encode()).decode()
    code = Path(__file__).read_text()

    def remote(mode):
        command = f"sudo -n python3 - {mode} {directory} {encoded}"
        result = subprocess.run(
            ["ssh", *options, "-p", port, target, command],
            input=code,
            capture_output=True,
            text=True,
            timeout=120,
            check=False,
        )
        require(result.returncode == 0)
        return json.loads(result.stdout)

    before = remote("host-status")
    commands = []
    for item, prior in zip(plan["parts"], before, strict=True):
        path = chunks / item["name"]
        require(prior["name"] == item["name"] and digest(path, prior["size"]) == prior["sha256"])
        if prior["size"] == item["size"]:
            continue
        batch = scratch / (item["name"] + ".batch")
        batch.write_text(upload_command(path, f"{directory}/parts/{item['name']}", prior["size"]))
        commands.append(
            [
                "sftp",
                "-q",
                "-B",
                "65536",
                "-R",
                "64",
                *options,
                "-P",
                port,
                "-b",
                str(batch),
                target,
            ]
        )
    started = time.monotonic()
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        outcomes = list(pool.map(lambda command: transfer(command, int(duration)), commands))
    after = remote("host-status")
    moved = sum(p["size"] for p in after) - sum(p["size"] for p in before)
    elapsed = max(1, time.monotonic() - started)
    complete = all(outcome["ok"] for outcome in outcomes)
    report = {
        "parallel_progress": moved > 0,
        "parallel_at_least_64_kib_per_second": moved / elapsed >= 64 * 1024,
        "parallel_parts_complete": complete,
        **{
            f"sftp_{key}": any(outcome[key] for outcome in outcomes)
            for key in (
                "timed_out",
                "exit_1",
                "exit_255",
                "missing_file",
                "permission_denied",
                "network_error",
                "protocol_error",
            )
        },
    }
    print(json.dumps(report), flush=True)
    require(all(outcome["ok"] or outcome["timed_out"] for outcome in outcomes))
    if complete:
        remote("host-assemble")
        return True
    return False


if __name__ == "__main__":
    try:
        if sys.argv[1] == "local":
            raise SystemExit(0 if local(sys.argv[2:]) else 3)
        mode, directory, encoded = sys.argv[1:]
        directory = Path(directory)
        plan = json.loads(base64.b64decode(encoded, validate=True))
        uid = int(os.environ["SUDO_UID"])
        parts = host_prepare(directory, plan, uid)
        if mode == "host-status":
            print(json.dumps(part_status(parts, plan, uid)))
        elif mode == "host-assemble":
            assemble(directory, parts, plan, uid)
            print("true")
        else:
            raise RuntimeError("unsupported transfer operation")
    except Exception:
        raise SystemExit(2) from None
