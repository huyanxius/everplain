"""Separate optional provider contact email from an account's local login method."""

import sqlalchemy as sa
from alembic import op

revision = "20261005_0630"
down_revision = "20261005_0620"
branch_labels = None
depends_on = None


def _migrate_users():
    op.add_column("federated_identities", sa.Column("verified_email", sa.String(320)))
    # The old email proves only the original signup provider's contact. Later
    # explicit bindings must not inherit another provider's verified email.
    op.execute(
        "UPDATE federated_identities SET verified_email = "
        "(SELECT email FROM users WHERE users.user_id = federated_identities.user_id) "
        "WHERE EXISTS (SELECT 1 FROM users WHERE "
        "users.user_id = federated_identities.user_id AND "
        "users.password_hash = '!oauth-only' AND "
        "users.created_at = federated_identities.created_at)"
    )
    with op.batch_alter_table("users", recreate="always") as batch:
        batch.alter_column("email", existing_type=sa.String(320), nullable=True)
        batch.add_column(
            sa.Column("login_mode", sa.String(16), nullable=False, server_default="email_password")
        )
        batch.create_check_constraint(
            "ck_users_login_mode", "login_mode IN ('email_password', 'federated')"
        )
        batch.create_check_constraint(
            "ck_users_login_credentials",
            "(login_mode = 'email_password' AND email IS NOT NULL) OR "
            "(login_mode = 'federated' AND password_hash = '!oauth-only')",
        )
    op.execute(
        "UPDATE users SET email = NULL, login_mode = 'federated' "
        "WHERE password_hash = '!oauth-only' AND EXISTS "
        "(SELECT 1 FROM federated_identities WHERE federated_identities.user_id = users.user_id)"
    )


def _assert_integrity(connection):
    if connection.exec_driver_sql("PRAGMA foreign_key_check").first() is not None:
        raise RuntimeError("Federated account migration found a foreign-key violation")
    if connection.exec_driver_sql("PRAGMA integrity_check").scalar_one() != "ok":
        raise RuntimeError("Federated account migration failed SQLite integrity validation")


def upgrade():
    context = op.get_context()
    if op.get_bind().dialect.name != "sqlite":
        raise RuntimeError("Federated account migration requires the reviewed SQLite release path")
    if context.as_sql:
        raise RuntimeError(
            "Federated account migration requires an online SQLite connection for schema/FK checks"
        )
    connection = op.get_bind()
    with context.autocommit_block():
        if connection.exec_driver_sql("PRAGMA foreign_keys").scalar_one() != 1:
            raise RuntimeError("Federated account migration requires foreign keys enabled at entry")
        _assert_integrity(connection)
        if (
            connection.exec_driver_sql(
                "SELECT 1 FROM sqlite_master WHERE type='trigger' AND tbl_name='users' LIMIT 1"
            ).first()
            is not None
        ):
            raise RuntimeError("Unreviewed users triggers require a separate migration review")
        before_ids = tuple(connection.exec_driver_sql("SELECT user_id FROM users ORDER BY user_id"))
        connection.exec_driver_sql("PRAGMA foreign_keys=OFF")
        try:
            if connection.exec_driver_sql("PRAGMA foreign_keys").scalar_one() != 0:
                raise RuntimeError("Could not safely disable foreign keys for users reconstruction")
            connection.exec_driver_sql("BEGIN IMMEDIATE")
            try:
                _migrate_users()
                after_ids = tuple(
                    connection.exec_driver_sql("SELECT user_id FROM users ORDER BY user_id")
                )
                if after_ids != before_ids:
                    raise RuntimeError("Federated account migration changed account identity")
                _assert_integrity(connection)
                connection.exec_driver_sql("COMMIT")
            except BaseException:
                connection.exec_driver_sql("ROLLBACK")
                raise
        finally:
            connection.exec_driver_sql("PRAGMA foreign_keys=ON")
            if connection.exec_driver_sql("PRAGMA foreign_keys").scalar_one() != 1:
                raise RuntimeError("Could not restore foreign keys after users reconstruction")


def downgrade():
    raise RuntimeError("Federated accounts require restoring a backup to a new database")
