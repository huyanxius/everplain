"""Offline release safety tests. No Docker daemon, SSH, production, or paid model calls."""

import hashlib
import io
import json
import os
import sqlite3
import stat
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "ops/cd"))
import artifact  # noqa: E402
import deploy  # noqa: E402

OLD = "a" * 40
NEW = "b" * 40


def database(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(path) as conn:
        conn.executescript(
            "CREATE TABLE users(id TEXT PRIMARY KEY);"
            "INSERT INTO users VALUES ('owner');"
            "CREATE TABLE alembic_version(version_num TEXT PRIMARY KEY);"
            "INSERT INTO alembic_version VALUES ('old');"
            "CREATE TABLE edits(value TEXT);"
        )
    path.chmod(0o640)


class FakeController(deploy.Controller):
    def __init__(self, root):
        super().__init__(root)
        self.uid, self.gid = os.getuid(), os.getgid()
        self.calls = []
        self.fail = None
        self.fail_once = True
        self.write_after_open = False
        self.write_on_start = False

    def service(self, name, action):
        self.calls.append((name, action))
        if (
            name == "api"
            and action == "start"
            and self.current().name == NEW
            and self.write_on_start
        ):
            with sqlite3.connect(self.active_database) as conn:
                conn.execute("INSERT INTO edits VALUES ('background-write')")
        if self.fail == (name, action) and self.fail_once:
            self.fail_once = False
            raise RuntimeError("injected service failure")

    def command(self, *args, **kwargs):
        return ""

    def prepare(self, release):
        self.calls.append(("prepare", release.name))

    def app(self, release, action):
        self.calls.append(("app", action))
        if action == self.fail:
            raise RuntimeError("injected runtime failure")
        if action == "migrate":
            with sqlite3.connect(self.active_database) as conn:
                conn.execute("UPDATE alembic_version SET version_num = 'new'")

    def health(self, revision, public=False, web=True):
        self.calls.append(("health", revision, public, web))
        if revision == NEW and public and self.write_after_open:
            with sqlite3.connect(self.active_database) as conn:
                conn.execute("INSERT INTO edits VALUES ('accepted-new-write')")
        if revision == NEW and (
            (self.fail == "api-health" and not web) or self.fail == "public-health" and public
        ):
            raise RuntimeError("injected health failure")


class FilesystemSafetyTests(unittest.TestCase):
    def test_atomic_replace_preserves_owner_group_mode_and_contents(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "config"
            target.write_bytes(b"original")
            target.chmod(0o640)
            original = target.stat()
            deploy.atomic_bytes(target, b"candidate")
            now = target.stat()
            self.assertEqual(
                (now.st_uid, now.st_gid, stat.S_IMODE(now.st_mode)),
                (original.st_uid, original.st_gid, 0o640),
            )
            self.assertEqual(target.read_bytes(), b"candidate")

    def test_ownership_is_set_explicitly_not_assumed_from_copy2(self):
        with tempfile.TemporaryDirectory() as directory:
            reference, target = Path(directory) / "old", Path(directory) / "new"
            reference.write_bytes(b"private")
            reference.chmod(0o600)
            info = reference.stat()
            with patch.object(deploy.os, "fchown", wraps=os.fchown) as chown:
                deploy.atomic_bytes(target, b"next", reference=reference)
                self.assertEqual(chown.call_args.args[1:], (info.st_uid, info.st_gid))
            self.assertEqual(target.stat().st_mode & 0o777, 0o600)

    def test_migration_change_fails_without_explicit_reviewed_compatibility(self):
        old, new = {"migration_tree": "a" * 64}, {"migration_tree": "b" * 64}
        with self.assertRaisesRegex(ValueError, "rollback compatibility"):
            deploy.check_compatible(old, new, {"rollback_compatible_migration_trees": []})
        deploy.check_compatible(old, new, {"rollback_compatible_migration_trees": ["a" * 64]})
        deploy.check_compatible(old, old, {})

    def test_reviewed_migration_transition_is_exact_and_not_a_source_wildcard(self):
        old, new = {"migration_tree": "a" * 64}, {"migration_tree": "b" * 64}
        policy = {"reviewed_migration_transitions": [{"from": "a" * 64, "to": "b" * 64}]}
        deploy.check_compatible(old, new, policy)
        for previous, candidate in ((new, old), (old, {"migration_tree": "c" * 64}),
                                    ({"migration_tree": "c" * 64}, new)):
            with (
                self.subTest(previous=previous, candidate=candidate),
                self.assertRaisesRegex(ValueError, "rollback compatibility"),
            ):
                deploy.check_compatible(previous, candidate, policy)
        with self.assertRaisesRegex(ValueError, "rollback compatibility"):
            deploy.check_compatible(old, new, {
                "reviewed_migration_transitions": [{"from": "a" * 64, "to": "*"}],
            })

    def test_shipped_review_is_bound_to_current_cache_migration_tree(self):
        policy = json.loads((ROOT / "ops/cd/policy.json").read_text())
        storage = {
            "migrations/" + p.relative_to(ROOT / "backend/migrations").as_posix():
            hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted((ROOT / "backend/migrations").rglob("*.py"))
        }
        storage["schema/sqlite_index.py"] = hashlib.sha256(
            (ROOT / "backend/src/qunxue_api/adapters/retrieval/sqlite_index.py").read_bytes()
        ).hexdigest()
        new_hash = hashlib.sha256(json.dumps(storage, sort_keys=True).encode()).hexdigest()
        dispatch_storage = {k: v for k, v in storage.items()
                            if k != "migrations/versions/20261005_0570_conversation_summary.py"}
        dispatch_hash = hashlib.sha256(
            json.dumps(dispatch_storage, sort_keys=True).encode()).hexdigest()
        context_storage = {k: v for k, v in dispatch_storage.items()
                           if k != "migrations/versions/20261005_0560_billing_dispatch.py"}
        context_hash = hashlib.sha256(
            json.dumps(context_storage, sort_keys=True).encode()
        ).hexdigest()
        old_storage = {k: v for k, v in context_storage.items()
                       if k != "migrations/versions/20261004_0550_conversation_context.py"}
        old_hash = hashlib.sha256(json.dumps(old_storage, sort_keys=True).encode()).hexdigest()
        self.assertEqual(policy["rollback_compatible_migration_trees"], [])
        for previous, candidate in ((old_hash, context_hash), (context_hash, dispatch_hash),
                                    (dispatch_hash, new_hash)):
            self.assertIn({"from": previous, "to": candidate},
                          policy["reviewed_migration_transitions"])
            deploy.check_compatible({"migration_tree": previous}, {"migration_tree": candidate},
                                    policy)
        with self.assertRaisesRegex(ValueError, "rollback compatibility"):
            deploy.check_compatible({"migration_tree": old_hash}, {"migration_tree": new_hash},
                                    policy)


class ArtifactTests(unittest.TestCase):
    def test_hash_mismatch_never_creates_destination(self):
        with tempfile.TemporaryDirectory() as directory:
            archive, target = Path(directory) / "bad.tar.gz", Path(directory) / "release"
            archive.write_bytes(b"untrusted")
            with self.assertRaisesRegex(ValueError, "SHA-256"):
                artifact.unpack(archive, target, NEW, "0" * 64)
            self.assertFalse(target.exists())

    def test_archive_traversal_links_and_duplicates_rejected_before_extraction(self):
        for kind in ("traversal", "symlink", "duplicate"):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as directory:
                archive, target = Path(directory) / "bad.tar.gz", Path(directory) / "release"
                with tarfile.open(archive, "w:gz") as bundle:
                    info = tarfile.TarInfo("../outside" if kind == "traversal" else "file")
                    if kind == "symlink":
                        info.type, info.linkname = tarfile.SYMTYPE, "/etc/passwd"
                    bundle.addfile(info, io.BytesIO())
                    if kind == "duplicate":
                        bundle.addfile(info, io.BytesIO())
                with self.assertRaises(ValueError):
                    artifact.unpack(archive, target, NEW, artifact.digest(archive))
                self.assertFalse(target.exists())

    def test_build_unpack_roundtrip_has_no_secrets_and_records_provenance(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for path in (
                "backend/migrations",
                "ops/cd",
                "frontend",
                "extensions/clipper",
                "prepared/images",
                "prepared/web/assets",
                "backend/src/qunxue_api/adapters/retrieval",
            ):
                (root / path).mkdir(parents=True)
            for path in (
                "backend/uv.lock",
                "frontend/package-lock.json",
                "extensions/clipper/package-lock.json",
                "backend/migrations/one.py",
                "backend/src/qunxue_api/adapters/retrieval/sqlite_index.py",
            ):
                (root / path).write_text("synthetic fixture")
            (root / "ops/cd/policy.json").write_text('{"rollback_compatible_migration_trees": []}')
            for name in ("api", "web"):
                (root / f"prepared/images/{name}.tar").write_bytes(b"synthetic image bytes")
            (root / "prepared/web/index.html").write_text(
                '<script src="/assets/index-a1b2.js"></script>'
            )
            (root / "prepared/web/assets/index-a1b2.js").write_text("console.log('fixture')")
            images = {"api": "sha256:" + "1" * 64, "web": "sha256:" + "2" * 64}
            (root / "prepared/api-identity.json").write_text(json.dumps({
                k: "e" * 64
                for k in (
                    "source_tree", "dependency_tree", "migration_tree", "ops_tree", "tokenizer_tree"
                )
            }))
            manifest = artifact.build(root, root / "prepared", root / "output", NEW, images, {})
            archive = root / "output/everplain.tar.gz"
            restored = artifact.unpack(archive, root / "release", NEW, artifact.digest(archive))
            self.assertEqual(manifest, restored)
            self.assertEqual(restored["revision"], NEW)
            self.assertIn("backend_lock_sha256", restored["provenance"])
            self.assertEqual(
                restored["provenance"]["clipper_lock_sha256"],
                artifact.digest(root / "extensions/clipper/package-lock.json"),
            )
            self.assertNotIn(".env", "\n".join(restored["files"]))
            references = {
                role: f"ghcr.io/huyanxius/everplain-{role}@sha256:" + "a" * 64
                for role in ("api", "web")
            }
            (root / "prepared/registry.json").write_text(json.dumps(references))
            (root / "prepared/image-sizes.json").write_text(json.dumps({"api": 100, "web": 200}))
            thin = artifact.build(root, root / "prepared", root / "thin", NEW, images, {})
            restored_thin = artifact.unpack(root / "thin/everplain.tar.gz", root / "thin-release",
                                           NEW, artifact.digest(root / "thin/everplain.tar.gz"))
            self.assertEqual(thin, restored_thin)
            self.assertEqual(thin["registry_images"], references)
            self.assertFalse(any(name.startswith("images/") for name in thin["files"]))
            for invalid in (references | {"api": "ghcr.io/huyanxius/everplain-api:latest"},
                            references | {"api": "ghcr.io/other/api@sha256:" + "a" * 64}):
                with self.assertRaises(ValueError):
                    artifact.validate_manifest(thin | {"registry_images": invalid}, NEW)


class TransactionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for name in ("releases", "data", "backups", "incoming"):
            (self.root / name).mkdir()
        self.old = self.root / "releases" / OLD
        self.new = self.root / "releases" / NEW
        for release in (self.old, self.new):
            (release / "ops/cd").mkdir(parents=True)
            (release / "runtime.env").write_text("EVERPLAIN_TEST=private-fixture\n")
            (release / "runtime.env").chmod(0o640)
            (release / "manifest.json").write_text(
                json.dumps({"revision": release.name, "migration_tree": "c" * 64})
            )
            (release / "ops/cd/policy.json").write_text(
                '{"rollback_compatible_migration_trees": []}'
            )
        (self.root / "current").symlink_to(self.old)
        self.source = self.root / "data/old/everplain.db"
        database(self.source)
        self.state = {
            "current": OLD,
            "previous": None,
            "database": str(self.source),
            "last_run_id": 1,
        }
        (self.root / "state.json").write_text(json.dumps(self.state))
        self.controller = FakeController(self.root)
        self.target = self.root / "data/new/everplain.db"

    def rows(self, path, table):
        with sqlite3.connect(path) as conn:
            return conn.execute(f"SELECT * FROM {table}").fetchall()

    def test_success_copies_database_and_atomically_switches_release(self):
        self.controller.activate(self.new, self.target, self.state, 2, migrate=True)
        self.assertEqual(self.controller.current(), self.new)
        self.assertEqual(self.rows(self.source, "alembic_version"), [("old",)])
        self.assertEqual(self.rows(self.target, "alembic_version"), [("new",)])
        self.assertEqual(self.target.stat().st_mode & 0o777, self.source.stat().st_mode & 0o777)
        self.assertEqual(self.controller.state()["previous"], OLD)
        self.assertFalse(self.controller.journal.exists())
        self.assertLess(
            self.controller.calls.index(("api", "stop")),
            self.controller.calls.index(("app", "migrate")),
        )

    def test_failed_migration_restores_old_pointer_config_metadata_and_database(self):
        self.controller.fail = "migrate"
        original = (self.old / "runtime.env").stat()
        with self.assertRaisesRegex(RuntimeError, "previous app/config restored"):
            self.controller.activate(self.new, self.target, self.state, 2, migrate=True)
        self.assertEqual(self.controller.current(), self.old)
        self.assertEqual(self.controller.state()["database"], str(self.source))
        now = (self.old / "runtime.env").stat()
        self.assertEqual(
            (now.st_uid, now.st_gid, now.st_mode),
            (original.st_uid, original.st_gid, original.st_mode),
        )
        self.assertEqual(self.rows(self.source, "alembic_version"), [("old",)])

    def test_failed_api_health_retains_background_writes_before_public_ingress(self):
        self.controller.fail = "api-health"
        self.controller.write_on_start = True
        with self.assertRaises(RuntimeError):
            self.controller.activate(self.new, self.target, self.state, 2, migrate=True)
        self.assertEqual(self.controller.state()["database"], str(self.target))
        self.assertEqual(self.rows(self.target, "edits"), [("background-write",)])
        self.assertFalse(self.controller.journal.exists())

    def test_failed_public_health_retains_writes_and_never_downgrades_database(self):
        self.controller.fail, self.controller.write_after_open = "public-health", True
        with self.assertRaisesRegex(RuntimeError, "previous app/config restored"):
            self.controller.activate(self.new, self.target, self.state, 2, migrate=True)
        self.assertEqual(self.controller.current(), self.old)
        self.assertEqual(self.controller.state()["database"], str(self.target))
        self.assertEqual(self.rows(self.target, "edits"), [("accepted-new-write",)])
        self.assertEqual(self.rows(self.target, "alembic_version"), [("new",)])
        self.assertEqual(self.rows(self.source, "edits"), [])

    def test_manual_rollback_keeps_current_database_and_known_previous_only(self):
        self.controller.activate(self.new, self.target, self.state, 2, migrate=True)
        with sqlite3.connect(self.target) as conn:
            conn.execute("INSERT INTO edits VALUES ('after-release')")
        result = self.controller.rollback(3)
        self.assertEqual(result["revision"], OLD)
        self.assertEqual(self.controller.state()["database"], str(self.target))
        self.assertEqual(self.rows(self.target, "edits"), [("after-release",)])
        self.assertEqual(self.controller.calls.count(("app", "migrate")), 1)

    def test_failed_rollback_preserves_journal_and_stops_ingress(self):
        self.controller.fail = "public-health"
        with (
            patch.object(self.controller, "restore", side_effect=RuntimeError("failure")),
            self.assertRaisesRegex(RuntimeError, "rollback failed"),
        ):
            self.controller.activate(self.new, self.target, self.state, 2, migrate=True)
        self.assertTrue(self.controller.journal.exists())
        self.assertEqual(self.controller.calls[-1], ("web", "stop"))
        self.controller.fail = None
        result = self.controller.rollback(3)
        self.assertEqual(result["status"], "interrupted_transaction_recovered")
        self.assertFalse(self.controller.journal.exists())

    def test_retrieval_database_and_committed_wal_survive_release(self):
        source = self.source.parent / "everplain-retrieval.db"
        connection = sqlite3.connect(source)
        self.addCleanup(connection.close)
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("CREATE TABLE vectors(value TEXT)")
        connection.execute("INSERT INTO vectors VALUES ('paid-embedding-fixture')")
        connection.commit()
        source.chmod(0o640)
        self.controller.activate(self.new, self.target, self.state, 2, migrate=True)
        candidate = self.target.parent / "everplain-retrieval.db"
        self.assertEqual(self.rows(candidate, "vectors"), [("paid-embedding-fixture",)])
        self.assertEqual(candidate.stat().st_mode & 0o777, 0o640)
        self.assertEqual(len(list((self.root / "backups").glob(f"2-{NEW}-*-retrieval.sqlite3"))), 1)

    def test_unknown_durable_siblings_are_rejected_before_downtime(self):
        (self.source.parent / "uploads").mkdir()
        with self.assertRaisesRegex(ValueError, "durable data sibling"):
            self.controller.disk_preflight(self.state, 0)
        self.assertEqual(self.controller.calls, [])

    def test_disk_preflight_counts_wal_and_checks_data_and_backup_filesystems(self):
        (self.source.parent / "everplain.db-wal").write_bytes(b"x" * 1024)
        usage = type("Usage", (), {"free": 0})()
        with (
            patch.object(deploy.shutil, "disk_usage", return_value=usage),
            self.assertRaisesRegex(ValueError, "insufficient space"),
        ):
            self.controller.disk_preflight(self.state, 0)
        self.assertEqual(self.controller.calls, [])

    def test_hangup_during_migration_restores_previous_release(self):
        with (
            patch.object(
                self.controller, "app", side_effect=lambda *a: deploy.interrupted(1, None)
            ),
            self.assertRaisesRegex(RuntimeError, "previous app/config restored"),
        ):
            self.controller.activate(self.new, self.target, self.state, 2, migrate=True)
        self.assertEqual(self.controller.current(), self.old)
        self.assertEqual(self.controller.state()["database"], str(self.source))

    def test_manual_rollback_rejects_low_disk_before_stopping_services(self):
        self.controller.activate(self.new, self.target, self.state, 2, migrate=True)
        self.controller.calls.clear()
        usage = type("Usage", (), {"free": 0})()
        with (
            patch.object(deploy.shutil, "disk_usage", return_value=usage),
            self.assertRaisesRegex(ValueError, "insufficient space"),
        ):
            self.controller.rollback(3)
        self.assertFalse(
            any(action in {("web", "stop"), ("api", "stop")} for action in self.controller.calls)
        )
        self.assertEqual(self.controller.current(), self.new)

    def test_failed_manual_rollback_keeps_actual_newer_database_tree(self):
        older, newer = "c" * 64, "d" * 64
        (self.new / "manifest.json").write_text(
            json.dumps({"revision": NEW, "migration_tree": newer})
        )
        (self.new / "ops/cd/policy.json").write_text(
            json.dumps({"rollback_compatible_migration_trees": [older]})
        )
        self.controller.activate(self.new, self.target, self.state, 2, migrate=True)
        original_health = self.controller.health
        failures = []

        def fail_old_once(revision, public=False, web=True):
            if revision == OLD and not failures:
                failures.append(True)
                raise RuntimeError("old app health failure")
            return original_health(revision, public, web)

        with (
            patch.object(self.controller, "health", side_effect=fail_old_once),
            self.assertRaisesRegex(RuntimeError, "previous app/config restored"),
        ):
            self.controller.rollback(3)
        self.assertEqual(self.controller.current(), self.new)
        self.assertEqual(self.controller.state()["database_migration_tree"], newer)
        self.assertEqual(self.controller.state()["database"], str(self.target))

    def test_stale_workflow_is_rejected_before_any_service_action(self):
        with self.assertRaisesRegex(ValueError, "stale"):
            self.controller.deploy(NEW, "0" * 64, 0)
        self.assertEqual(self.controller.calls, [])


class HealthContractTests(unittest.TestCase):
    def test_expected_runtime_requires_explicit_private_fallback_and_no_key(self):
        cases = (
            ("", "base"),
            ("EVERPLAIN_ALLOW_MODEL_FALLBACK=true\n", "mock"),
            ("EVERPLAIN_ALLOW_MODEL_FALLBACK=false\n", "base"),
            ("EVERPLAIN_ALLOW_MODEL_FALLBACK=true\nEVERPLAIN_MODEL_API_KEY=fixture\n", "base"),
        )
        with tempfile.TemporaryDirectory() as directory:
            release = Path(directory)
            path = release / "runtime.env"
            for contents, expected in cases:
                with self.subTest(expected=expected, configured=bool(contents)):
                    path.write_text(contents)
                    path.chmod(0o600)
                    self.assertEqual(deploy.expected_runtime_mode(release), expected)
            path.write_text("EVERPLAIN_RUNTIME_MODE=mock\nEVERPLAIN_ALLOW_MODEL_FALLBACK=true\n")
            with self.assertRaisesRegex(ValueError, "real business backend"):
                deploy.expected_runtime_mode(release)
            path.write_text("EVERPLAIN_ALLOW_MODEL_FALLBACK=true\n")
            path.chmod(0o644)
            with self.assertRaisesRegex(ValueError, "private and controller-owned"):
                deploy.expected_runtime_mode(release)
            path.unlink()
            with self.assertRaises(FileNotFoundError):
                deploy.expected_runtime_mode(release)

    def test_health_matches_configured_mode_and_never_adopts_http_mode(self):
        for fallback, actual, accepted in (
            (False, "base", True),
            (False, "mock", False),
            (True, "mock", True),
            (True, "base", False),
        ):
            with self.subTest(fallback=fallback, actual=actual), tempfile.TemporaryDirectory() as d:
                root = Path(d)
                release = root / "releases" / NEW
                release.mkdir(parents=True)
                (release / "manifest.json").write_text('{"web_checks": {}}')
                (release / "runtime.env").write_text(
                    f"EVERPLAIN_RUNTIME_MODE=base\nEVERPLAIN_ALLOW_MODEL_FALLBACK={fallback}\n"
                )
                (release / "runtime.env").chmod(0o600)
                body = json.dumps(
                    {"release_revision": NEW, "status": "ok", "runtime_mode": actual}
                ).encode()
                opener = type(
                    "Opener", (), {"open": lambda *_args, _body=body, **_kw: io.BytesIO(_body)}
                )()
                with (
                    patch.object(deploy.urllib.request, "build_opener", return_value=opener),
                    patch.object(deploy.time, "sleep"),
                ):
                    if accepted:
                        deploy.Controller(root).health(NEW, web=False)
                    else:
                        with self.assertRaisesRegex(RuntimeError, "frontend checks failed"):
                            deploy.Controller(root).health(NEW, web=False)

    def test_health_checks_frontend_bytes_cache_busting_and_public_rollback(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            release = root / "releases" / NEW
            release.mkdir(parents=True)
            index, script = b"<script src='/assets/a.js'></script>", b"fixture-js"
            manifest = {
                "web_checks": {
                    "/index.html": hashlib.sha256(index).hexdigest(),
                    "/assets/a.js": hashlib.sha256(script).hexdigest(),
                }
            }
            (release / "manifest.json").write_text(json.dumps(manifest))
            (release / "runtime.env").write_text("EVERPLAIN_RUNTIME_MODE=base\n")
            (release / "runtime.env").chmod(0o600)
            controller = deploy.Controller(root)
            requests = []

            def response(request, timeout):
                requests.append(request)
                path = request.full_url.split("?", 1)[0]
                if path.endswith("/api/health"):
                    value = json.dumps(
                        {"release_revision": NEW, "status": "ok", "runtime_mode": "base"}
                    ).encode()
                elif path.endswith("/revision.json"):
                    value = json.dumps({"revision": NEW}).encode()
                else:
                    value = index if path.endswith("/index.html") else script
                return io.BytesIO(value)

            opener = type("Opener", (), {"open": staticmethod(response)})()
            with patch.object(deploy.urllib.request, "build_opener", return_value=opener):
                controller.health(NEW, public=True)
            self.assertTrue(
                any(
                    request.full_url.startswith("https://e.qunxue.xyz/index.html")
                    for request in requests
                )
            )
            self.assertTrue(
                all(request.full_url.endswith("?revision=" + NEW) for request in requests)
            )
            manifest["web_checks"]["/assets/a.js"] = "0" * 64
            (release / "manifest.json").write_text(json.dumps(manifest))
            with (
                patch.object(deploy.urllib.request, "build_opener", return_value=opener),
                patch.object(deploy.time, "sleep"),
                self.assertRaisesRegex(RuntimeError, "frontend checks failed"),
            ):
                controller.health(NEW, public=True)

    def test_redirects_are_never_followed(self):
        with self.assertRaisesRegex(ValueError, "redirected"):
            deploy.NoRedirect().redirect_request(
                None, None, 302, "Found", {}, "https://other.invalid/"
            )

    def test_migration_has_no_production_env_and_preflight_is_offline(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            release = root / "releases" / NEW
            release.mkdir(parents=True)
            (release / "manifest.json").write_text(
                json.dumps({"images": {"api": "sha256:" + "1" * 64}})
            )
            controller = deploy.Controller(root)
            controller.active_database = root / "data/new/everplain.db"
            with patch.object(controller, "command", return_value="") as command:
                controller.app(release, "migrate")
                args = command.call_args.args[0]
                self.assertNotIn("--env-file", args)
                self.assertIn("EVERPLAIN_RUNTIME_MODE=mock", args)
                self.assertEqual(args[args.index("--network") + 1], "none")
                controller.app(release, "preflight")
                args = command.call_args.args[0]
                self.assertIn("--env-file", args)
                self.assertEqual(args[args.index("--network") + 1], "none")


class ActiveConfigurationTests(unittest.TestCase):
    def test_container_data_and_environment_drift_fail_without_mutation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            release = root / "releases" / NEW
            release.mkdir(parents=True)
            (root / "current").symlink_to(release)
            source = root / "data/current/everplain.db"
            database(source)
            images = {"api": "sha256:" + "1" * 64, "web": "sha256:" + "2" * 64}
            (release / "manifest.json").write_text(json.dumps({"images": images}))
            (release / "runtime.env").write_text("EVERPLAIN_TEST=fixture-only\n")
            (release / "runtime.env").chmod(0o600)
            state = {"database": str(source)}
            containers = {}
            for role, host_port, inside in (
                ("api", "8297", "8297/tcp"),
                ("web", "5196", "8080/tcp"),
            ):
                containers[role] = {
                    "Image": images[role],
                    "Config": {
                        "Labels": {
                            "org.everplain.managed": "release-v1",
                            "org.everplain.revision": NEW,
                        },
                        "Env": ["EVERPLAIN_TEST=fixture-only"],
                    },
                    "HostConfig": {
                        "Privileged": False,
                        "PortBindings": {inside: [{"HostIp": "127.0.0.1", "HostPort": host_port}]},
                    },
                    "NetworkSettings": {"Networks": {"everplain-production": {"Aliases": ["api"]}}},
                    "Mounts": [
                        {
                            "Type": "bind",
                            "Destination": "/data",
                            "RW": True,
                            "Source": str(source.parent),
                        }
                    ]
                    if role == "api"
                    else [],
                }
            controller = deploy.Controller(root)

            def inspect(args, purpose):
                self.assertEqual(args[:3], ["/usr/bin/docker", "container", "inspect"])
                return json.dumps([containers[args[-1].removeprefix("everplain-")]])

            with patch.object(controller, "command", side_effect=inspect):
                controller.validate_active(state)
                containers["api"]["Mounts"][0]["Source"] = str(root / "data/wrong")
                with self.assertRaisesRegex(ValueError, "backup source"):
                    controller.validate_active(state)
                containers["api"]["Mounts"][0]["Source"] = str(source.parent)
                containers["api"]["Config"]["Env"] = ["EVERPLAIN_TEST=changed"]
                with self.assertRaisesRegex(ValueError, "private release configuration"):
                    controller.validate_active(state)


class WorkflowSafetyTests(unittest.TestCase):
    def test_pr_builds_real_release_images_without_transport(self):
        checks = (ROOT / ".github/workflows/ci.yml").read_text()
        build = checks.split("  release-build:\n", 1)[1].split("  backend:\n", 1)[0]
        self.assertIn("if: github.event_name == 'pull_request'", build)
        self.assertIn("run: bash ops/cd/build.sh", build)
        self.assertNotIn("transport.sh", build)
        self.assertNotIn("environment:", build)

    def test_pr_checks_do_not_reference_production_secrets(self):
        checks = (ROOT / ".github/workflows/ci.yml").read_text()
        self.assertIn("pull_request:", checks)
        self.assertIn("workflow_call:", checks)
        self.assertNotIn("secrets.", checks)
        self.assertNotIn("pull_request_target", checks)

    def test_deploy_is_main_only_bounded_and_pinned(self):
        workflow = (ROOT / ".github/workflows/deploy.yml").read_text()
        self.assertIn("needs: [checks, build]", workflow)
        self.assertIn("cancel-in-progress: false", workflow)
        self.assertNotIn("rollback-previous", workflow)
        self.assertIn("deploy-existing-ssh.sh all", workflow)
        self.assertNotIn("pull_request", workflow)
        for line in workflow.splitlines():
            if "uses:" in line and "uses: ./" not in line:
                self.assertRegex(line, r"@[0-9a-f]{40}(?:\s|$)")
        transport = (ROOT / "ops/cd/transport.sh").read_text()
        self.assertIn("StrictHostKeyChecking=yes", transport)
        self.assertNotIn("ssh-keyscan", transport)
        self.assertIn("sudo -n /usr/local/lib/everplain/cd/deploy.py", transport)

    def test_regular_releases_do_not_contain_provisioning_or_downgrades(self):
        controller = (ROOT / "ops/cd/deploy.py").read_text()
        for forbidden in (
            "cloudflared",
            "route dns",
            "chmod(0o777)",
            '"downgrade"',
            '"prune"',
            '"down"',
        ):
            self.assertNotIn(forbidden, controller)
        self.assertIn("EVERPLAIN_MIGRATIONS_MANAGED", (ROOT / "ops/start-api.sh").read_text())


if __name__ == "__main__":
    unittest.main()
