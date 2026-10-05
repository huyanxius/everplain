import sqlite3
from pathlib import Path

from alembic import command


def test_dispatch_upgrade_rollback_and_reset_fence_preserve_evidence(plain_client, alembic_config):
    path = plain_client.app.state.database.engine.url.database
    with sqlite3.connect(path) as connection:
        connection.executescript(
            (Path(__file__).parents[1] / "fixtures/billing_reset_schema.sql").read_text()
        )
        protected = connection.execute(
            "SELECT type,name,sql FROM sqlite_master "
            "WHERE name LIKE 'billing_reset%' OR "
            "name='billing_precision_adjustments'"
        ).fetchall()
        connection.execute(
            "INSERT INTO billing_operations(run_id,user_id,fingerprint,status,"
            "hold_points,exempt,price_json,credit_pico,created_at,updated_at) "
            "VALUES ('audit','synthetic','x','error',0,1,'{}','0','x','x')"
        )
        connection.execute(
            "INSERT INTO billing_attempts(attempt_id,run_id,endpoint_id,request_hash,"
            "requested_model,outcome,usage_state,input_limit,output_limit,"
            "reserved_cost_pico,price_json,created_at,updated_at,dispatch_state,"
            "provider_request_id) VALUES ('a','audit','x','x','x','error','unknown',"
            "1,1,123,'{}','x','x','response_received','synthetic-request')"
        )
        before = connection.execute("SELECT * FROM billing_attempts").fetchall()
        operation = connection.execute("SELECT * FROM billing_operations").fetchall()
        connection.commit()
    command.downgrade(alembic_config, "20261004_0550")
    command.upgrade(alembic_config, "20261005_0560")
    with sqlite3.connect(path) as connection:
        assert connection.execute("SELECT * FROM billing_attempts").fetchall() == before
        assert connection.execute("SELECT * FROM billing_operations").fetchall() == operation
        assert (
            connection.execute(
                "SELECT type,name,sql FROM sqlite_master "
                "WHERE name LIKE 'billing_reset%' OR "
                "name='billing_precision_adjustments'"
            ).fetchall()
            == protected
        )
        # Exact old INSERT column contract still works, with conservative defaults.
        connection.execute(
            "INSERT INTO billing_attempts(attempt_id,run_id,endpoint_id,request_hash,"
            "requested_model,outcome,usage_state,input_limit,output_limit,"
            "reserved_cost_pico,price_json,created_at,updated_at) "
            "VALUES ('old-code','audit','x','x','x','error','unknown',1,1,456,'{}','x','x')"
        )
        assert connection.execute(
            "SELECT dispatch_state,provider_request_id FROM billing_attempts "
            "WHERE attempt_id='old-code'"
        ).fetchone() == ("legacy_unknown", None)
