"""Offline channel deployment contract; no host, container or real credentials."""

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "ops/cd"))
import artifact  # noqa: E402
import channel_gateway as channel  # noqa: E402


def values():
    return {channel.PREFIX + "BACKEND_URL": "https://e.qunxue.xyz",
            channel.PREFIX + "TELEGRAM_TOKEN": "123:synthetic-token",
            channel.PREFIX + "TELEGRAM_BACKEND_SECRET": "synthetic-service-secret" * 3,
            channel.PREFIX + "TELEGRAM_ALLOWED_SUBJECT_IDS": '["77"]'}


class ChannelReleaseTests(unittest.TestCase):
    def test_credentials_stay_scoped_and_existing_backend_settings_are_preserved(self):
        original = {"EVERPLAIN_MODEL_API_KEY": "synthetic-existing",
                    "EVERPLAIN_CHANNEL_GATEWAY_CREDENTIALS": json.dumps({
                        "telegram:456": "synthetic-preserved" * 3})}
        result = channel.backend_environment(original, values())
        self.assertEqual(result["EVERPLAIN_MODEL_API_KEY"], original["EVERPLAIN_MODEL_API_KEY"])
        self.assertEqual(set(json.loads(result["EVERPLAIN_CHANNEL_GATEWAY_CREDENTIALS"])),
                         {"telegram:123", "telegram:456"})
        self.assertEqual(original["EVERPLAIN_MODEL_API_KEY"], "synthetic-existing")
        incomplete = values()
        incomplete.pop(channel.PREFIX + "TELEGRAM_BACKEND_SECRET")
        with self.assertRaises(RuntimeError):
            channel.backend_environment({}, incomplete)

    def test_config_missing_is_explicit_and_foreign_keys_symlinks_fail_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            parent = Path(directory)
            target = parent / "channels.env"
            self.assertIsNone(channel.configuration(target))
            target.write_text("HTTP_PROXY=http://unapproved\n")
            target.chmod(0o600)
            original = Path.lstat

            def root_owned(path):
                info = original(path)
                return SimpleNamespace(st_mode=info.st_mode, st_uid=0)

            with patch.object(Path, "lstat", root_owned), self.assertRaises(RuntimeError):
                channel.configuration(target)
            target.unlink()
            target.symlink_to(parent / "missing")
            with self.assertRaises((RuntimeError, FileNotFoundError)):
                channel.configuration(target)

    def test_webhooks_are_exact_post_only_and_do_not_publish_health(self):
        config = (ROOT / "ops/nginx.conf").read_text()
        result = channel.nginx_routes(config, "172.17.0.5")
        for platform in ("telegram", "feishu"):
            self.assertIn("location = /webhooks/" + platform, result)
        self.assertEqual(result.count("limit_except POST { deny all; }"), 2)
        self.assertNotIn("location /webhooks/", result)
        self.assertNotIn("location = /health {", result)
        self.assertIn("proxy_pass http://api:8297;", result)
        for address in ("gateway:8298", "127.0.0.1; injected", "http://evil"):
            with self.assertRaises(RuntimeError):
                channel.nginx_routes(config, address)

    def test_service_preflight_is_offline_and_gateway_database_is_independent(self):
        with tempfile.TemporaryDirectory() as directory:
            stage, data = Path(directory) / "stage", Path(directory) / "channel" / "data"
            stage.mkdir()
            calls, report = [], {}
            image, revision = "sha256:" + "b" * 64, "a" * 40

            def run(command, **kwargs):
                calls.append(command)
                if command[:3] == ["docker", "ps", "-a"]:
                    return ""
                if command[:2] == ["docker", "exec"]:
                    return json.dumps({"status": "local-ready", "release_revision": revision})
                return ""

            current = {"Config": {"Image": image}, "State": {"Running": True},
                       "NetworkSettings": {"Networks": {"bridge": {"IPAddress": "172.17.0.5"}}}}
            service = channel.GatewayRelease(
                values=values(), image=image, revision=revision, stage=stage, network="bridge",
                run=run, metadata=lambda _: current, atomic=lambda p, b: p.write_bytes(b),
                report=report, data=data)
            original = os.stat

            def owned(path, **kwargs):
                info = original(path, **kwargs)
                return SimpleNamespace(st_mode=info.st_mode,
                                       st_uid=10001 if path == data else 0, st_gid=10001)

            with patch.object(Path, "lstat", owned), patch.object(channel.os, "chown"), \
                    patch.object(Path, "stat", owned):
                service.prepare()
            service.stop()
            self.assertEqual(service.start(), "172.17.0.5")
            preflight = calls[0]
            self.assertIn("none", preflight)
            self.assertNotIn("synthetic", json.dumps(calls))
            private = (stage / "channel-gateway.env").read_text()
            self.assertIn("EVERPLAIN_GATEWAY_PILOT_ONLY=true", private)
            self.assertIn("DATABASE_PATH=/data/everplain-gateway.db", private)
            self.assertNotIn("MODEL_API_KEY", private)
            self.assertTrue(report["channel_local_health_verified"])
            service.recover(api_kept_running=False)
            self.assertTrue(report["channel_data_preserved"])
            self.assertTrue(any(command[:3] == ["docker", "stop", "--time"] for command in calls))

    def test_current_release_packages_gateway_and_keeps_optional_old_manifest_compatibility(self):
        build = (ROOT / "ops/cd/build.sh").read_text()
        self.assertIn('for role in api web gateway; do', build)
        self.assertIn('"$prepared/images/gateway.tar"', build)
        self.assertIn('ops/cd/channel_gateway.py',
                      (ROOT / "ops/cd/deploy-existing-ssh.sh").read_text())
        self.assertIn('roles not in ({"api", "web"}, {"api", "web", "gateway"})',
                      (ROOT / "ops/cd/artifact.py").read_text())
        # The released optional role remains restricted to the same repository.
        self.assertNotIn("docker compose down", build)
        self.assertEqual(artifact.FORMAT, 1)


if __name__ == "__main__":
    unittest.main()
