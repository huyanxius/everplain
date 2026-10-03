"""Read-only booleans only: no production metadata is disclosed in public Actions logs."""

import json
import re
import subprocess
import urllib.request
from pathlib import Path


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args):
        raise ValueError("redirect rejected")


def healthy(url):
    try:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
        with opener.open(url, timeout=5) as response:
            return response.status == 200
    except Exception:
        return False


def inspect():
    docker_readable, container_present = False, False
    try:
        result = subprocess.run(
            ["docker", "ps", "--filter", "name=everplain", "--format", "{{.Names}}"],
            capture_output=True,
            text=True,
            timeout=20,
            check=False,
        )
        docker_readable = result.returncode == 0
        container_present = docker_readable and any(
            re.fullmatch(r"everplain(?:[-_][\w-]+)?", name) for name in result.stdout.splitlines()
        )
    except Exception:
        pass
    return {
        "ssh_authenticated": True,
        "docker_readable": docker_readable,
        "everplain_container_present": container_present,
        "api_health_ok": healthy("http://127.0.0.1:8297/api/health"),
        "web_health_ok": healthy("http://127.0.0.1:5196/"),
        "existing_release_controller_present": Path(
            "/usr/local/lib/everplain/cd/deploy.py"
        ).is_file(),
        "host_changes": False,
    }


if __name__ == "__main__":
    print(json.dumps(inspect(), indent=2))
