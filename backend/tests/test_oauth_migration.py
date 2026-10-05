"""OAuth migration follows the pending import migration and preserves existing auth/bank rows."""

from pathlib import Path
from uuid import UUID, uuid4

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from fastapi.testclient import TestClient
from sqlalchemy import select, text

from qunxue_api.adapters.sqlite import UserRow, UserSessionRow
from qunxue_api.adapters.sqlite.billing_model import CreditLedgerRow
from qunxue_api.adapters.sqlite.database import Database
from qunxue_api.bootstrap import create_app
from qunxue_api.settings import Settings


def test_upgrade_from_output_head_preserves_accounts_sessions_and_welcome_grants(
    tmp_path: Path,
    monkeypatch,
    alembic_config: Config,
):
    url = f"sqlite:///{tmp_path / 'oauth-upgrade.db'}"
    monkeypatch.setenv("EVERPLAIN_DATABASE_URL", url)
    command.upgrade(alembic_config, "20261005_0610")
    graph = ScriptDirectory.from_config(alembic_config)
    assert graph.get_heads() == ["20261005_0620"]
    assert graph.get_revision("20261005_0620").down_revision == "20261005_0615"
    assert graph.get_revision("20261005_0615").down_revision == "20261005_0610"
    database = Database(url)
    settings = Settings(_env_file=None, database_url=url, runtime_mode="mock")
    app = create_app(settings=settings, database=database, require_email_verification=False)
    try:
        with TestClient(app) as client:
            result = client.post(
                "/api/session/register",
                headers={"Idempotency-Key": str(uuid4())},
                json={"email": "migration@example.com", "password": "migration-passphrase"},
            )
            assert result.status_code == 201
            user_id = result.json()["user"]["user_id"]
            session_id = result.json()["session_id"]
            credential = client.cookies.get(settings.session_cookie_name)
        with database.session() as db:
            user = db.get(UserRow, user_id)
            before = (user.email, user.password_hash, user.role, user.status, user.version)
            assert sum(db.scalars(select(CreditLedgerRow.points))) == 30
            assert (
                db.execute(
                    text("SELECT quota_period_epoch FROM credit_accounts WHERE user_id=:id"),
                    {"id": user_id},
                ).scalar_one()
                is None
            )
        command.upgrade(alembic_config, "head")
        with database.session() as db:
            user = db.get(UserRow, user_id)
            assert (user.email, user.password_hash, user.role, user.status, user.version) == before
            assert db.get(UserSessionRow, session_id).revoked_at is None
            assert sum(db.scalars(select(CreditLedgerRow.points))) == 30
            assert db.execute(text("SELECT COUNT(*) FROM credit_quota_periods")).scalar_one() == 0
            assert db.execute(text("SELECT COUNT(*) FROM federated_identities")).scalar_one() == 0
            assert db.execute(text("SELECT COUNT(*) FROM oauth_transactions")).scalar_one() == 0
        with app.state.identity_service_scope() as service:
            current = service.authenticate(credential)
            assert current.user.user_id == UUID(user_id)
            assert current.session.session_id == UUID(session_id)
    finally:
        database.engine.dispose()
