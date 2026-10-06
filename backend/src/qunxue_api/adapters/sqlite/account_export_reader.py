"""Query only reviewed columns through explicit ownership paths.

There is no database-schema discovery in the export path, no graph expansion,
no SELECT *, and no blacklist. Schema inspection is isolated to the CI gate.
"""

from sqlalchemy import and_, or_, select

from .account_export_contracts import EXPORTS
from .account_export_json import json_value, project
from .base import Base
from .conversation_summary_repository import SqliteConversationSummaryRepository


def owner_predicate(table_name, user_key):
    contract = EXPORTS[table_name]
    table = Base.metadata.tables[table_name]
    if contract.owner:
        # The row's explicit owner is authoritative. A different user's FK must
        # never grant access, even when the row references this user's parent.
        return table.c[contract.owner] == user_key
    if contract.audit_subject:
        # A deliberate dual-subject exception, not a traversal edge to other users.
        return or_(table.c.actor_user_id == user_key, table.c.target_user_id == user_key)
    if not contract.parents:
        raise ValueError(f"export ownership missing for {table_name}")
    return and_(
        *(
            table.c[parent.column].in_(
                select(Base.metadata.tables[parent.table].c[parent.key]).where(
                    owner_predicate(parent.table, user_key)
                )
            )
            for parent in contract.parents
        )
    )


def project_row(table_name, row):
    contract = EXPORTS.get(table_name)
    if contract is None:
        return {}
    shapes = dict(contract.json_fields)
    output = {}
    for key in contract.fields:
        if key not in row:
            continue
        value = row[key]
        if key in shapes:
            output[key] = project(value, shapes[key])
        elif key in contract.binary_fields:
            output[key] = json_value(value) if isinstance(value, bytes) or value is None else None
        else:
            # Scalar columns must not become an unreviewed JSON channel if a
            # later schema changes their storage type without contract review.
            output[key] = None if isinstance(value, dict | list | tuple) else json_value(value)
    if table_name == "agent_runs":
        request = row.get("request_snapshot")
        visible_message = request.get("message") if isinstance(request, dict) else None
        if isinstance(visible_message, str):
            for item in output.get("tool_summary") or ():
                if item.get("kind") == "deep_research_pending":
                    item["prompt"] = visible_message
        card = request.get("_display_card") if isinstance(request, dict) else None
        if isinstance(card, dict) and all(
            isinstance(card.get(k), str) for k in ("title", "description")
        ):
            output["context_card"] = {key: card[key] for key in ("title", "description")}
    return output


def personal_records(db, user_id):
    user_key = str(user_id)
    users = Base.metadata.tables["users"]
    if db.scalar(select(users.c.user_id).where(users.c.user_id == user_key)) is None:
        raise RuntimeError("account disappeared while exporting")
    records = {}
    for name, contract in sorted(EXPORTS.items()):
        table = Base.metadata.tables[name]
        rows = (
            db.execute(
                select(*(table.c[field] for field in contract.fields))
                .where(owner_predicate(name, user_key))
                .order_by(*(table.c[key] for key in contract.identity))
            )
            .mappings()
            .all()
        )
        if not rows:
            continue
        if name == "agent_conversation_summaries":
            # Validates original source ownership and last-good cache before our
            # own closed JSON projection; do not trust raw/legacy cache structure.
            display = SqliteConversationSummaryRepository(db).read(user_id)
            rows = [
                {
                    "user_id": user_key,
                    "updated_at": display["updated_at"],
                    "summary": {
                        key: display[key]
                        for key in (
                            "summary",
                            "summary_sources",
                            "cards",
                        )
                    },
                }
            ]
        records[name] = [project_row(name, row) for row in rows]
        if name == "account_audit_events":
            for row in records[name]:
                # A target may retain the fact/action of another actor, but not
                # that actor's private session environment or contact address.
                if row.get("actor_user_id") != user_key:
                    row["actor_email"] = None
                    row["ip_address"] = None
                    row["user_agent"] = None
                if row.get("target_user_id") != user_key:
                    row["target_email"] = None
    return records
