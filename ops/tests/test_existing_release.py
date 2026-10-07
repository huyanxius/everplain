"""Synthetic existing-container update; no network, Docker, secrets, or production."""

import hashlib
import importlib.util
import io
import json
import os
import shutil
import sqlite3
import stat
import subprocess
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "ops/cd"))
spec = importlib.util.spec_from_file_location(
    "existing_release", ROOT / "ops/cd/deploy-existing.py"
)
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class RegistryReleaseTests(unittest.TestCase):
    def test_forward_only_review_is_exact_and_does_not_authorize_the_rollback_controller(self):
        previous, candidate = {"migration_tree": "e" * 64}, {"migration_tree": "1" * 64}
        policy = {"reviewed_forward_only_migration_transitions": [
            {"from": previous["migration_tree"], "to": candidate["migration_tree"]},
        ]}
        self.assertTrue(release.check_existing_migration_transition(previous, candidate, policy))
        self.assertFalse(release.check_existing_migration_transition(previous, previous, policy))
        with self.assertRaisesRegex(ValueError, "rollback compatibility"):
            release.check_compatible(previous, candidate, policy)
        for old, new in ((candidate, previous), (previous, {"migration_tree": "2" * 64}),
                         ({"migration_tree": "2" * 64}, candidate)):
            with self.subTest(old=old, new=new), \
                 self.assertRaisesRegex(ValueError, "rollback compatibility"):
                release.check_existing_migration_transition(old, new, policy)
        for records in (None, "*", [{"from": "e" * 64, "to": "*"}],
                        [{"from": "*", "to": "1" * 64}]):
            with self.subTest(records=records), \
                 self.assertRaisesRegex(ValueError, "rollback compatibility"):
                release.check_existing_migration_transition(previous, candidate, {
                    "reviewed_forward_only_migration_transitions": records,
                })

    def test_shipped_forward_only_review_matches_current_manifest_storage(self):
        policy = json.loads((ROOT / "ops/cd/policy.json").read_text())
        # Packaging includes migrations plus the retrieval schema adapter.
        storage = {
            "migrations/" + p.relative_to(ROOT / "backend/migrations").as_posix():
            hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted((ROOT / "backend/migrations").rglob("*.py"))
        }
        # These historical reviews used the pre-D02 adapter. Current bytes are
        # separately bound by test_shipped_vector_storage_review_binds_current_bytes.
        storage["schema/sqlite_index.py"] = (
            "d45eafd7c931a47a9c8f6731d563c8030202abf0f135390a978b8c919b36dcc3"
        )
        # Reconstruct exact historical endpoints before later membership/account DDL.
        del storage["migrations/versions/20261005_0640_membership_vouchers.py"]
        del storage["migrations/versions/20261005_0630_federated_accounts.py"]
        # These reviews predate import receipts and OAuth. Reconstruct their
        # exact trees rather than allowing hashes contaminated by later DDL.
        del storage["migrations/versions/20261005_0620_federated_login.py"]
        imported = {"migration_tree": hashlib.sha256(
            json.dumps(storage, sort_keys=True).encode()).hexdigest()}
        del storage["migrations/versions/20261005_0615_incremental_import_attachments.py"]
        journal = {"migration_tree": hashlib.sha256(
            json.dumps(storage, sort_keys=True).encode()).hexdigest()}
        del storage["migrations/versions/20261005_0610_agent_output_journal.py"]
        quota = {"migration_tree": hashlib.sha256(
            json.dumps(storage, sort_keys=True).encode()).hexdigest()}
        del storage["migrations/versions/20261005_0600_weekly_quota.py"]
        previous = {"migration_tree": hashlib.sha256(
            json.dumps(storage, sort_keys=True).encode()).hexdigest()}
        for old, new in ((previous, quota), (quota, journal), (journal, imported)):
            self.assertTrue(release.check_existing_migration_transition(old, new, policy))
            with self.assertRaisesRegex(ValueError, "rollback compatibility"):
                release.check_compatible(old, new, policy)
        # A reviewed 0600->0610 edge cannot skip the separately reviewed 0600 boundary.
        with self.assertRaisesRegex(ValueError, "rollback compatibility"):
            release.check_existing_migration_transition(previous, journal, policy)
        # The new review cannot skip prior boundaries, reverse, or bless mutated bytes.
        for old, new in ((previous, imported), (quota, imported), (imported, journal),
                         (journal, {"migration_tree": "0" * 64})):
            with self.subTest(old=old, new=new), self.assertRaisesRegex(
                ValueError, "rollback compatibility"
            ):
                release.check_existing_migration_transition(old, new, policy)

    def test_shipped_oauth_review_is_exact_forward_only_and_cannot_skip_import_head(self):
        policy = json.loads((ROOT / "ops/cd/policy.json").read_text())
        storage = {
            "migrations/" + p.relative_to(ROOT / "backend/migrations").as_posix():
            hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted((ROOT / "backend/migrations").rglob("*.py"))
        }
        # These historical reviews used the pre-D02 adapter. Current bytes are
        # separately bound by test_shipped_vector_storage_review_binds_current_bytes.
        storage["schema/sqlite_index.py"] = (
            "d45eafd7c931a47a9c8f6731d563c8030202abf0f135390a978b8c919b36dcc3"
        )
        # Reconstruct exact historical endpoints before later membership/account DDL.
        del storage["migrations/versions/20261005_0640_membership_vouchers.py"]
        del storage["migrations/versions/20261005_0630_federated_accounts.py"]
        candidate = {"migration_tree": hashlib.sha256(
            json.dumps(storage, sort_keys=True).encode()).hexdigest()}
        candidate_storage = dict(storage)
        del storage["migrations/versions/20261005_0620_federated_login.py"]
        previous = {"migration_tree": hashlib.sha256(
            json.dumps(storage, sort_keys=True).encode()).hexdigest()}
        del storage["migrations/versions/20261005_0615_incremental_import_attachments.py"]
        journal = {"migration_tree": hashlib.sha256(
            json.dumps(storage, sort_keys=True).encode()).hexdigest()}
        self.assertIn({"from": previous["migration_tree"], "to": candidate["migration_tree"]},
                      policy["reviewed_forward_only_migration_transitions"])
        self.assertTrue(release.check_existing_migration_transition(previous, candidate, policy))
        with self.assertRaisesRegex(ValueError, "rollback compatibility"):
            release.check_compatible(previous, candidate, policy)
        # Isolate the OAuth review when proving it cannot authorize the earlier
        # import transition, which has its own separately tested shipped review.
        oauth_review_only = {**policy, "reviewed_forward_only_migration_transitions": [
            {"from": previous["migration_tree"], "to": candidate["migration_tree"]},
        ]}
        for old, new in ((candidate, previous), (journal, candidate), (journal, previous),
                         (previous, {"migration_tree": "0" * 64}),
                         ({"migration_tree": "0" * 64}, candidate)):
            with self.subTest(old=old, new=new), \
                 self.assertRaisesRegex(ValueError, "rollback compatibility"):
                release.check_existing_migration_transition(old, new, oauth_review_only)
        for changed_file in (
            "migrations/versions/20261005_0620_federated_login.py",
            "migrations/versions/20261005_0615_incremental_import_attachments.py",
        ):
            changed = dict(candidate_storage)
            changed[changed_file] = "0" * 64
            changed_candidate = {"migration_tree": hashlib.sha256(
                json.dumps(changed, sort_keys=True).encode()).hexdigest()}
            with self.subTest(changed_file=changed_file), \
                 self.assertRaisesRegex(ValueError, "rollback compatibility"):
                release.check_existing_migration_transition(previous, changed_candidate, policy)

    def test_shipped_federated_account_review_is_exact_forward_only(self):
        policy = json.loads((ROOT / "ops/cd/policy.json").read_text())
        storage = {
            "migrations/" + p.relative_to(ROOT / "backend/migrations").as_posix():
            hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted((ROOT / "backend/migrations").rglob("*.py"))
        }
        # These historical reviews used the pre-D02 adapter. Current bytes are
        # separately bound by test_shipped_vector_storage_review_binds_current_bytes.
        storage["schema/sqlite_index.py"] = (
            "d45eafd7c931a47a9c8f6731d563c8030202abf0f135390a978b8c919b36dcc3"
        )
        del storage["migrations/versions/20261005_0640_membership_vouchers.py"]
        candidate_storage = dict(storage)
        candidate = {"migration_tree": hashlib.sha256(
            json.dumps(storage, sort_keys=True).encode()).hexdigest()}
        del storage["migrations/versions/20261005_0630_federated_accounts.py"]
        previous = {"migration_tree": hashlib.sha256(
            json.dumps(storage, sort_keys=True).encode()).hexdigest()}
        del storage["migrations/versions/20261005_0620_federated_login.py"]
        imported = {"migration_tree": hashlib.sha256(
            json.dumps(storage, sort_keys=True).encode()).hexdigest()}
        self.assertIn({"from": previous["migration_tree"], "to": candidate["migration_tree"]},
                      policy["reviewed_forward_only_migration_transitions"])
        self.assertTrue(release.check_existing_migration_transition(previous, candidate, policy))
        with self.assertRaisesRegex(ValueError, "rollback compatibility"):
            release.check_compatible(previous, candidate, policy)
        for old, new in ((candidate, previous), (imported, candidate),
                         (previous, {"migration_tree": "0" * 64}),
                         ({"migration_tree": "0" * 64}, candidate)):
            with self.subTest(old=old, new=new), self.assertRaisesRegex(
                ValueError, "rollback compatibility"
            ):
                release.check_existing_migration_transition(old, new, policy)
        for changed_file in (
            "migrations/versions/20261005_0630_federated_accounts.py",
            "migrations/versions/20261005_0620_federated_login.py",
        ):
            changed = dict(candidate_storage)
            changed[changed_file] = "0" * 64
            mutated = {"migration_tree": hashlib.sha256(
                json.dumps(changed, sort_keys=True).encode()).hexdigest()}
            with self.subTest(changed_file=changed_file), self.assertRaisesRegex(
                ValueError, "rollback compatibility"
            ):
                release.check_existing_migration_transition(previous, mutated, policy)

    def test_shipped_membership_review_is_exact_forward_only_and_cannot_skip_accounts(self):
        policy = json.loads((ROOT / "ops/cd/policy.json").read_text())
        storage = {
            "migrations/" + p.relative_to(ROOT / "backend/migrations").as_posix():
            hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted((ROOT / "backend/migrations").rglob("*.py"))
        }
        # These historical reviews used the pre-D02 adapter. Current bytes are
        # separately bound by test_shipped_vector_storage_review_binds_current_bytes.
        storage["schema/sqlite_index.py"] = (
            "d45eafd7c931a47a9c8f6731d563c8030202abf0f135390a978b8c919b36dcc3"
        )
        candidate_storage = dict(storage)
        candidate = {"migration_tree": hashlib.sha256(
            json.dumps(storage, sort_keys=True).encode()).hexdigest()}
        del storage["migrations/versions/20261005_0640_membership_vouchers.py"]
        previous = {"migration_tree": hashlib.sha256(
            json.dumps(storage, sort_keys=True).encode()).hexdigest()}
        self.assertEqual(previous["migration_tree"],
                         "677d1908068c46c5d23aa2bd2018fc906c133e7b16a3f1878b5a967350703b65")
        self.assertEqual(candidate["migration_tree"],
                         "2110b33f141d037084bf093bc663b0f228965cf9f25c91d668a8c8deba103e86")
        edge = {"from": previous["migration_tree"], "to": candidate["migration_tree"]}
        self.assertIn(edge, policy["reviewed_forward_only_migration_transitions"])
        self.assertNotIn(edge, policy["reviewed_migration_transitions"])
        self.assertTrue(release.check_existing_migration_transition(previous, candidate, policy))
        with self.assertRaisesRegex(ValueError, "rollback compatibility"):
            release.check_compatible(previous, candidate, policy)
        prior_endpoints = {
            point for record in policy["reviewed_forward_only_migration_transitions"]
            for point in (record["from"], record["to"])
        } - {previous["migration_tree"], candidate["migration_tree"]}
        pairs = [(candidate, previous), (previous, {"migration_tree": "0" * 64}),
                 ({"migration_tree": "0" * 64}, candidate)]
        pairs += [({"migration_tree": point}, candidate) for point in prior_endpoints]
        for old, new in pairs:
            with self.subTest(old=old, new=new), self.assertRaisesRegex(
                ValueError, "rollback compatibility"
            ):
                release.check_existing_migration_transition(old, new, policy)
        membership_only = {**policy, "reviewed_forward_only_migration_transitions": [edge]}
        del storage["migrations/versions/20261005_0630_federated_accounts.py"]
        earlier = {"migration_tree": hashlib.sha256(
            json.dumps(storage, sort_keys=True).encode()).hexdigest()}
        with self.assertRaisesRegex(ValueError, "rollback compatibility"):
            release.check_existing_migration_transition(earlier, previous, membership_only)
        # Every current/historical migration and the retrieval adapter are bound.
        for changed_file in candidate_storage:
            changed = dict(candidate_storage)
            changed[changed_file] = "0" * 64
            mutated = {"migration_tree": hashlib.sha256(
                json.dumps(changed, sort_keys=True).encode()).hexdigest()}
            with self.subTest(changed_file=changed_file), self.assertRaisesRegex(
                ValueError, "rollback compatibility"
            ):
                release.check_existing_migration_transition(previous, mutated, policy)

    def test_vector_storage_review_uses_existing_rollback_compatible_path(self):
        import review_vector_storage as vector_review

        policy = json.loads((ROOT / "ops/cd/policy.json").read_text())
        values = vector_review.storage(ROOT)
        current = {"migration_tree": vector_review.json_hash(values)}
        values["schema/sqlite_index.py"] = vector_review.PREVIOUS_INDEX_SHA256
        previous = {"migration_tree": vector_review.json_hash(values)}
        edge = {"from": previous["migration_tree"], "to": current["migration_tree"]}
        self.assertNotIn(edge, policy["reviewed_forward_only_migration_transitions"])
        self.assertFalse(release.check_existing_migration_transition(previous, current, policy))
        without_review = {**policy, "reviewed_migration_transitions": [
            record for record in policy["reviewed_migration_transitions"] if record != edge
        ]}
        with self.assertRaisesRegex(ValueError, "rollback compatibility"):
            release.check_existing_migration_transition(previous, current, without_review)
        with self.assertRaisesRegex(ValueError, "rollback compatibility"):
            release.check_existing_migration_transition(current, previous, policy)

    def test_live_compatibility_overlays_require_reviewed_bytes_and_read_only_mounts(self):
        with tempfile.TemporaryDirectory() as d:
            source = Path(d) / "settings.py"
            source.write_bytes(b"reviewed-model-allowlist")
            destination = sorted(release.COMPATIBILITY_DESTINATIONS)[0]
            mount = {"Source": str(source), "Destination": destination,
                     "Type": "bind", "RW": False}
            policy = {"reviewed_live_file_overlays": {
                destination: hashlib.sha256(source.read_bytes()).hexdigest()}}
            release.verify_live_overlays({"Mounts": [mount]}, policy)
            for changed in ({**mount, "RW": True}, {**mount, "Destination": "/other.py"}):
                with self.assertRaises(RuntimeError):
                    release.verify_live_overlays({"Mounts": [changed]}, policy)
            source.write_bytes(b"unreviewed")
            with self.assertRaises(RuntimeError):
                release.verify_live_overlays({"Mounts": [mount]}, policy)

    def test_public_http_identifies_the_release_client(self):
        url = "https://e.qunxue.xyz/api/health"
        with patch.object(release.urllib.request, "build_opener") as factory:
            response = factory.return_value.open.return_value.__enter__.return_value
            response.url, response.status = url, 200
            response.read.return_value = b"{}"
            self.assertEqual(release.http(url), b"{}")
            request = factory.return_value.open.call_args.args[0]
            self.assertEqual(request.full_url, url)
            self.assertEqual(request.get_header("User-agent"), "Everplain-Release/1.0")

    def test_registry_identity_accepts_config_or_pinned_manifest_and_rejects_unbound_images(self):
        expected = "sha256:" + "b" * 64
        digest = "sha256:" + "a" * 64
        reference = "ghcr.io/huyanxius/everplain-api@" + digest
        for identity, references, valid in (
            (expected, [reference], True), (digest, [reference], True),
            (expected, [], False), ("sha256:" + "d" * 64, [reference], False),
            (digest, ["ghcr.io/huyanxius/everplain-api@" + expected], False),
        ):
            with self.subTest(identity=identity, references=references):
                value = {"Id": identity, "RepoDigests": references}
                with patch.object(release, "run", return_value=json.dumps([value])) as inspect:
                    if valid:
                        self.assertEqual(
                            release.registry_image(expected, reference, "api", {}), value)
                    else:
                        with self.assertRaises(RuntimeError):
                            release.registry_image(expected, reference, "api", {})
                    inspect.assert_called_once_with(["docker", "image", "inspect", reference])

    def test_web_only_release_never_stops_api_or_copies_data_and_restores_web_on_failure(self):
        for failed in (False, True):
            with self.subTest(failed=failed), tempfile.TemporaryDirectory() as d, \
                 patch.object(release, "PREVIOUS_REVISION", "c" * 40, create=True):
                root = Path(d)
                api = container("api", root)
                api["Image"] = "sha256:" + "b" * 64
                web = container("web", root)
                web["Mounts"] = [{"Destination": "/etc/nginx/conf.d/default.conf"}]
                update = release.ExistingRelease(root / "input", root)
                update.stage = root
                update.old_names = {"web": "everplain-web-before-test"}
                update.images = {"api": api["Image"], "web": "sha256:" + "a" * 64}
                update.baseline, update.previous_state = {}, None
                update.state_path = root / "state"
                update.old_revision = "c" * 40
                with patch.object(release, "snapshot", return_value={}), \
                     patch.object(release, "read_state", return_value=None), \
                     patch.object(release, "run", return_value="") as commands, \
                     patch.object(release, "metadata", return_value=api), \
                     patch.object(release, "environment",
                                  return_value={"EVERPLAIN_RUNTIME_MODE": "base"}), \
                     patch.object(release, "public_health",
                                  side_effect=RuntimeError("health") if failed else None), \
                     patch.object(update, "complete"), patch.object(update, "record"):
                    if failed:
                        with self.assertRaises(RuntimeError):
                            update.activate_web_only({}, api, web, "bridge")
                        self.assertTrue(update.report["old_service_restored"])
                    else:
                        update.activate_web_only({}, api, web, "bridge")
                        self.assertTrue(update.report["api_unchanged_verified"])
                    for call in commands.call_args_list:
                        self.assertNotIn("everplain-api", call.args[0])
                        self.assertNotIn("alembic", call.args[0])
                    self.assertFalse((root / "data").exists())

    def test_digest_pull_reuses_layers_and_removes_temporary_credentials(self):
        manifest = {
            "registry_images": {role: f"ghcr.io/huyanxius/everplain-{role}@sha256:" + "a" * 64
                                for role in ("api", "web")},
            "images": {role: "sha256:" + "b" * 64 for role in ("api", "web")},
        }
        info = {"Id": "sha256:" + "b" * 64, "Architecture": "amd64", "Os": "linux",
                "Config": {"Labels": {"org.opencontainers.image.revision": "c" * 40}}}
        for failed in (False, True):
            with self.subTest(failed=failed), tempfile.TemporaryDirectory() as d:
                report = {}
                login = subprocess.CompletedProcess([], 0, "", "")
                with patch.object(release, "REVISION", "c" * 40), \
                     patch.object(release.sys, "stdin", io.StringIO("synthetic-job-token\n")), \
                     patch.object(release.subprocess, "run", return_value=login) as auth, \
                     patch.object(release, "pull_registry_image",
                                  side_effect=RuntimeError("pull failed") if failed else None,
                                  return_value="aaa: Already exists\n"
                                               "bbb: Pull complete\n") as pull, \
                     patch.object(release, "run", return_value=""), \
                     patch.object(release, "registry_image", return_value=info):
                    if failed:
                        with self.assertRaises(RuntimeError):
                            release.pull_registry_images(manifest, Path(d), report)
                    else:
                        images = release.pull_registry_images(manifest, Path(d), report)
                        self.assertEqual(set(images), {"api", "web"})
                        self.assertEqual(report["api_reused_layer_count"], 1)
                        self.assertTrue(report["registry_credentials_removed"])
                        self.assertEqual(pull.call_args_list[0].args[0],
                                         manifest["registry_images"]["api"])
                    self.assertNotIn("synthetic-job-token", str(auth.call_args.args))
                    self.assertTrue(report["registry_credentials_removed"])
                    self.assertEqual(list(Path(d).iterdir()), [])


class RegistryPullTests(unittest.TestCase):
    reference = "ghcr.io/huyanxius/everplain-web@sha256:" + "a" * 64

    def test_failure_classification_is_fixed_and_permanent_errors_take_precedence(self):
        cases = (
            ("unauthorized: authentication required; connection reset by peer", "authentication"),
            ("denied: requested access to the resource is denied", "authentication"),
            ("manifest unknown; unexpected EOF", "not_found"),
            ("no space left on device; i/o timeout", "storage"),
            ("permission denied", "storage"),
            ("x509: certificate signed by unknown authority; i/o timeout", "certificate"),
            ("checksum mismatch; unexpected EOF", "integrity"),
            ("toomanyrequests: registry rate limit", "rate_limit"),
            ("Get https://synthetic.invalid/path?token=synthetic-private: i/o timeout",
             "transient_network"),
            ("TLS handshake timeout", "transient_network"),
            ("unexpected EOF", "transient_network"),
            ("connection reset by peer", "transient_network"),
            ("context deadline exceeded", "unknown"),
            ("unclassified synthetic-private response", "unknown"),
        )
        for error, expected in cases:
            with self.subTest(expected=expected, error=error):
                self.assertEqual(release.classify_pull_failure(error), expected)

    def test_transient_retry_keeps_exact_digest_and_remaining_command_budget(self):
        failed = subprocess.CompletedProcess([], 1, "", "i/o timeout: synthetic-private")
        succeeded = subprocess.CompletedProcess([], 0, "aaa: Already exists\n", "")
        report = {}
        with patch.object(release.subprocess, "run", side_effect=[failed, succeeded]) as command, \
             patch.object(release.time, "monotonic", side_effect=[10, 10, 30, 35]), \
             patch.object(release.time, "sleep") as sleep:
            self.assertEqual(
                release.pull_registry_image(self.reference, "/synthetic", "web", report),
                succeeded.stdout)
        self.assertEqual(command.call_args_list[0].args, command.call_args_list[1].args)
        self.assertEqual(command.call_args.args[0][-1], self.reference)
        self.assertEqual([call.kwargs["timeout"] for call in command.call_args_list], [600, 575])
        sleep.assert_called_once_with(5)
        self.assertEqual(report["web_pull_attempts"], 2)
        self.assertEqual(report["web_pull_retry_count"], 1)
        self.assertTrue(report["web_pull_command_succeeded"])
        self.assertEqual(report["web_pull_last_failure_class"], "transient_network")
        self.assertNotIn("synthetic-private", json.dumps(report))

    def test_repeated_network_failure_stops_at_three_attempts_without_output_leaks(self):
        error = "Get https://synthetic.invalid/path?token=synthetic-private: unexpected EOF"
        report = {}
        with (
            patch.object(release.subprocess, "run",
                         return_value=subprocess.CompletedProcess([], 1, "", error)) as command,
            patch.object(release.time, "sleep") as sleep,
            self.assertRaisesRegex(RuntimeError, "transient_network") as caught,
        ):
            release.pull_registry_image(self.reference, "/synthetic", "web", report)
        self.assertEqual(command.call_count, 3)
        self.assertEqual([call.args[0] for call in command.call_args_list],
                         [command.call_args.args[0]] * 3)
        self.assertEqual([call.args[0] for call in sleep.call_args_list], [5, 10])
        self.assertEqual(report["web_pull_retry_count"], 2)
        self.assertNotIn("synthetic-private", str(caught.exception) + json.dumps(report))
        self.assertNotIn("https://", json.dumps(report))

    def test_non_transient_failures_stop_without_retry(self):
        for error in ("unauthorized", "manifest unknown", "no space left", "x509: invalid",
                      "checksum mismatch", "toomanyrequests", "unknown synthetic-private"):
            with self.subTest(error=error), \
                 patch.object(release.subprocess, "run", return_value=
                              subprocess.CompletedProcess([], 1, "", error)) as command, \
                 patch.object(release.time, "sleep") as sleep:
                report = {}
                with self.assertRaises(RuntimeError):
                    release.pull_registry_image(self.reference, "/synthetic", "web", report)
                command.assert_called_once()
                sleep.assert_not_called()
                self.assertEqual(report["web_pull_retry_count"], 0)
                self.assertNotIn("synthetic-private", json.dumps(report))

    def test_command_timeout_and_local_start_failure_are_not_assumed_network_failures(self):
        cases = ((subprocess.TimeoutExpired(["synthetic-private"], 600), "process_timeout"),
                 (OSError("synthetic-private"), "local_command"))
        for error, category in cases:
            with self.subTest(category=category), \
                 patch.object(release.subprocess, "run", side_effect=error) as command, \
                 patch.object(release.time, "sleep") as sleep:
                report = {}
                with self.assertRaisesRegex(RuntimeError, category) as caught:
                    release.pull_registry_image(self.reference, "/synthetic", "web", report)
                command.assert_called_once()
                sleep.assert_not_called()
                self.assertNotIn("synthetic-private", str(caught.exception) + json.dumps(report))

    def test_insufficient_retry_budget_stops_and_mutable_references_never_run(self):
        failed = subprocess.CompletedProcess([], 1, "", "i/o timeout")
        with patch.object(release.subprocess, "run", return_value=failed) as command, \
             patch.object(release.time, "monotonic", side_effect=[0, 0, 598]), \
             patch.object(release.time, "sleep") as sleep:
            with self.assertRaises(RuntimeError):
                release.pull_registry_image(self.reference, "/synthetic", "web", {})
            command.assert_called_once()
            sleep.assert_not_called()
        with patch.object(release.subprocess, "run") as command:
            with self.assertRaises(RuntimeError):
                release.pull_registry_image("ghcr.io/huyanxius/everplain-web:latest",
                                            "/synthetic", "web", {})
            command.assert_not_called()


def container(role, source):
    ports = {"api": ("8297", "8297/tcp"), "web": ("5196", "8080/tcp")}
    port, inside = ports[role]
    return {
        "Id": "fixture-" + role,
        "Name": "/everplain-" + role,
        "State": {"Running": True},
        "HostConfig": {
            "Privileged": False,
            "RestartPolicy": {"Name": "unless-stopped"},
            "PortBindings": {
                inside: [{"HostIp": "127.0.0.1", "HostPort": port}],
            },
        },
        "NetworkSettings": {"Networks": {"bridge": {"IPAddress": "172.17.0.5"}}},
        "Mounts": [
            {
                "Type": "volume",
                "Name": "everplain-data",
                "Source": str(source),
                "Destination": "/data",
                "RW": True,
            }
        ]
        if role == "api"
        else [],
        "Config": {
            "Image": release.API_IMAGE if role == "api" else release.WEB_IMAGE,
            "Env": [
                "EVERPLAIN_RUNTIME_MODE=base",
                "EVERPLAIN_ALLOW_MODEL_FALLBACK=true",
                "EVERPLAIN_DATABASE_URL=sqlite:////data/everplain.db",
                "EVERPLAIN_RETRIEVAL_INDEX_PATH=/data/everplain-retrieval.db",
                "EVERPLAIN_RELEASE_REVISION=" + release.PREVIOUS_REVISION,
                "EVERPLAIN_RESEND_API_KEY=synthetic-private-value",
            ],
        },
    }


class ExistingReleaseTests(unittest.TestCase):
    def setUp(self):
        release.REVISION = "a" * 40
        release.PREVIOUS_REVISION = "b" * 40  # Test-only previous revision.
        release.ARCHIVE_SHA256 = hashlib.sha256(b"synthetic archive").hexdigest()
        release.API_IMAGE = "sha256:" + "c" * 64
        release.WEB_IMAGE = "sha256:" + "d" * 64
        release.RUN_ID, release.RUN_ATTEMPT = "200", "1"
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / "everplain-data"
        self.source.mkdir()
        with sqlite3.connect(self.source / "everplain.db") as db:
            db.executescript(
                "CREATE TABLE writes(value TEXT); CREATE TABLE schema_marker(value TEXT);"
                "INSERT INTO schema_marker VALUES ('old');"
                "CREATE TABLE users(id TEXT PRIMARY KEY);"
                "CREATE TABLE alembic_version(version_num TEXT);"
            )
        self.archive = self.root / "candidate.tar.gz"
        self.archive.write_bytes(b"synthetic archive")
        self.calls = []
        self.failure = None
        self.api_started = False
        self.disk_results = None
        self.updater = release.ExistingRelease(self.archive, self.root / "updates")

    def snapshot(self, path, table):
        with sqlite3.connect(path) as db:
            return db.execute("SELECT * FROM " + table).fetchall()

    def metadata(self, name):
        value = container(name.removeprefix("everplain-"), self.source)
        value["Config"]["Image"] = getattr(self, "resolved_images", {}).get(
            value["Config"]["Image"], value["Config"]["Image"]
        )
        return value

    def unpack(self, archive, destination, revision, checksum):
        self.assertEqual(revision, release.REVISION)
        self.assertEqual(checksum, release.ARCHIVE_SHA256)
        destination.mkdir()
        (destination / "images").mkdir()
        for role in ("api", "web"):
            (destination / "images" / (role + ".tar")).write_bytes(b"fixture")
        (destination / "ops/cd").mkdir(parents=True)
        (destination / "ops/cd/policy.json").write_text(
            json.dumps(getattr(self, "migration_policy", {
                "rollback_compatible_migration_trees": [],
            }))
        )
        observed = self.runtime_snapshot()
        candidate_tree = getattr(
            self, "candidate_migration_tree", observed["api"]["migration_tree"]
        )
        candidate_api = {**observed["api"], "migration_tree": candidate_tree}
        return {
            "revision": release.REVISION,
            "images": {"api": release.API_IMAGE, "web": release.WEB_IMAGE}, "web_checks": {},
            "migration_tree": candidate_tree,
            "runtime_identity": {"api": candidate_api, "web_tree": observed["web_tree"]},
            "initial_live_fingerprint": {"format": 1, "runtime": observed},
            "provenance": {"run_id": "200", "run_attempt": "1",
                "workflow_ref": "huyanxius/everplain/.github/workflows/deploy.yml@refs/heads/main"},
        }

    def runtime_snapshot(self, *_args):
        resolved = getattr(self, "resolved_images", {})
        result = {
            "api_image": resolved.get(release.API_IMAGE, release.API_IMAGE),
            "web_image": resolved.get(release.WEB_IMAGE, release.WEB_IMAGE),
            "api": {k: "e" * 64 for k in
                ("source_tree", "dependency_tree", "migration_tree", "ops_tree", "tokenizer_tree")},
            "web_tree": "f" * 64,
        }
        if self.api_started and hasattr(self, "candidate_migration_tree"):
            result["api"]["migration_tree"] = self.candidate_migration_tree
        return result

    def command(self, args, **_kwargs):
        self.calls.append(args)
        self.assertNotIn("synthetic-private-value", " ".join(map(str, args)))
        if "/app/ops/preflight.py" in args and self.failure == "bookmark-proxy":
            self.updater.report["bookmark_proxy_compatibility_verified"] = False
            raise RuntimeError("synthetic incompatible bookmark proxy")
        if args[:2] == ["docker", "stop"] and getattr(self, "write_before_stop", False):
            self.write_before_stop = False
            with sqlite3.connect(self.source / "everplain.db") as db:
                db.execute("INSERT INTO writes VALUES ('arrived-before-stop')")
        if args[:2] == ["docker", "info"]:
            return str(self.root)
        if args[:3] == ["docker", "image", "inspect"]:
            return json.dumps(
                [
                    {
                        "Id": getattr(self, "resolved_images", {}).get(args[3], args[3]),
                        "Architecture": "amd64",
                        "Os": "linux",
                        "Config": {
                            "Labels": {"org.opencontainers.image.revision": release.REVISION},
                        },
                    }
                ]
            )
        if "backup" in args:
            shutil.copyfile(
                self.source / "everplain.db", self.updater.stage / "backups/everplain.db"
            )
        if "alembic" in args:
            with sqlite3.connect(self.updater.stage / "data/everplain.db") as db:
                db.execute("UPDATE schema_marker SET value='new'")
            if self.failure == "migration":
                raise RuntimeError("synthetic failure")
        if (
            args[:3] == ["docker", "run", "-d"]
            and args[args.index("--name") + 1] == "everplain-api"
        ):
            self.api_started = True
            with sqlite3.connect(self.updater.stage / "data/everplain.db") as db:
                db.execute("INSERT INTO writes VALUES ('accepted-background-write')")
        return ""

    def health(self, _revision, **_kwargs):
        if self.failure == "api-health":
            raise RuntimeError("synthetic failure")

    def public(self, *_args):
        if self.failure == "public-health":
            raise RuntimeError("synthetic failure")

    def disk_usage(self, _path):
        from types import SimpleNamespace

        if self.disk_results is not None:
            return next(self.disk_results)
        return SimpleNamespace(free=2**60)

    def execute(self):
        primary = release.copy_primary

        def backup(source, target, report, **kwargs):
            self.calls.append(["online-backup" if kwargs.get("prefix") else "backup"])
            if kwargs.get("prefix") and self.failure == "online-backup":
                raise sqlite3.OperationalError("synthetic failure")
            return primary(source, target, report, **kwargs)

        with (
            patch.object(release.shutil, "disk_usage", side_effect=self.disk_usage),
            patch.object(release, "metadata", side_effect=self.metadata),
            patch.object(release, "snapshot", side_effect=self.runtime_snapshot),
            patch.object(release, "unpack", side_effect=self.unpack),
            patch.object(release, "reusable_stage", return_value=None),
            patch.object(release, "copy_primary", side_effect=backup),
            patch.object(release, "repair_web"),
            patch.object(release, "inspect_image_archive"),
            patch.object(
                release,
                "loaded_image",
                side_effect=lambda image, *_: json.loads(
                    self.command(["docker", "image", "inspect", image])
                )[0],
            ),
            patch.object(release, "run", side_effect=self.command),
            patch.object(release.Controller, "health", side_effect=self.health),
            patch.object(release, "public_health", side_effect=self.public),
            patch.object(
                release,
                "http",
                return_value=json.dumps(
                    {
                        "status": "ok",
                        "release_revision": release.PREVIOUS_REVISION,
                    }
                ).encode(),
            ),
        ):
            return self.updater.execute()

    def test_success_keeps_original_data_and_uses_candidate_snapshot(self):
        report = self.execute()
        self.assertTrue(report["deployment_succeeded"])
        self.assertEqual(self.snapshot(self.source / "everplain.db", "schema_marker"), [("old",)])
        self.assertEqual(
            self.snapshot(self.updater.stage / "data/everplain.db", "schema_marker"), [("new",)]
        )
        self.assertEqual(
            self.snapshot(self.updater.stage / "data/everplain.db", "writes"),
            [("accepted-background-write",)],
        )
        self.assertTrue(all(type(value) is bool for value in report.values()))
        env = next(self.updater.stage.glob("releases/*/runtime.env"))
        self.assertEqual(env.stat().st_mode & 0o777, 0o600)
        self.assertIn("synthetic-private-value", env.read_text())
        self.assertNotIn("synthetic-private-value", json.dumps(report))
        stopped = next(i for i, call in enumerate(self.calls) if call[:2] == ["docker", "stop"])
        backup = next(i for i, call in enumerate(self.calls) if "backup" in call)
        migrate = next(i for i, call in enumerate(self.calls) if "alembic" in call)
        self.assertLess(stopped, backup)
        self.assertLess(backup, migrate)
        self.assertFalse(any(call[:3] == ["docker", "network", "create"] for call in self.calls))

    def test_activation_uses_only_proven_immutable_store_ids_and_records_mapping(self):
        self.resolved_images = {
            release.API_IMAGE: "sha256:" + "1" * 64,
            release.WEB_IMAGE: "sha256:" + "2" * 64,
        }
        report = self.execute()
        self.assertTrue(report["deployment_succeeded"])
        commands = [call for call in self.calls if call[:2] == ["docker", "run"]]
        self.assertTrue(commands)
        self.assertTrue(
            all(
                release.API_IMAGE not in call and release.WEB_IMAGE not in call for call in commands
            )
        )
        saved = json.loads((self.updater.stage / "transaction.json").read_text())
        self.assertEqual(saved["images"]["api"], self.resolved_images[release.API_IMAGE])

    def test_online_snapshot_failure_never_stops_existing_services(self):
        self.failure = "online-backup"
        with self.assertRaises(sqlite3.OperationalError):
            self.execute()
        self.assertFalse(any(call[:2] == ["docker", "stop"] for call in self.calls))
        self.assertFalse(self.updater.started)

    def test_bookmark_proxy_preflight_failure_never_stops_or_replaces_current_services(self):
        self.failure = "bookmark-proxy"
        with self.assertRaisesRegex(RuntimeError, "incompatible bookmark proxy"):
            self.execute()
        self.assertFalse(any(call[:2] in (["docker", "stop"], ["docker", "rename"])
                             or call[:3] == ["docker", "run", "-d"] for call in self.calls))
        self.assertFalse(self.updater.started)
        self.assertFalse(self.updater.report["configuration_verified"])
        self.assertFalse(self.updater.report["bookmark_proxy_compatibility_verified"])
        self.assertEqual(self.snapshot(self.source / "everplain.db", "schema_marker"), [("old",)])

    def test_cutover_uses_final_backup_not_earlier_online_snapshot(self):
        self.write_before_stop = True
        self.execute()
        online = self.updater.stage / "online-validation/everplain.db"
        self.assertEqual(self.snapshot(online, "writes"), [])
        self.assertIn(
            ("arrived-before-stop",),
            self.snapshot(self.updater.stage / "data/everplain.db", "writes"),
        )
        online_index = next(i for i, call in enumerate(self.calls) if call == ["online-backup"])
        stop_index = next(i for i, call in enumerate(self.calls) if call[:2] == ["docker", "stop"])
        self.assertLess(online_index, stop_index)

    def test_migration_failure_restores_untouched_old_containers_and_data(self):
        self.failure = "migration"
        with self.assertRaises(RuntimeError):
            self.execute()
        self.assertFalse(self.api_started)
        self.assertTrue(self.updater.report["old_service_restored"])
        self.assertEqual(self.snapshot(self.source / "everplain.db", "schema_marker"), [("old",)])
        self.assertIn(["docker", "start", "everplain-api"], self.calls)

    def enable_forward_only_fixture(self):
        self.candidate_migration_tree = "1" * 64
        self.migration_policy = {"reviewed_forward_only_migration_transitions": [
            {"from": "e" * 64, "to": self.candidate_migration_tree},
        ]}

    def test_forward_only_success_keeps_candidate_data_and_records_exact_review(self):
        self.enable_forward_only_fixture()
        report = self.execute()
        self.assertTrue(report["deployment_succeeded"])
        self.assertTrue(report["forward_only_migration_review_verified"])
        self.assertFalse(report["old_service_restored"])
        self.assertEqual(self.snapshot(self.source / "everplain.db", "schema_marker"), [("old",)])
        self.assertEqual(self.snapshot(self.updater.stage / "data/everplain.db", "schema_marker"),
                         [("new",)])
        state = json.loads(self.updater.state_path.read_text())
        self.assertEqual(state["runtime"]["api"]["migration_tree"], self.candidate_migration_tree)

    def test_forward_only_failure_before_candidate_start_restores_only_untouched_old_data(self):
        self.enable_forward_only_fixture()
        self.failure = "migration"
        with self.assertRaises(RuntimeError):
            self.execute()
        self.assertTrue(self.updater.report["forward_only_migration_review_verified"])
        self.assertFalse(self.updater.started)
        self.assertTrue(self.updater.report["old_service_restored"])
        self.assertEqual(self.snapshot(self.source / "everplain.db", "schema_marker"), [("old",)])
        self.assertEqual(self.snapshot(self.source / "everplain.db", "writes"), [])
        self.assertEqual(self.snapshot(self.updater.stage / "data/everplain.db", "schema_marker"),
                         [("new",)])

    def test_forward_only_failure_after_start_retains_candidate_and_never_runs_old_app(self):
        self.enable_forward_only_fixture()
        self.failure = "api-health"
        with self.assertRaises(RuntimeError):
            self.execute()
        self.assertTrue(self.updater.report["forward_only_migration_review_verified"])
        self.assertTrue(self.updater.report["forward_stop_required"])
        self.assertTrue(self.updater.started)
        self.assertFalse(self.updater.report["old_service_restored"])
        self.assertFalse(any(call[:2] == ["docker", "start"] for call in self.calls))
        self.assertEqual(self.snapshot(self.updater.stage / "data/everplain.db", "schema_marker"),
                         [("new",)])
        self.assertEqual(self.snapshot(self.updater.stage / "data/everplain.db", "writes"),
                         [("accepted-background-write",)])
        journal = json.loads((self.updater.stage / "transaction.json").read_text())
        self.assertTrue(journal["candidate_started"])
        self.assertTrue(journal["report"]["forward_stop_required"])

    def test_unknown_forward_only_edge_fails_before_service_stop_or_migration(self):
        self.enable_forward_only_fixture()
        self.migration_policy["reviewed_forward_only_migration_transitions"][0]["to"] = "2" * 64
        with self.assertRaisesRegex(ValueError, "rollback compatibility"):
            self.execute()
        self.assertFalse(self.updater.stopped)
        self.assertFalse(self.updater.started)
        self.assertFalse(any(call[:2] == ["docker", "stop"] or "alembic" in call
                             for call in self.calls))

    def test_failure_after_api_start_never_restarts_old_app_or_discards_new_writes(self):
        for failure in ("api-health", "public-health"):
            with self.subTest(failure=failure):
                self.failure = failure
                self.calls.clear()
                self.updater = release.ExistingRelease(self.archive, self.root / "updates")
                with self.assertRaises(RuntimeError):
                    self.execute()
                if failure == "public-health":
                    self.assertTrue(self.updater.report["candidate_kept_running"])
                    self.assertFalse(self.updater.report["forward_stop_required"])
                    api_start = next(i for i, call in enumerate(self.calls)
                                     if call[:2] == ["docker", "run"]
                                     and "everplain-api" in call)
                    self.assertFalse(any(call[:2] == ["docker", "stop"]
                                         for call in self.calls[api_start + 1:]))
                else:
                    self.assertTrue(self.updater.report["forward_stop_required"])
                self.assertFalse(self.updater.report["old_service_restored"])
                self.assertFalse(any(call[:2] == ["docker", "start"] for call in self.calls))
                self.assertEqual(
                    self.snapshot(self.updater.stage / "data/everplain.db", "writes"),
                    [("accepted-background-write",)],
                )

    def test_wrong_product_mount_or_port_fails_before_mutation(self):
        for change in ("mount", "port", "network"):
            api, web = container("api", self.source), container("web", self.source)
            if change == "mount":
                api["Mounts"][0]["Name"] = "other-product-data"
            elif change == "port":
                api["HostConfig"]["PortBindings"]["8297/tcp"][0]["HostIp"] = "0.0.0.0"
            else:
                api["NetworkSettings"]["Networks"] = {"other-product": {}}
            with self.subTest(change=change), self.assertRaises(RuntimeError):
                release.existing_layout(api, web)

    def test_release_preserves_existing_nested_data_with_owner_mode_and_bytes(self):
        directory = self.source / "existing-private-data" / "nested"
        directory.mkdir(parents=True)
        original = directory / "record.bin"
        original.write_bytes(b"existing-private-material")
        directory.chmod(0o750)
        original.chmod(0o640)
        before = original.stat()
        self.assertEqual(release.data_bytes(self.source),
                         (self.source / "everplain.db").stat().st_size + before.st_size)
        report = self.execute()
        target = self.updater.stage / "data" / original.relative_to(self.source)
        self.assertTrue(report["ancillary_data_preserved"])
        self.assertEqual(original.read_bytes(), target.read_bytes())
        after = target.stat()
        self.assertEqual((after.st_uid, after.st_gid, stat.S_IMODE(after.st_mode)),
                         (before.st_uid, before.st_gid, stat.S_IMODE(before.st_mode)))
        self.assertEqual(stat.S_IMODE(target.parent.stat().st_mode), 0o750)
        self.assertNotEqual(after.st_ino, before.st_ino)

    def test_nested_link_or_special_file_blocks_before_image_load_and_stop(self):
        for kind in ("link", "fifo"):
            directory = self.source / kind
            directory.mkdir()
            entry = directory / "entry"
            if kind == "link":
                entry.symlink_to(self.source / "everplain.db")
            else:
                os.mkfifo(entry)
            with self.subTest(kind=kind), self.assertRaises(RuntimeError):
                self.execute()
            self.assertFalse(any(call[:2] in (["docker", "load"], ["docker", "stop"])
                                 for call in self.calls))
            entry.unlink()
            directory.rmdir()

    def test_ancillary_copy_failure_restores_original_data_and_containers(self):
        original = self.source / "private.bin"
        original.write_bytes(b"retained")
        with patch.object(release, "copy_ancillary_data", side_effect=OSError("copy failed")), \
             self.assertRaises(OSError):
            self.execute()
        self.assertEqual(original.read_bytes(), b"retained")
        self.assertTrue(self.updater.report["old_service_restored"])
        self.assertFalse(self.updater.report["candidate_started"])

    def test_low_disk_blocks_before_copy_or_before_image_load(self):
        from collections import namedtuple

        Usage = namedtuple("Usage", "total used free")
        for checks in ([Usage(1, 1, 0)], [Usage(2**60, 0, 2**60), Usage(1, 1, 0)]):
            with self.subTest(checks=len(checks)):
                self.calls.clear()
                self.updater = release.ExistingRelease(self.archive, self.root / "updates")
                self.disk_results = iter(checks)
                with (
                    patch.object(release.shutil, "copyfile", wraps=shutil.copyfile) as copy,
                    self.assertRaises(RuntimeError),
                ):
                    self.execute()
                self.assertFalse(any(call[:2] == ["docker", "load"] for call in self.calls))
                self.assertFalse(any(call[:2] == ["docker", "stop"] for call in self.calls))
                if len(checks) == 1:
                    copy.assert_not_called()

    def test_old_always_restart_policy_is_rejected_without_modification(self):
        for role in ("api", "web"):
            api, web = container("api", self.source), container("web", self.source)
            selected = api if role == "api" else web
            selected["HostConfig"]["RestartPolicy"]["Name"] = "always"
            with self.subTest(role=role), self.assertRaises(RuntimeError):
                release.existing_layout(api, web)
            self.assertEqual(selected["HostConfig"]["RestartPolicy"]["Name"], "always")

    def test_failed_command_never_exposes_argv_or_secret_output(self):
        result = subprocess.CompletedProcess(
            [], 1, "synthetic-private-value", "synthetic-private-value"
        )
        with (
            patch.object(release.subprocess, "run", return_value=result),
            self.assertRaises(RuntimeError) as error,
        ):
            release.run(["fixture", "synthetic-private-value"])
        self.assertNotIn("synthetic-private-value", str(error.exception))

    def test_reusable_stage_rechecks_payload_and_rejects_transaction_or_modified_files(self):
        base = self.root / "stages"
        stage = base / (release.REVISION[:8] + "-fixture")
        target = stage / "releases" / release.REVISION
        target.mkdir(parents=True)
        stage.chmod(0o700)
        (target / "backend").mkdir()
        (target / "payload").write_bytes(b"immutable")
        (stage / "release.tar.gz").write_bytes(b"archive")
        manifest = {
            "files": {"payload": release.digest(target / "payload")},
            "migration_tree": release.tree_hash(target / "backend"),
        }
        (target / "manifest.json").write_text(json.dumps(manifest))
        with (
            patch.object(release, "ARCHIVE_SHA256", release.digest(stage / "release.tar.gz")),
            patch.object(release, "validate_manifest", return_value=manifest),
        ):
            self.assertEqual(release.reusable_stage(base)[0], stage)
            for item in ("data", "backups", "transaction.json", "online-validation"):
                marker = stage / item
                marker.touch()
                self.assertIsNone(release.reusable_stage(base))
                self.assertEqual(release.reusable_stage(base, inputs_only=True)[0], stage)
                marker.unlink()
            (target / "payload").write_bytes(b"changed")
            with self.assertRaises(RuntimeError):
                release.reusable_stage(base)

    def test_new_stage_links_only_verified_immutable_inputs_never_data_or_env(self):
        source = self.root / "source-stage"
        old = source / "releases" / release.REVISION
        old.mkdir(parents=True)
        (old / "manifest.json").write_text("fixture")
        (old / "image.tar").write_bytes(b"public-image")
        (old / "runtime.env").write_text("private-config")
        (source / "release.tar.gz").write_bytes(b"public-archive")
        (source / "data").mkdir()
        (source / "data/everplain.db").write_bytes(b"private-user-data")
        target = self.root / "fresh-stage"
        target.mkdir()
        release.link_verified_payload(source, target, {"files": {"image.tar": "fixture"}})
        fresh = target / "releases" / release.REVISION
        self.assertEqual((old / "image.tar").stat().st_ino, (fresh / "image.tar").stat().st_ino)
        self.assertFalse((fresh / "runtime.env").exists())
        self.assertFalse((target / "data").exists())
        self.assertEqual((source / "data/everplain.db").read_bytes(), b"private-user-data")

    def test_host_readonly_sqlite_backup_preserves_wal_source_and_rejects_existing_target(self):
        source = self.source / "everplain.db"
        with sqlite3.connect(source) as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.execute("INSERT INTO users VALUES ('fixture-owner')")
        db.close()
        before = source.read_bytes()
        target = self.root / "wal-backup.db"
        report = {}
        release.copy_primary(source, target, report)
        self.assertTrue(report["primary_backup_complete"])
        self.assertEqual(source.read_bytes(), before)
        for suffix in ("-wal", "-shm"):
            sidecar = source.with_name(source.name + suffix)
            if sidecar.exists():
                self.assertEqual(
                    (sidecar.stat().st_uid, sidecar.stat().st_gid),
                    (source.stat().st_uid, source.stat().st_gid),
                )
        with sqlite3.connect(target) as db:
            self.assertEqual(db.execute("SELECT count(*) FROM users").fetchone()[0], 1)
            self.assertEqual(db.execute("PRAGMA integrity_check").fetchone()[0], "ok")
        frozen = target.read_bytes()
        with self.assertRaises(ValueError):
            release.copy_primary(source, target, {})
        self.assertEqual(target.read_bytes(), frozen)

    def test_archive_format_and_image_identity_are_only_boolean_diagnostics(self):
        path = self.root / "image.tar"
        config = b'{"architecture":"amd64","os":"linux"}'
        image_id = "sha256:" + hashlib.sha256(config).hexdigest()
        with tarfile.open(path, "w") as archive:
            for name, content in (("oci-layout", b"{}"), ("blobs/sha256/" + image_id[7:], config)):
                info = tarfile.TarInfo(name)
                info.size = len(content)
                archive.addfile(info, io.BytesIO(content))
        report = {}
        release.inspect_image_archive(path, image_id, report, "api")
        self.assertTrue(report["api_archive_config_matches_image"])
        self.assertTrue(report["api_archive_linux_amd64"])
        self.assertTrue(report["api_archive_oci_layout"])
        self.assertFalse(report["api_archive_docker_manifest"])
        self.assertTrue(all(type(value) is bool for value in report.values()))

    def test_loaded_image_distinguishes_identity_architecture_and_missing_label_privately(self):
        value = {
            "Id": release.API_IMAGE,
            "Architecture": "amd64",
            "Os": "linux",
            "Config": {"Labels": None, "Env": ["PRIVATE=must-not-print"]},
        }
        result = subprocess.CompletedProcess([], 0, json.dumps([value]), "")
        report = {}
        with patch.object(release.subprocess, "run", return_value=result):
            self.assertEqual(release.loaded_image(release.API_IMAGE, "api", report), value)
        self.assertTrue(report["api_id_identity_matches"])
        self.assertTrue(report["api_id_amd64"])
        self.assertFalse(report["api_id_revision_label_matches"])
        self.assertNotIn("must-not-print", json.dumps(report))
        self.assertTrue(all(type(value) is bool for value in report.values()))

    def test_containerd_identity_requires_archive_chain_and_exact_config_and_layers(self):
        config = {
            "architecture": "amd64",
            "os": "linux",
            "config": {
                "Env": ["FIXTURE=true"],
                "Cmd": ["start"],
                "Labels": {"org.opencontainers.image.revision": release.REVISION},
            },
            "rootfs": {"diff_ids": ["sha256:" + "a" * 64]},
        }
        blobs = {}

        def blob(value):
            data = json.dumps(value, sort_keys=True).encode()
            identity = "sha256:" + hashlib.sha256(data).hexdigest()
            blobs["blobs/sha256/" + identity[7:]] = data
            return identity

        expected = blob(config)
        manifest = blob({"config": {"digest": expected}, "layers": []})
        index = blob({"manifests": [{"digest": manifest}]})
        blobs["index.json"] = json.dumps({"manifests": [{"digest": index}]}).encode()
        path = self.root / "oci.tar"
        with tarfile.open(path, "w") as archive:
            for name, data in blobs.items():
                info = tarfile.TarInfo(name)
                info.size = len(data)
                archive.addfile(info, io.BytesIO(data))
        self.assertEqual(
            release.archive_image_identities(path, expected), {expected, manifest, index}
        )
        original = {
            "Id": index,
            "Architecture": "amd64",
            "Os": "linux",
            "Config": config["config"],
            "RootFS": {"Layers": config["rootfs"]["diff_ids"]},
        }
        for difference in (None, "identity", "config", "layers"):
            value = json.loads(json.dumps(original))
            if difference == "identity":
                value["Id"] = "sha256:" + "c" * 64
            elif difference == "config":
                value["Config"]["Cmd"] = ["different-command"]
            elif difference == "layers":
                value["RootFS"]["Layers"] = ["sha256:" + "d" * 64]
            results = [
                subprocess.CompletedProcess([], 1, "", "fixture-not-found"),
                subprocess.CompletedProcess([], 0, json.dumps([value]), ""),
            ]
            report = {
                "api_archive_config_matches_image": True,
                "api_archive_tag_references_expected_config": True,
            }
            with patch.object(release.subprocess, "run", side_effect=results):
                if difference:
                    with self.assertRaises(RuntimeError):
                        release.loaded_image(expected, "api", report, config, path)
                else:
                    loaded = release.loaded_image(expected, "api", report, config, path)
                    self.assertEqual(loaded["Id"], index)
                    self.assertTrue(report["api_store_identity_proven_by_archive"])
        self.assertEqual(
            release.archive_image_identities(path, "sha256:" + "e" * 64), {"sha256:" + "e" * 64}
        )

    def test_failed_preflight_reports_only_known_field_flags(self):
        value = {"invalid_fields": ["EVERPLAIN_SESSION_COOKIE_SECURE", "private-field-value"]}
        result = subprocess.CompletedProcess([], 1, json.dumps(value), "private-value")
        report = {}
        with (
            patch.object(release.subprocess, "run", return_value=result),
            self.assertRaises(RuntimeError),
        ):
            release.run(["fixture"], report=report, prefix="configuration_")
        self.assertTrue(report["invalid_session_cookie_secure"])
        self.assertTrue(report["invalid_other_configuration"])
        self.assertNotIn("private", json.dumps(report))

    def test_preflight_success_requires_boolean_proxy_proof_and_never_exposes_values(self):
        for configured, compatible, accepted in (
            (False, True, True), (True, True, True), (True, False, False),
            (None, True, False), (False, None, False), (False, "true", False),
        ):
            with self.subTest(configured=configured, compatible=compatible):
                value = {"invalid_fields": [], "bookmark_proxy_configured": configured,
                         "bookmark_proxy_compatible": compatible,
                         "ignored_proxy_url": "http://private-user:private-token@private-host"}
                result = subprocess.CompletedProcess([], 0, json.dumps(value), "")
                report = {}
                with patch.object(release.subprocess, "run", return_value=result):
                    if accepted:
                        release.run(["fixture"], report=report, prefix="configuration_")
                    else:
                        with self.assertRaisesRegex(RuntimeError, "proxy compatibility"):
                            release.run(["fixture"], report=report, prefix="configuration_")
                self.assertIs(report["bookmark_proxy_compatibility_verified"], accepted)
                self.assertTrue(all(type(item) is bool for item in report.values()))
                self.assertNotIn("private", json.dumps(report))

    def test_obsolete_fixed_candidate_workflow_is_retired(self):
        self.assertFalse((ROOT / ".github/workflows/publish-checked-candidate.yml").exists())
        # The historical recovery script remains checksum-bound if reviewed manually.
        transport = (ROOT / "ops/cd/deploy-existing-ssh.sh").read_text()
        self.assertIn('release_identity.py" verify', transport)
        self.assertIn("StrictHostKeyChecking=yes", transport)
        self.assertLess(transport.index('release_identity.py" verify'), transport.index("sftp "))


if __name__ == "__main__":
    unittest.main()
