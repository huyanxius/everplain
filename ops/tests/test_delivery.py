import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def production_env():
    return {
        "PATH": os.environ.get("PATH", ""),
        "PYTHONPATH": str(ROOT / "backend" / "src"),
        "EVERPLAIN_RUNTIME_MODE": "base",
        "EVERPLAIN_MODEL_BASE_URL": "https://models.example.invalid/v1",
        "EVERPLAIN_MODEL_NAME": "configured-model",
        "EVERPLAIN_MODEL_API_KEY": "opaque-credential-123456789",
        "EVERPLAIN_EMBEDDING_BASE_URL": "https://retrieval.example.invalid/v1",
        "EVERPLAIN_EMBEDDING_MODEL": "Pro/BAAI/bge-m3",
        "EVERPLAIN_EMBEDDING_API_KEY": "opaque-embedding-123456789",
        "EVERPLAIN_RERANKER_BASE_URL": "https://retrieval.example.invalid/v1",
        "EVERPLAIN_RERANKER_MODEL": "Pro/BAAI/bge-reranker-v2-m3",
        "EVERPLAIN_RERANKER_API_KEY": "opaque-reranker-123456789",
        "EVERPLAIN_WEB_SEARCH_API_KEY": "opaque-web-123456789",
        "EVERPLAIN_SESSION_COOKIE_SECURE": "true",
        "EVERPLAIN_CORS_ALLOWED_ORIGINS": '["https://app.example.invalid"]',
        "EVERPLAIN_ACCOUNT_INITIAL_ADMIN_EMAIL": "owner@example.invalid",
        "EVERPLAIN_ACCOUNT_INITIAL_ADMIN_PASSWORD": "opaque-initial-password-12345",
    }


class ProductionPreflightTests(unittest.TestCase):
    def run_preflight(self, env):
        return subprocess.run(
            [sys.executable, str(ROOT / "ops/preflight.py")],
            env=env,
            text=True,
            capture_output=True,
            check=False,
        )

    def test_complete_configuration_passes_and_reports_optional_services_without_secrets(
        self,
    ):
        env = production_env()
        result = self.run_preflight(env)
        self.assertEqual(result.returncode, 0, result.stderr)
        report = json.loads(result.stdout)
        self.assertEqual(report["status"], "configuration_ready")
        self.assertEqual(report["optional_services"]["email"], "not_configured")
        self.assertEqual(report["optional_services"]["transcription"], "not_configured")
        for key, value in env.items():
            if "KEY" in key or "PASSWORD" in key:
                self.assertNotIn(value, result.stdout + result.stderr)

    def test_free_retrieval_configuration_passes_without_weakening_other_checks(self):
        env = production_env()
        env["EVERPLAIN_EMBEDDING_MODEL"] = "BAAI/bge-m3"
        env["EVERPLAIN_RERANKER_MODEL"] = "BAAI/bge-reranker-v2-m3"
        result = self.run_preflight(env)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["status"], "configuration_ready")
        env["EVERPLAIN_EMBEDDING_MODEL"] = "BAAI/bge-small-zh-v1.5"
        rejected = self.run_preflight(env)
        self.assertNotEqual(rejected.returncode, 0)
        self.assertIn("EVERPLAIN_EMBEDDING_MODEL", json.loads(rejected.stdout)["invalid_fields"])

    def test_partial_email_and_template_origin_are_rejected(self):
        env = production_env()
        env["EVERPLAIN_EMAIL_FROM"] = "Everplain <owner@example.invalid>"
        env["EVERPLAIN_CORS_ALLOWED_ORIGINS"] = '["https://your-domain.example"]'
        env["QUNXUE_DATABASE_URL"] = "sqlite:////unused/legacy.db"
        result = self.run_preflight(env)
        self.assertNotEqual(result.returncode, 0)
        fields = json.loads(result.stdout)["invalid_fields"]
        self.assertIn("EVERPLAIN_RESEND_API_KEY", fields)
        self.assertIn("EVERPLAIN_CORS_ALLOWED_ORIGINS", fields)
        self.assertIn("QUNXUE_DATABASE_URL", fields)
        self.assertNotIn("unused/legacy.db", result.stdout + result.stderr)

    def test_mock_and_missing_retrieval_are_rejected(self):
        env = production_env()
        env["EVERPLAIN_RUNTIME_MODE"] = "mock"
        del env["EVERPLAIN_RERANKER_API_KEY"]
        result = self.run_preflight(env)
        self.assertNotEqual(result.returncode, 0)
        report = json.loads(result.stdout)
        self.assertIn("EVERPLAIN_RUNTIME_MODE", report["invalid_fields"])
        self.assertIn("EVERPLAIN_RERANKER_API_KEY", report["invalid_fields"])

    def test_incomplete_optional_service_is_rejected_and_credentials_are_redacted(self):
        env = production_env()
        env["EVERPLAIN_TRANSCRIPTION_API_KEY"] = "private-transcription-token"
        env["EVERPLAIN_MODEL_BASE_URL"] = "http://insecure.example.invalid/v1"
        result = self.run_preflight(env)
        self.assertNotEqual(result.returncode, 0)
        report = json.loads(result.stdout)
        self.assertIn("EVERPLAIN_TRANSCRIPTION_MODEL", report["invalid_fields"])
        self.assertIn("EVERPLAIN_MODEL_BASE_URL", report["invalid_fields"])
        self.assertNotIn("private-transcription-token", result.stdout + result.stderr)


class DatabaseBackupTests(unittest.TestCase):
    def run_command(self, *args):
        return subprocess.run(
            [sys.executable, str(ROOT / "ops/database.py"), *map(str, args)],
            text=True,
            capture_output=True,
            check=False,
        )

    def test_live_wal_backup_restores_private_bytes_and_rejects_overwrite(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "everplain.db"
            backup = Path(directory) / "backup.sqlite3"
            restored = Path(directory) / "restored.db"
            with sqlite3.connect(source) as connection:
                connection.execute("PRAGMA journal_mode=WAL")
                connection.execute(
                    "CREATE TABLE alembic_version(version_num TEXT PRIMARY KEY)"
                )
                connection.execute(
                    "INSERT INTO alembic_version VALUES ('fixture-revision')"
                )
                connection.execute("CREATE TABLE users(user_id TEXT PRIMARY KEY)")
                connection.execute("INSERT INTO users VALUES ('owner')")
                connection.execute(
                    "CREATE TABLE documents(id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(user_id), content BLOB)"
                )
                connection.execute(
                    "INSERT INTO documents VALUES (?, ?, ?)",
                    ("file", "owner", b"private bytes"),
                )
                connection.commit()
                result = self.run_command("backup", source, backup)
                self.assertEqual(result.returncode, 0, result.stderr)
                connection.execute("UPDATE documents SET content = X'00'")
                connection.commit()
            result = self.run_command("restore", backup, restored)
            self.assertEqual(result.returncode, 0, result.stderr)
            with sqlite3.connect(restored) as connection:
                self.assertEqual(
                    connection.execute("SELECT content FROM documents").fetchone()[0],
                    b"private bytes",
                )
            result = self.run_command("restore", backup, restored)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(restored.stat().st_mode & 0o777, 0o600)

    def test_corrupt_or_missing_database_never_creates_a_restore_target(self):
        with tempfile.TemporaryDirectory() as directory:
            corrupt = Path(directory) / "corrupt.sqlite3"
            target = Path(directory) / "restored.db"
            corrupt.write_bytes(b"not a database")
            self.assertNotEqual(
                self.run_command("restore", corrupt, target).returncode, 0
            )
            self.assertFalse(target.exists())
            self.assertNotEqual(
                self.run_command(
                    "backup", Path(directory) / "missing.db", target
                ).returncode,
                0,
            )
            self.assertFalse(target.exists())


class ExplicitModelFallbackTests(ProductionPreflightTests):
    def demo_env(self):
        env = production_env()
        for name in list(env):
            if name.startswith("EVERPLAIN_") and any(part in name for part in (
                "MODEL", "EMBEDDING", "RERANKER", "WEB_SEARCH", "ACCOUNT_INITIAL_ADMIN",
            )):
                del env[name]
        env["EVERPLAIN_ALLOW_MODEL_FALLBACK"] = "true"
        env["EVERPLAIN_RUNTIME_MODE"] = "base"
        return env

    def test_explicit_demo_starts_without_ai_credentials_or_invented_administrator(self):
        result = self.run_preflight(self.demo_env())
        self.assertEqual(result.returncode, 0, result.stderr)
        report = json.loads(result.stdout)
        self.assertEqual(report["status"], "configuration_ready")
        self.assertEqual(report["registration_email"], "not_configured")
        self.assertEqual(report["administrator"], "not_provisioned")

    def test_demo_still_requires_secure_independent_sessions(self):
        env = self.demo_env()
        env["EVERPLAIN_SESSION_COOKIE_SECURE"] = "false"
        result = self.run_preflight(env)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("EVERPLAIN_SESSION_COOKIE_SECURE", json.loads(result.stdout)["invalid_fields"])

    def test_demo_requires_complete_real_email_config_when_supplied(self):
        env = self.demo_env()
        env["EVERPLAIN_EMAIL_FROM"] = "Everplain <hello@example.invalid>"
        result = self.run_preflight(env)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("EVERPLAIN_RESEND_API_KEY", json.loads(result.stdout)["invalid_fields"])




class AdditionalModelPreflightTests(unittest.TestCase):
    run_preflight = ProductionPreflightTests.run_preflight

    def additional_model_env(self):
        env = production_env()
        env["EVERPLAIN_AGENT_PROVIDERS"] = json.dumps({"unigate": {
            "base_url": "https://synthetic.invalid/exact-api", "protocol": "chat_completions",
            "api_key_env": "EVERPLAIN_UNIGATE_API_KEY",
        }})
        env["EVERPLAIN_AGENT_SELECTABLE_MODELS"] = json.dumps([{
            "model_id": "gemini-3.5-flash", "model": "gemini-3.5-flash",
            "label": "Gemini 3.5 Flash", "provider": "unigate",
        }])
        return env

    def test_missing_additional_credentials_and_prices_fail_closed(self):
        result = self.run_preflight(self.additional_model_env())
        self.assertEqual(result.returncode, 1)
        report = json.loads(result.stdout)
        self.assertIn("EVERPLAIN_AGENT_PROVIDER_CREDENTIALS", report["invalid_fields"])
        self.assertIn("EVERPLAIN_BILLING_MODEL_TARIFFS", report["invalid_fields"])
        self.assertEqual(report["provider_connectivity"], "not_checked")

    def test_complete_synthetic_registration_is_configuration_only_and_redacted(self):
        env = self.additional_model_env()
        env.update({
            "EVERPLAIN_UNIGATE_API_KEY": "synthetic-provider-key-never-real",
            "EVERPLAIN_BILLING_PRICE_VERSION": "synthetic-v2",
            "EVERPLAIN_BILLING_CREDITS_PER_USD": "10000",
            "EVERPLAIN_BILLING_MAX_ATTEMPT_USD_MICRO": "100000",
            "EVERPLAIN_BILLING_MAX_OPERATION_USD_MICRO": "100000",
            "EVERPLAIN_BILLING_DAILY_BUDGET_USD_MICRO": "1000000",
            "EVERPLAIN_BILLING_MODEL_TARIFFS": json.dumps({"gemini-3.5-flash": {
                "version": "synthetic-v2", "source": "synthetic-fixture",
                "currency": "USD", "unit": "usd_micro_per_million_tokens",
                "service_tier": "standard", "input": 200, "cache_read": 20,
                "cache_write": 100, "output": 600, "long_threshold": None,
            }}),
        })
        result = self.run_preflight(env)
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        self.assertEqual(json.loads(result.stdout)["provider_connectivity"], "not_checked")
        self.assertNotIn(env["EVERPLAIN_UNIGATE_API_KEY"], result.stdout + result.stderr)
        rates = json.loads(env["EVERPLAIN_BILLING_MODEL_TARIFFS"])
        rates["gemini-3.5-flash"]["version"] = "stale"
        env["EVERPLAIN_BILLING_MODEL_TARIFFS"] = json.dumps(rates)
        result = self.run_preflight(env)
        self.assertEqual(result.returncode, 1)
        self.assertIn("EVERPLAIN_BILLING_MODEL_TARIFFS",
                      json.loads(result.stdout)["invalid_fields"])


if __name__ == "__main__":
    unittest.main()
