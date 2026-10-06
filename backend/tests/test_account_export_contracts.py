"""Synthetic export boundary tests; no production data is read by this suite."""

from copy import deepcopy
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text
from test_account_management_api import register

from qunxue_api.adapters.sqlite.account_management_repository import SqliteAccountRepository
from qunxue_api.adapters.sqlite.agent_conversation_model import AgentConversationRow, AgentRunRow


def snapshot(client, user_id):
    with client.app.state.database.session() as db:
        return SqliteAccountRepository(db)._personal_snapshot(
            user_id=UUID(user_id),
            exported_at=datetime(2026, 10, 6, tzinfo=UTC),
        )


def test_new_columns_and_user_foreign_keys_do_not_grant_export_access(plain_client):
    user_id = register(plain_client, "export-owner@example.com")["user"]["user_id"]
    with plain_client.app.state.database.engine.begin() as db:
        db.execute(text("ALTER TABLE users ADD COLUMN future_private_material TEXT"))
        db.execute(text("UPDATE users SET future_private_material='synthetic-unreviewed-secret'"))
        db.execute(
            text(
                "CREATE TABLE future_export_secrets (id TEXT PRIMARY KEY, "
                "user_id TEXT REFERENCES users(user_id), material TEXT)"
            )
        )
        db.execute(
            text("INSERT INTO future_export_secrets VALUES ('new', :user, :secret)"),
            {"user": user_id, "secret": "synthetic-new-table-secret"},
        )
    records = snapshot(plain_client, user_id)["records"]
    assert "future_private_material" not in records["users"][0]
    assert "future_export_secrets" not in records
    assert records["users"][0]["email"] == "export-owner@example.com"


def test_direct_owner_wins_over_a_different_users_parent(plain_client):
    first = register(plain_client, "export-first@example.com")["user"]["user_id"]
    second = register(plain_client, "export-second@example.com")["user"]["user_id"]
    now = datetime.now(UTC)
    own, foreign = str(uuid4()), str(uuid4())
    with plain_client.app.state.database.session() as db:
        db.add_all(
            [
                AgentConversationRow(
                    conversation_id=own,
                    user_id=first,
                    title="owned",
                    created_at=now,
                    updated_at=now,
                ),
                AgentConversationRow(
                    conversation_id=foreign,
                    user_id=second,
                    title="foreign",
                    created_at=now,
                    updated_at=now,
                ),
            ]
        )
        db.flush()
        db.add(
            AgentRunRow(
                run_id=str(uuid4()),
                conversation_id=own,
                user_id=second,
                idempotency_key="cross-owner",
                status="completed",
                provider="test",
                model="test",
                started_at=now,
                partial_answer="other user's answer",
            )
        )
    assert not snapshot(plain_client, first)["records"].get("agent_runs")


def test_structured_request_drops_unknown_keys_but_preserves_user_content_and_values():
    original = {
        "request_snapshot": {
            "message": "正文含 password_hash、_execution_prompt 和采购成本，不能被删。",
            "context_suggestion": {"card_id": "", "version": "v0", "future_secret": "hidden"},
            "document_version": 0,
            "web_search": False,
            "model_id": None,
            "material_ids": [],
            "new_runtime_field": {"future_secret": "hidden"},
            "_display_card": {"title": "可见", "description": "", "future_secret": "hidden"},
        },
        "partial_answer": "",
        "future_secret": "hidden column",
    }
    before = deepcopy(original)
    result = SqliteAccountRepository._sanitize_export_row(original, table_name="agent_runs")
    assert result["request_snapshot"] == {
        "message": original["request_snapshot"]["message"],
        "context_suggestion": {"card_id": "", "version": "v0"},
        "document_version": 0,
        "web_search": False,
        "model_id": None,
        "material_ids": [],
    }
    assert result["context_card"] == {"title": "可见", "description": ""}
    assert result["partial_answer"] == ""
    assert "future_secret" not in result
    assert original == before


def test_full_migrated_schema_has_no_unclassified_or_stale_contracts(plain_client):
    from qunxue_api.adapters.sqlite.account_export_schema import validate_export_schema

    validate_export_schema(plain_client.app.state.database.engine)


@pytest.mark.parametrize("mutation", ["column", "table", "rename", "orm"])
def test_schema_gate_rejects_unreviewed_columns_tables_and_stale_contracts(plain_client, mutation):
    from sqlalchemy import Column, String

    from qunxue_api.adapters.sqlite.account_export_schema import validate_export_schema
    from qunxue_api.adapters.sqlite.base import Base

    engine = plain_client.app.state.database.engine
    if mutation == "orm":
        column = Column("new_model_field", String)
        Base.metadata.tables["users"].append_column(column)
        try:
            with pytest.raises(ValueError, match="ORM and migrated schema differ"):
                validate_export_schema(engine)
        finally:
            Base.metadata.tables["users"]._columns.remove(column)
        return
    with engine.begin() as db:
        if mutation == "column":
            db.execute(text("ALTER TABLE users ADD COLUMN unknown_secret TEXT"))
        elif mutation == "table":
            db.execute(
                text("CREATE TABLE future_user_table (user_id TEXT REFERENCES users(user_id))")
            )
        else:
            db.execute(text("ALTER TABLE users RENAME COLUMN display_name TO renamed_name"))
    with pytest.raises(ValueError, match="unclassified|stale"):
        validate_export_schema(engine)


def test_personal_model_evidence_preserves_arbitrary_historical_user_keys():
    row = {
        "input_evidence": {"private": "personal input", "自定义证据": {"zero": 0, "empty": []}},
        "output": {"private": "personal output", "password_hash": "user-authored literal key"},
        "future_server_column": "must not pass through",
    }
    before = deepcopy(row)
    result = SqliteAccountRepository._sanitize_export_row(row, table_name="model_invocations")
    assert result == {key: row[key] for key in ("input_evidence", "output")}
    assert before == row


def test_gateway_produces_personal_evidence_without_execution_or_procurement_envelopes():
    import json

    from test_model_gateway import NOW, _batch_input, _ids, _model_inputs

    from qunxue_api.adapters.model import (
        BuiltInCaseCatalog,
        InMemoryModelInvocationRecorder,
        ModelGateway,
        create_deterministic_mock_provider,
    )

    catalog = BuiltInCaseCatalog.default()
    example = catalog.get("success")
    recorder = InMemoryModelInvocationRecorder()
    provider = create_deterministic_mock_provider(catalog=catalog)
    gateway = ModelGateway(
        provider=provider,
        recorder=recorder,
        id_factory=_ids(),
        clock=lambda: NOW,
        contract_version="test",
    )
    judgement, draft, framework = _model_inputs(example.phenomenon)
    gateway.build(
        task_id=UUID(int=200),
        raw_input=example.phenomenon,
        research_intent=example.research_intent,
        context=example.context,
    )
    gateway.judge_and_rerank(input=_batch_input(judgement))
    gateway.draft(input=draft)
    gateway.audit(framework=framework)
    records = recorder.list_all()
    assert len(records) == 4
    for record in records:
        payload = {"input_evidence": record.input_evidence, "output": record.output}
        result = SqliteAccountRepository._sanitize_export_row(
            payload, table_name="model_invocations"
        )
        assert result == payload
        serialized = json.dumps(payload, ensure_ascii=False)
        for key in (
            "_execution_prompt",
            "_context_suggestion",
            "procurement_cost_pico",
            "procurement_estimate_ratio",
            "Authorization",
            "provider_response_id",
        ):
            assert key not in serialized
    assert records[0].input_evidence["raw_input_length"] == len(example.phenomenon)
    assert records[0].output["phenomenon"] == example.phenomenon


@pytest.mark.parametrize("content", [b"", b"\x00\xff\x10\x00"])
def test_binary_encoding_empty_values_unicode_and_null_are_stable(content):
    import base64

    row = {
        "id": "stable",
        "content": content,
        "size_bytes": len(content),
        "filename": "零、空与Unicode.txt",
        "knowledge": None,
        "warnings": [],
        "future_secret": "no",
    }
    result = SqliteAccountRepository._sanitize_export_row(row, table_name="shared_documents")
    assert result == {
        "id": "stable",
        "content": {"encoding": "base64", "base64": base64.b64encode(content).decode("ascii")},
        "size_bytes": len(content),
        "filename": "零、空与Unicode.txt",
        "knowledge": None,
        "warnings": [],
    }
    assert base64.b64decode(result["content"]["base64"]) == content


def test_multiple_foreign_keys_require_declared_parents_without_expanding_other_users(plain_client):
    from qunxue_api.adapters.sqlite.shared_knowledge import (
        SharedDocumentRow,
        SharedKnowledgeBaseRow,
        SharedKnowledgeDocumentRow,
        SharedKnowledgeSubscriptionRow,
    )

    first = register(plain_client, "parent-first@example.com")["user"]["user_id"]
    second = register(plain_client, "parent-second@example.com")["user"]["user_id"]
    now = datetime.now(UTC)
    own_library, own_doc, other_doc = (str(uuid4()) for _ in range(3))
    with plain_client.app.state.database.session() as db:
        db.add(
            SharedKnowledgeBaseRow(
                id=own_library,
                owner_user_id=first,
                request_key="lib",
                name="mine",
                description="",
                share_token="synthetic-capability",
                sharing_enabled=False,
                created_at=now,
                updated_at=now,
            )
        )
        for key, owner in ((own_doc, first), (other_doc, second)):
            db.add(
                SharedDocumentRow(
                    id=key,
                    owner_user_id=owner,
                    request_key=key,
                    filename="mine" if owner == first else "other private document",
                    media_type="text/plain",
                    content_hash=key,
                    content=b"\x00\xff",
                    size_bytes=2,
                    parse_id=str(uuid4()),
                    status="ready",
                    segments=[],
                    vectors={},
                    warnings=[],
                    created_at=now,
                )
            )
        db.flush()
        db.add_all(
            [
                SharedKnowledgeDocumentRow(knowledge_base_id=own_library, document_id=own_doc),
                SharedKnowledgeDocumentRow(knowledge_base_id=own_library, document_id=other_doc),
                SharedKnowledgeSubscriptionRow(user_id=second, knowledge_base_id=own_library),
            ]
        )
    records = snapshot(plain_client, first)["records"]
    assert [row["id"] for row in records["shared_documents"]] == [own_doc]
    assert records["shared_knowledge_documents"] == [
        {"knowledge_base_id": own_library, "document_id": own_doc}
    ]
    assert not records.get("shared_knowledge_subscriptions")
    assert "share_token" not in records["shared_knowledge_bases"][0]
    assert [row["user_id"] for row in records["users"]] == [first]


def test_explicit_indirect_parent_chain_retains_only_owned_messages(plain_client):
    from qunxue_api.adapters.sqlite.agent_conversation_model import AgentMessageRow

    first = register(plain_client, "chain-first@example.com")["user"]["user_id"]
    second = register(plain_client, "chain-second@example.com")["user"]["user_id"]
    now = datetime.now(UTC)
    with plain_client.app.state.database.session() as db:
        for owner in (first, second):
            conversation = str(uuid4())
            db.add(
                AgentConversationRow(
                    conversation_id=conversation,
                    user_id=owner,
                    title=owner,
                    created_at=now,
                    updated_at=now,
                )
            )
            db.flush()
            db.add(
                AgentMessageRow(
                    message_id=str(uuid4()),
                    conversation_id=conversation,
                    turn_id=str(uuid4()),
                    role="user",
                    content=owner,
                    citations=[],
                    sequence=0,
                    created_at=now,
                )
            )
    assert [
        row["content"] for row in snapshot(plain_client, first)["records"]["agent_messages"]
    ] == [first]


def test_saved_exports_remain_immutable_and_downloads_owner_scoped(plain_client):
    from qunxue_api.adapters.sqlite.account_management_model import PersonalDataExportRow
    from qunxue_api.adapters.sqlite.identity_model import UserRow

    first = register(plain_client, "archive-first@example.com")["user"]["user_id"]
    old_id = str(uuid4())
    old_payload = {"format_version": "legacy", "records": {"legacy": [{"body": "原文"}]}}
    with plain_client.app.state.database.session() as db:
        db.add(
            PersonalDataExportRow(
                export_id=old_id,
                user_id=first,
                status="ready",
                format="json",
                payload=deepcopy(old_payload),
                created_at=datetime.now(UTC),
                expires_at=datetime.now(UTC) + timedelta(days=1),
            )
        )
    key = str(uuid4())
    created = plain_client.post(
        "/api/account/data-exports", headers={"Idempotency-Key": key}, json={"format": "json"}
    )
    assert created.status_code == 201
    first_body = plain_client.get(created.json()["download_href"]).content
    with plain_client.app.state.database.session() as db:
        db.get(UserRow, first).display_name = "changed after export"
    replay = plain_client.post(
        "/api/account/data-exports", headers={"Idempotency-Key": key}, json={"format": "json"}
    )
    assert replay.json()["export_id"] == created.json()["export_id"]
    assert plain_client.get(created.json()["download_href"]).content == first_body
    old_url = f"/api/account/data-exports/{old_id}/download"
    assert plain_client.get(old_url).json() == old_payload
    register(plain_client, "archive-second@example.com")
    assert plain_client.get(old_url).status_code == 404
    assert plain_client.get(created.json()["download_href"]).status_code == 404
    with plain_client.app.state.database.session() as db:
        assert db.get(PersonalDataExportRow, old_id).payload == old_payload


@pytest.mark.parametrize("bad", ["wrong type", ["wrong type"], 0, False])
def test_malformed_structured_json_is_closed_without_modifying_history(bad):
    original = {"request_snapshot": bad, "partial_answer": "仍然保留的正文"}
    before = deepcopy(original)
    result = SqliteAccountRepository._sanitize_export_row(original, table_name="agent_runs")
    assert result == {"request_snapshot": {}, "partial_answer": "仍然保留的正文"}
    assert original == before


def test_account_export_never_includes_raw_billing_procurement(plain_client):
    import json

    from test_account_billing_privacy_api import (
        test_customer_receipts_keep_usage_and_reference_prices_without_procurement as seed_receipt,
    )

    seed_receipt(plain_client, retail=True, api_type="chat_completions", procurement_cost=1234567)
    created = plain_client.post(
        "/api/account/data-exports",
        headers={"Idempotency-Key": str(uuid4())},
        json={"format": "json"},
    )
    assert created.status_code == 201
    records = plain_client.get(created.json()["download_href"]).json()["records"]
    assert records["credit_ledger"]
    for table in ("billing_operations", "billing_attempts", "billing_precision"):
        assert table not in records
    serialized = json.dumps(records)
    for value in (
        "procurement_cost_pico",
        "procurement_estimate_ratio",
        "private-provider",
        "private-procurement",
        "vendor_invoice",
        "private-tariff",
        "private-endpoint",
    ):
        assert value not in serialized


def test_audit_actor_or_target_is_intentional_and_never_exports_another_account(plain_client):
    first = register(plain_client, "audit-first@example.com")["user"]["user_id"]
    second = register(plain_client, "audit-second@example.com")["user"]["user_id"]
    with plain_client.app.state.database.session() as db:
        repository = SqliteAccountRepository(db)
        repository.add_audit_event(
            actor_user_id=UUID(second),
            target_user_id=UUID(first),
            action="target-visible",
            outcome="succeeded",
            details={"reason": "authorized action", "future_private": "hidden"},
            now=datetime.now(UTC),
            ip_address="other-ip",
            user_agent="other-ua",
        )
        repository.add_audit_event(
            actor_user_id=UUID(first),
            target_user_id=UUID(second),
            action="actor-visible",
            outcome="succeeded",
            details={},
            now=datetime.now(UTC),
        )
    records = snapshot(plain_client, first)["records"]
    target = next(
        row for row in records["account_audit_events"] if row["action"] == "target-visible"
    )
    actor = next(row for row in records["account_audit_events"] if row["action"] == "actor-visible")
    assert target["details"] == {"reason": "authorized action"}
    assert target["actor_user_id"] == second
    assert target["actor_email"] is target["ip_address"] is target["user_agent"] is None
    assert actor["target_email"] is None
    assert [row["user_id"] for row in records["users"]] == [first]
    assert all(row["user_id"] == first for row in records["user_sessions"])
    assert records == snapshot(plain_client, first)["records"]


def test_export_sql_selects_only_reviewed_columns_without_schema_discovery(plain_client):
    from sqlalchemy import event

    user_id = register(plain_client, "query-owner@example.com")["user"]["user_id"]
    queries = []

    def observe(_connection, _cursor, statement, _parameters, _context, _executemany):
        queries.append(statement)

    engine = plain_client.app.state.database.engine
    event.listen(engine, "before_cursor_execute", observe)
    try:
        snapshot(plain_client, user_id)
    finally:
        event.remove(engine, "before_cursor_execute", observe)
    assert queries
    normalized = [query.upper() for query in queries]
    assert not any("PRAGMA" in query or "SQLITE_MASTER" in query for query in normalized)
    assert not any("SELECT *" in query or "PASSWORD_HASH" in query for query in normalized)


def test_public_request_card_knowledge_and_profile_fields_remain_portable():
    from qunxue_api.adapters.sqlite import account_export_json as shapes
    from qunxue_api.api.contracts.agent import AgentCitationResponse, AgentTurnRequest
    from qunxue_api.api.contracts.agent_profile import Questionnaire
    from qunxue_api.api.contracts.shared_knowledge import (
        CourseKnowledgeResponse,
        CourseRelationResponse,
        CourseTopicResponse,
    )

    assert set(AgentTurnRequest.model_fields) <= set(shapes.RUN_REQUEST)
    assert set(AgentCitationResponse.model_fields) <= set(shapes.CITATION)
    assert set(Questionnaire.model_fields) <= set(shapes.QUESTIONNAIRE)
    assert set(CourseKnowledgeResponse.model_fields) <= set(shapes.DOCUMENT_KNOWLEDGE)
    assert set(CourseTopicResponse.model_fields) <= set(shapes.DOCUMENT_KNOWLEDGE["topics"].item)
    assert set(CourseRelationResponse.model_fields) <= set(
        shapes.DOCUMENT_KNOWLEDGE["relations"].item
    )
    knowledge = {
        "summary": "用户知识摘要",
        "topics": [{"title": "题目", "summary": "正文", "segment_ids": ["s0"]}],
        "relations": [
            {"source": "A", "target": "B", "label": "用户编辑关系", "segment_ids": ["s0"]}
        ],
    }
    row = {"knowledge": knowledge}
    assert SqliteAccountRepository._sanitize_export_row(row, table_name="shared_documents") == row


def test_theory_and_exchange_structures_keep_known_content_but_drop_unknown_keys():
    from qunxue_api.adapters.sqlite.account_export_json import (
        LOSS_REPORT,
        THEORY_CONTENT,
        project,
    )

    content = {
        "title": "个人理论",
        "reviewed_profile_theory_id": "profile-id",
        "core_claims": ["用户论点"],
        "new_private_field": {"secret": "no"},
    }
    assert project(content, THEORY_CONTENT) == {
        "title": "个人理论",
        "reviewed_profile_theory_id": "profile-id",
        "core_claims": ["用户论点"],
    }
    report = {
        "format": "REFI-QDA Project",
        "specification_version": "1.0",
        "validation_scope": "official-xsd",
        "losses": [
            {
                "object_type": "source",
                "object_id": "0",
                "field": "note",
                "reason": "empty",
                "disposition": "kept",
                "severity": "info",
            }
        ],
        "identities": [{"object_type": "source", "native_id": "0", "exchange_guid": "id"}],
    }
    assert project(report, LOSS_REPORT) == report


def test_bibliographic_user_content_keeps_csl_extensions_and_custom_keys():
    from qunxue_api.modules.research_materials.professional import LiteratureEntry

    csl = {
        "type": "article-journal",
        "title": "个人导入书目",
        "original-date": {"date-parts": [[1999, 1, 2]]},
        "event-date": {"date-parts": [[2026, 10, 6]]},
        "container-author": [{"family": "张", "given": "零"}],
        "custom-user-field": {"_execution_prompt": "用户原文里的同名键", "zero": 0},
    }
    value = LiteratureEntry.create(
        user_id=uuid4(),
        task_id=uuid4(),
        item_type=csl["type"],
        title=csl["title"],
        csl_data=deepcopy(csl),
        now=datetime.now(UTC),
    )
    row = {"csl_data": value.csl_data, "unknown_server_column": "hidden"}
    assert SqliteAccountRepository._sanitize_export_row(
        row,
        table_name="research_literature_entries",
    ) == {"csl_data": csl}


def test_transcript_structure_preserves_provenance_without_opening_unknown_metadata():
    structure = {
        "kind": "transcript",
        "source": "manual",
        "source_format": "srt",
        "provider": None,
        "created_from_version_id": "prior-version",
    }
    row = {"structured_document": structure | {"future_server_metadata": {"token": "hidden"}}}
    before = deepcopy(row)
    assert SqliteAccountRepository._sanitize_export_row(
        row,
        table_name="research_material_parse_versions",
    ) == {"structured_document": structure}
    assert row == before


def test_real_research_map_producer_retains_nodes_relations_and_reviewed_suggestions():
    from test_research_map_tool import _Catalog, _patch

    from qunxue_api.adapters.research_agent.catalog_tools import KnowledgeToolRegistry
    from qunxue_api.modules.agent_conversation.research_map import patches_from_tool_summary

    registry = KnowledgeToolRegistry(_Catalog())
    registry.enable_research_map()
    value = _patch()
    initial = registry.update_research_map(nodes=value["nodes"], relations=value["relations"])
    protected = {**value["nodes"][1], "user_edited": True, "user_edit_version": 4}
    registry.enable_research_map({"nodes": [protected], "relations": []})
    reviewed = registry.update_research_map(nodes=[{**protected, "status": "challenged"}])
    suggestion = registry.update_research_map(nodes=[{**protected, "title": "建议的新标题"}])
    for patch in (initial, reviewed, suggestion):
        patch["map_title"] = "用户研究图"
        summary = {
            "tool": "update_research_map",
            "phase": "finished",
            "call_id": "0",
            "output": patch,
        }
        row = {"tool_summary": [summary]}
        result = SqliteAccountRepository._sanitize_export_row(row, table_name="agent_runs")
        assert result == row
        assert patches_from_tool_summary(result["tool_summary"]) == (patch,)
        contaminated = deepcopy(row)
        contaminated["tool_summary"][0]["output"]["future_secret"] = {"secret": "hidden"}
        for node in contaminated["tool_summary"][0]["output"].get("nodes", []):
            node["future_secret"] = "hidden"
        assert (
            SqliteAccountRepository._sanitize_export_row(
                contaminated,
                table_name="agent_runs",
            )
            == result
        )


def test_real_bounded_search_trace_preserves_items_and_nested_directory_entries():
    from qunxue_api.adapters.research_agent.pydantic_runner import _trace_items

    source = [
        {
            "title": "目录",
            "entry_count": 1,
            "entries": [
                {
                    "title": "用户资料",
                    "excerpt": "正文中的 _execution_prompt",
                    "material_id": "m",
                    "source_id": "s",
                    "url": "https://example.com",
                    "verification_status": "verified",
                }
            ],
        }
    ]
    public = _trace_items(source)
    summary = {
        "tool": "search_knowledge",
        "phase": "finished",
        "call_id": "0",
        "input": {"query": "用户检索"},
        "output": {"result_count": 1, "items": public},
    }
    row = {"tool_summary": [summary]}
    assert SqliteAccountRepository._sanitize_export_row(row, table_name="agent_runs") == row
    contaminated = deepcopy(row)
    contaminated["tool_summary"][0]["output"]["items"][0]["entries"][0]["future_secret"] = "hidden"
    assert (
        SqliteAccountRepository._sanitize_export_row(contaminated, table_name="agent_runs") == row
    )


def test_pending_research_preserves_visible_plan_and_replaces_private_execution_prompt():
    pending = {
        "kind": "deep_research_pending",
        "version": 1,
        "state": "awaiting_clarification",
        "prompt": "synthetic private execution context",
        "title": "公开方案",
        "steps": ["查证"],
        "question": "比较哪个方面？",
        "options": ["A", "B"],
        "selected_intent": "A",
        "future_secret": "hidden",
    }
    row = {
        "request_snapshot": {"message": "可见研究要求", "_execution_prompt": pending["prompt"]},
        "tool_summary": [pending],
    }
    before = deepcopy(row)
    result = SqliteAccountRepository._sanitize_export_row(row, table_name="agent_runs")
    assert result == {
        "request_snapshot": {"message": "可见研究要求"},
        "tool_summary": [
            {
                key: "可见研究要求" if key == "prompt" else value
                for key, value in pending.items()
                if key != "future_secret"
            }
        ],
    }
    assert row == before


def test_real_deep_research_completion_card_is_portable():
    import time

    from qunxue_api.application.disciplinary_agent import _deep_research_summary
    from qunxue_api.modules.agent_conversation import AgentRunResult

    result = AgentRunResult(
        answer="个人研究结论", citations=(), release_id="test", provider="test", model="test"
    )
    summary = list(_deep_research_summary(result, time.monotonic() - 3))
    assert SqliteAccountRepository._sanitize_export_row(
        {"tool_summary": summary},
        table_name="agent_runs",
    ) == {"tool_summary": summary}


def test_literal_public_tool_event_fields_require_export_contract_review():
    import ast
    from pathlib import Path

    from qunxue_api.adapters.sqlite.account_export_json import TOOL_CONTRACTS

    source = Path(__file__).parents[1] / "src/qunxue_api"
    seen = 0
    producers = {
        source / "application/disciplinary_agent.py",
        *(source / "adapters/research_agent").rglob("*.py"),
    }
    # Discover moved events globally, but require an explicitly reviewed producer scope.
    for filename in source.rglob("*.py"):
        module = ast.parse(filename.read_text())
        for call in ast.walk(module):
            if not (
                isinstance(call, ast.Call)
                and isinstance(call.func, ast.Name)
                and call.func.id == "AgentToolEvent"
            ):
                continue
            arguments = {item.arg: item.value for item in call.keywords}
            tool, output = arguments.get("tool"), arguments.get("output")
            if isinstance(tool, ast.Constant) and isinstance(output, ast.Dict):
                assert filename in producers, ("Unregistered event producer", filename)
                seen += 1
                assert tool.value in TOOL_CONTRACTS, tool.value
                keys = {key.value for key in output.keys if isinstance(key, ast.Constant)}
                assert keys <= set(TOOL_CONTRACTS[tool.value][1]), (tool.value, keys)
    assert seen >= 19


@pytest.mark.parametrize("producer", ["evidence.py", "memory.py", "research.py"])
def test_moved_public_event_producer_still_rejects_unreviewed_output(producer, monkeypatch):
    from pathlib import Path

    original_read = Path.read_text
    target = (
        Path(__file__).parents[1]
        / "src/qunxue_api/adapters/research_agent/tool_bindings" / producer
    )

    def read(path, *args, **kwargs):
        content = original_read(path, *args, **kwargs)
        if path == target:
            # A synthetic extra literal event must be reviewed just like the moved real events.
            content += '\nAgentToolEvent(tool="read_sources", output={"unreviewed_field": []})\n'
        return content

    monkeypatch.setattr(Path, "read_text", read)
    with pytest.raises(AssertionError, match="unreviewed_field"):
        test_literal_public_tool_event_fields_require_export_contract_review()


def test_new_public_event_producer_requires_explicit_scope_review(monkeypatch):
    from pathlib import Path

    source = Path(__file__).parents[1] / "src/qunxue_api"
    added = source / "application/unreviewed_event_producer.py"
    original_glob, original_read = Path.rglob, Path.read_text

    def glob(path, pattern):
        yield from original_glob(path, pattern)
        if path == source:
            yield added

    def read(path, *args, **kwargs):
        if path == added:
            return 'AgentToolEvent(tool="read_sources", output={"items": []})'
        return original_read(path, *args, **kwargs)

    monkeypatch.setattr(Path, "rglob", glob)
    monkeypatch.setattr(Path, "read_text", read)
    with pytest.raises(AssertionError, match="Unregistered event producer"):
        test_literal_public_tool_event_fields_require_export_contract_review()
