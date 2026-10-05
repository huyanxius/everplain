"""Read-only current summary estimate. Never prints source text, IDs or secrets.

Uses the deployed source/schema and existing context estimator. No app bootstrap,
model request, migration, write, budget release, or billing change is performed.
"""

import argparse
import json
import sqlite3
from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID


def estimate(sources, omitted_messages=0):
    from qunxue_api.adapters.research_agent.conversation_summarizer import (
        _INSTRUCTIONS,
        ActivitySummary,
    )
    from qunxue_api.adapters.research_agent.pydantic_runner import (
        _responses_input_token_estimate,
    )

    serialized = json.dumps(
        {"instructions": _INSTRUCTIONS, "sources": sources,
         "omitted_messages": omitted_messages,
         "output_schema": ActivitySummary.model_json_schema()},
        ensure_ascii=False,
    )
    return _responses_input_token_estimate(serialized) + 1800


def inspect(database, *, daily_calls=8, daily_tokens=64000, now=None):
    from qunxue_api.adapters.sqlite.agent_memory_model import MemoryUsageRow
    from qunxue_api.adapters.sqlite.conversation_summary_repository import (
        SqliteConversationSummaryRepository,
    )
    from qunxue_api.adapters.sqlite.identity_model import UserRow
    from sqlalchemy import create_engine, select
    from sqlalchemy.orm import Session
    from sqlalchemy.pool import NullPool

    database = Path(database).resolve()
    if not database.is_file():
        raise ValueError("database_missing")
    engine = create_engine("sqlite://", poolclass=NullPool, creator=lambda: sqlite3.connect(
        database.as_uri() + "?mode=ro", uri=True, timeout=30,
    ))
    try:
        with engine.connect() as connection:
            connection.exec_driver_sql("PRAGMA query_only=ON")
            with Session(bind=connection, autoflush=False) as session:
                owners = session.scalars(select(UserRow.user_id).where(
                    UserRow.role == "admin", UserRow.status == "active",
                )).all()
                if len(owners) != 1:
                    raise ValueError("exactly_one_active_admin_required")
                snapshot = SqliteConversationSummaryRepository(session).snapshot(UUID(owners[0]))
                if snapshot is None or not snapshot[1]:
                    raise ValueError("summary_source_unavailable")
                reserved = estimate(snapshot[1], snapshot[3])
                day = (now or datetime.now(UTC)).date().isoformat()
                usage = session.get(MemoryUsageRow, (owners[0], day))
                calls, used = (usage.calls, usage.budget_tokens) if usage else (0, 0)
                return {
                    "reservation_kind": "context_estimate",
                    "reservation_tokens": reserved,
                    "available_tokens": max(0, daily_tokens - used),
                    "within_token_budget": used + reserved <= daily_tokens,
                    "within_call_budget": calls < daily_calls,
                    "source_messages": len(snapshot[1]),
                    "omitted_messages": snapshot[3],
                    "provider_called": False,
                    "database_changed": False,
                }
    finally:
        engine.dispose()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--database", required=True)
    parser.add_argument("--daily-calls", type=int, default=8)
    parser.add_argument("--daily-tokens", type=int, default=64000)
    args = parser.parse_args()
    try:
        result = inspect(args.database, daily_calls=args.daily_calls, daily_tokens=args.daily_tokens)
    except Exception:  # noqa: BLE001 - redact all storage/provider-local exception text
        print(json.dumps({"status": "refused_read_only_inspection"}))
        return 1
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
