"""Optional, checksum-bound channel service on the existing Everplain release path.

No account/token/webhook creation. Credentials are supplied once by the operator
in a root-owned private file and never appear in artifacts, argv or reports.
"""

import contextlib
import json
import os
import re
import stat
import time
from pathlib import Path

CONFIG = Path("/etc/everplain/channel-gateway.env")
DATA = Path("/srv/everplain-updates/channel-gateway/data")
NAME = "everplain-channel-gateway"
PREFIX = "EVERPLAIN_GATEWAY_"
ALLOWED = {
    PREFIX + key for key in (
        "BACKEND_URL", "TELEGRAM_TOKEN", "TELEGRAM_WEBHOOK_SECRET", "TELEGRAM_BACKEND_SECRET",
        "FEISHU_APP_ID", "FEISHU_APP_SECRET", "FEISHU_ENCRYPT_KEY", "FEISHU_VERIFICATION_TOKEN",
        "FEISHU_TENANT_KEY", "FEISHU_BACKEND_SECRET", "TELEGRAM_ALLOWED_SUBJECT_IDS",
        "FEISHU_ALLOWED_SUBJECT_IDS", "MAX_PENDING", "MAX_ATTEMPTS",
    )
}


def require(condition):
    if not condition:
        raise RuntimeError("channel service precondition failed")


def configuration(path=CONFIG):
    if not path.exists() and not path.is_symlink():
        return None
    # Do not follow a substituted secret file or a group-writable parent.
    for parent in (path.parent, path):
        info = parent.lstat()
        require(not stat.S_ISLNK(info.st_mode) and info.st_uid == 0)
        require(info.st_mode & 0o077 == 0 if parent == path else info.st_mode & 0o022 == 0)
    require(path.is_file() and path.stat().st_size <= 32768)
    values = {}
    for line in path.read_text().splitlines():
        if not line or line.startswith("#"):
            continue
        key, separator, value = line.partition("=")
        require(separator and key in ALLOWED and key not in values and value)
        values[key] = value
    require(values.get(PREFIX + "BACKEND_URL") == "https://e.qunxue.xyz")
    return values


def backend_environment(original, values):
    result = dict(original)
    credentials = json.loads(original.get("EVERPLAIN_CHANNEL_GATEWAY_CREDENTIALS", "{}"))
    require(isinstance(credentials, dict))
    if values.get(PREFIX + "TELEGRAM_TOKEN"):
        bot_id = values[PREFIX + "TELEGRAM_TOKEN"].split(":", 1)[0]
        require(re.fullmatch(r"[0-9]+", bot_id) is not None)
        credentials["telegram:" + bot_id] = values.get(PREFIX + "TELEGRAM_BACKEND_SECRET", "")
    if values.get(PREFIX + "FEISHU_APP_ID"):
        identity = "feishu:" + values[PREFIX + "FEISHU_APP_ID"] + ":" + values.get(
            PREFIX + "FEISHU_TENANT_KEY", ""
        )
        require(len(identity.split(":")) == 3 and all(identity.split(":")))
        credentials[identity] = values.get(PREFIX + "FEISHU_BACKEND_SECRET", "")
    require(credentials and all(isinstance(value, str) and len(value.strip()) >= 32
                                for value in credentials.values()))
    result["EVERPLAIN_CHANNEL_GATEWAY_CREDENTIALS"] = json.dumps(credentials)
    return result


class GatewayRelease:
    def __init__(self, *, values, image, revision, stage, network, run, metadata, atomic, report,
                 data=DATA):
        self.values, self.image, self.revision = values, image, revision
        self.stage, self.network, self.data = stage, network, data
        self.run, self.metadata, self.atomic, self.report = run, metadata, atomic, report
        self.previous = None
        self.old_name = NAME + "-before-" + stage.name
        self.stopped = self.renamed = self.started = False

    def prepare(self):
        require(re.fullmatch(r"sha256:[0-9a-f]{64}", self.image) is not None)
        require(re.fullmatch(r"[0-9a-f]{40}", self.revision) is not None)
        values = {**self.values, PREFIX + "DATABASE_PATH": "/data/everplain-gateway.db",
                  PREFIX + "RELEASE_REVISION": self.revision, PREFIX + "PILOT_ONLY": "true"}
        private = self.stage / "channel-gateway.env"
        self.atomic(private, "".join(k + "=" + v + "\n" for k, v in values.items()).encode())
        self.run(["docker", "run", "--rm", "--network", "none", "--env-file", str(private),
                  "--entrypoint", "/app/.venv/bin/python", self.image, "-c",
                  "from everplain_gateway.config import Settings; Settings()"])
        self.report["channel_configuration_verified"] = True
        self.data.parent.mkdir(mode=0o700, exist_ok=True)
        require(not self.data.parent.is_symlink() and self.data.parent.stat().st_uid == 0
                and self.data.parent.stat().st_mode & 0o077 == 0)
        if not self.data.exists():
            self.data.mkdir(mode=0o750)
            os.chown(self.data, 10001, 10001)
        info = self.data.lstat()
        require(stat.S_ISDIR(info.st_mode) and info.st_uid == 10001 and info.st_gid == 10001
                and info.st_mode & 0o027 == 0)
        names = self.run(["docker", "ps", "-a", "--format", "{{.Names}}", "--filter",
                          "name=^/" + NAME + "$"], timeout=30).splitlines()
        if names:
            require(names == [NAME])
            self.previous = self.metadata(NAME)
            require(self.previous["Config"]["Labels"].get("org.everplain.channel") == "v1")
            require(self.previous["HostConfig"]["PortBindings"] == {
                "8298/tcp": [{"HostIp": "127.0.0.1", "HostPort": "8298"}]
            })
            require(len(self.previous["Mounts"]) == 1 and self.previous["Mounts"][0]["RW"]
                    and self.previous["Mounts"][0]["Source"] == str(self.data)
                    and self.previous["Mounts"][0]["Destination"] == "/data")
            require(set(self.previous["NetworkSettings"]["Networks"]) == {self.network})
        self.report["channel_layout_verified"] = True

    def stop(self):
        if self.previous and self.previous["State"]["Running"]:
            self.run(["docker", "stop", "--time", "30", NAME])
            self.stopped = True

    def start(self):
        if self.previous:
            self.run(["docker", "rename", NAME, self.old_name])
            self.renamed = True
        self.run(["docker", "run", "-d", "--name", NAME, "--restart", "unless-stopped",
                  "--network", self.network, "--security-opt", "no-new-privileges:true",
                  "--read-only", "--tmpfs", "/tmp:rw,noexec,nosuid,size=16m",
                  "--label", "org.everplain.channel=v1",
                  "--label", "org.everplain.revision=" + self.revision,
                  "--env-file", str(self.stage / "channel-gateway.env"),
                  "-p", "127.0.0.1:8298:8298", "--mount",
                  f"type=bind,src={self.data},dst=/data", self.image])
        self.started = True
        for attempt in range(30):
            try:
                # Read-only local evidence. This neither obtains tokens nor sends a message.
                value = json.loads(self.run(["docker", "exec", NAME, "/app/.venv/bin/python",
                                            "-c", "import urllib.request; "
                                            "print(urllib.request.urlopen("
                                            "'http://127.0.0.1:8298/health',timeout=3).read().decode())"],
                                           timeout=10))
                require(value["status"] == "local-ready"
                        and value["release_revision"] == self.revision)
                current = self.metadata(NAME)
                require(current["Config"]["Image"] == self.image and current["State"]["Running"])
                address = current["NetworkSettings"]["Networks"][self.network]["IPAddress"]
                require(re.fullmatch(r"(?:[0-9]{1,3}\.){3}[0-9]{1,3}", address) is not None)
                self.report["channel_local_health_verified"] = True
                return address
            except Exception:
                if attempt == 29:
                    raise RuntimeError("channel service readiness failed") from None
                time.sleep(1)

    def recover(self, *, api_kept_running):
        if api_kept_running:
            return
        if self.started:
            with contextlib.suppress(Exception):
                self.run(["docker", "stop", "--time", "30", NAME])
        if self.renamed and not self.started:
            self.run(["docker", "rename", self.old_name, NAME])
        if self.stopped and not self.started:
            self.run(["docker", "start", NAME])
        self.report["channel_data_preserved"] = True


def nginx_routes(config, address):
    require(re.fullmatch(r"(?:[0-9]{1,3}\.){3}[0-9]{1,3}", address) is not None)
    marker = "    location /api/ {"
    require(config.count(marker) == 1 and "/webhooks/" not in config)
    routes = "".join(
        "    location = /webhooks/" + platform + " {\n"
        "        limit_except POST { deny all; }\n"
        "        client_max_body_size 128k;\n"
        "        proxy_pass http://" + address + ":8298;\n"
        "        proxy_set_header Host $host;\n"
        "        proxy_set_header Connection \"\";\n"
        "        proxy_request_buffering off;\n"
        "        proxy_read_timeout 10s;\n"
        "    }\n" for platform in ("telegram", "feishu")
    )
    return config.replace(marker, routes + marker)
