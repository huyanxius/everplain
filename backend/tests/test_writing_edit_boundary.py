"""The live editing use case has no history-sized reads or adapter-owned rules."""

import json
from hashlib import sha256
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from sqlalchemy import event, select, update
from test_research_material_api import _authenticate
from test_writing import doc
from test_writing_agent_tools import bind

from qunxue_api.adapters.research_agent.writing_tools import WritingAgentTools
from qunxue_api.adapters.sqlite.writing import (
    SqliteWritingRepository,
    WritingOperationRow,
    WritingRevisionRow,
)
from qunxue_api.application.writing import WritingApplication
from qunxue_api.modules.writing import (
    EditTargetConflict,
    WritingConflict,
    WritingUnsafeOutput,
    resolve_edit_target,
)


def test_target_is_shared_and_resolves_only_within_utf16_scope():
    target = resolve_edit_target("😀重复。重复。", "重复。", scope={"start": 5, "end": 8})
    assert (target.start, target.end, target.scope_start, target.scope_end) == (5, 8, 5, 8)
    assert target.replace("新文") == "😀重复。新文"
    assert target == resolve_edit_target("😀重复。重复。", "重复。", 5, 8,
                                         scope={"start": 5, "end": 8})
    with pytest.raises(EditTargetConflict, match="唯一"):
        resolve_edit_target("aaaa", "aaa")
    with pytest.raises(ValueError, match="拆开"):
        resolve_edit_target("😀文字", "", 1, 1)
    with pytest.raises(EditTargetConflict, match="超出"):
        resolve_edit_target("😀重复。重复。", "重复。", 2, 5, scope={"start": 5, "end": 8})
    assert resolve_edit_target("😀文字", "", 2, 2).replace("新") == "😀新文字"
    with pytest.raises(KeyError):  # An empty malformed scope is never the whole document.
        resolve_edit_target("原文", "原文", scope={})


def test_agent_adapter_requires_only_public_use_cases():
    """A working adapter needs no repository, SQL concepts, or target parser."""
    calls = []

    class UseCases:
        def validate_agent_context(self, user_id, context):
            calls.append("validate")

        def read_agent_document(self, user_id, context):
            return {"version": 1, "markdown": "原文", "pending_revision_ids": []}

        def preview_edit_target(self, *args, **kwargs):
            calls.append("preview")
            return {"safe_replacement_text": "改写"}

        def propose_agent_edit(self, *args, **kwargs):
            calls.append("propose")
            revision = {"revision_id": "new"}
            kwargs["creation_observer"](revision)
            return revision

    tools = WritingAgentTools(UseCases())
    tools.bind(user_id=uuid4(), agent_run_id=uuid4(),
               context={"document_id": str(uuid4()), "document_version": 1})
    tools.read_document()
    payload = {"expected_version": 1, "original_text": "原文", "replacement_text": "改写"}
    assert tools.preview_target(payload, "改写", True)["safe_replacement_text"] == "改写"
    assert tools.propose_edit(**payload) == {"revision_id": "new"}
    assert tools.created_revision_ids == {"new"}
    assert calls == ["validate", "preview", "propose"]
    source = Path(__file__).parents[1] / "src/qunxue_api/adapters/research_agent/writing_tools.py"
    assert ".repository" not in source.read_text()


def test_selected_implicit_and_explicit_retries_keep_legacy_operation_key(plain_client):
    c = plain_client
    user_id = UUID(_authenticate(c)["user"]["user_id"])
    document = doc(c, "😀重复。重复。")
    with c.app.state.disciplinary_agent_scope() as application:
        tools = bind(application, user_id, document, selection_start=5, selection_end=8)
        tools.read_writing_document()
        request = {"expected_version": 1, "original_text": "重复。", "replacement_text": "第二处。",
                   "selection_start": 5, "selection_end": 8}
        # This is the exact pre-refactor key format, independent of the new helper.
        legacy_digest = sha256(json.dumps(request, sort_keys=True).encode()).hexdigest()
        legacy_key = f"agent-writing:{tools._writing.run_id}:{legacy_digest}"
        writing = tools._writing.application
        prior = writing.propose_edit(user_id, document["document_id"], legacy_key, request,
                                     selection_scope={"start": 5, "end": 8})
        assert tools.propose_writing_edit(**request) == prior
        implicit = {key: value for key, value in request.items()
                    if not key.startswith("selection_")}
        assert tools.propose_writing_edit(**implicit) == prior
        with c.app.state.database.session() as session:
            operations = list(session.scalars(select(WritingOperationRow).where(
                WritingOperationRow.request_key.like("agent-writing:%"),
            )))
            assert [op.request_key for op in operations] == [legacy_key]
        # Accepting the proposal changes the document; exact explicit replay must
        # still resolve the old operation rather than revalidate its old text.
        with c.app.state.database.session() as session:
            SqliteWritingRepository(session).resolve(
                user_id, document["document_id"], prior["revision_id"], "accept", 1,
            )
        assert tools.propose_writing_edit(**request) == prior
        with pytest.raises(WritingConflict):
            tools.writing_preview_target(request, request["replacement_text"], True, revision=prior)


@pytest.mark.parametrize("history_count", [0, 40])
def test_live_reads_have_constant_query_count_and_no_history_bodies(plain_client, history_count):
    c = plain_client
    user_id = UUID(_authenticate(c)["user"]["user_id"])
    document = doc(c, "原文" + "a" * 4000)
    database = c.app.state.database
    with database.session() as session:
        repository = SqliteWritingRepository(session)
        for _ in range(history_count):
            revision = repository.add_revision(user_id, document, action="rewrite",
                                               after_markdown="b" * 4000, warnings=[])
            session.execute(update(WritingRevisionRow).where(
                WritingRevisionRow.revision_id == revision["revision_id"],
            ).values(status="rejected"))
    statements = []

    def record(_connection, _cursor, statement, _parameters, _context, _many):
        if statement.lstrip().upper().startswith("SELECT"):
            statements.append(statement)

    with database.session() as session:
        app = WritingApplication(SqliteWritingRepository(session))
        event.listen(database.engine, "before_cursor_execute", record)
        try:
            context = {"document_id": document["document_id"], "document_version": 1}
            app.read_agent_document(user_id, context)
            assert len(statements) == 3
            statements.clear()
            for _ in range(5):
                app.preview_edit_target(user_id, document["document_id"],
                                        {"expected_version": 1, "original_text": "原文"},
                                        "新文", True)
            assert len(statements) == 15
            assert all("writing_revisions.before_markdown" not in sql for sql in statements)
            assert all("writing_revisions.after_markdown" not in sql for sql in statements)
        finally:
            event.remove(database.engine, "before_cursor_execute", record)


@pytest.mark.parametrize("mutation", ["reject", "body", "scope"])
def test_ready_proof_reads_fresh_exact_revision_even_with_cached_orm(plain_client, mutation):
    c = plain_client
    user_id = UUID(_authenticate(c)["user"]["user_id"])
    document = doc(c, "原文")
    request = {"expected_version": 1, "original_text": "原文", "replacement_text": "修订",
               "selection_start": 0, "selection_end": 2}
    database = c.app.state.database
    with database.session() as session:
        repository = SqliteWritingRepository(session)
        app = WritingApplication(repository)
        revision = app.propose_agent_edit(user_id, document["document_id"], uuid4(), request)
        # Keep a stale ORM entity alive while another real SQLite session changes it.
        cached = session.scalar(select(WritingRevisionRow).where(
            WritingRevisionRow.revision_id == revision["revision_id"],
        ))
        assert app.preview_edit_target(user_id, document["document_id"], request, "修订", True,
                                       revision=revision)["safe_replacement_text"] == "修订"
        with database.session() as writer:
            changes = {"reject": {"status": "rejected"}, "body": {"after_markdown": "另一修订"},
                       "scope": {"selection_end": 1}}[mutation]
            writer.execute(update(WritingRevisionRow).where(
                WritingRevisionRow.revision_id == revision["revision_id"],
            ).values(**changes))
        assert cached.status == "pending"
        with pytest.raises(WritingConflict, match="unpersisted"):
            app.preview_edit_target(user_id, document["document_id"], request, "修订", True,
                                    revision=revision)


def test_narrow_queries_are_owner_scoped_and_new_samples_are_not_cached(plain_client):
    c = plain_client
    user_id = UUID(_authenticate(c)["user"]["user_id"])
    document = doc(c, "原文")
    stranger = UUID(_authenticate(c)["user"]["user_id"])
    database = c.app.state.database
    with database.session() as session:
        repository = SqliteWritingRepository(session)
        revision = repository.add_revision(user_id, document, action="rewrite",
                                           after_markdown="提议", warnings=[])
        assert repository.has_pending_revision(user_id, document["document_id"])
        assert not repository.has_pending_revision(stranger, document["document_id"])
        assert repository.pending_revision_ids(stranger, document["document_id"]) == []
        assert repository.pending_revision(stranger, document["document_id"],
                                           revision["revision_id"]) is None
        session.execute(update(WritingRevisionRow).where(
            WritingRevisionRow.revision_id == revision["revision_id"],
        ).values(status="rejected"))
    with database.session() as session:
        app = WritingApplication(SqliteWritingRepository(session))
        request = {"expected_version": 1, "original_text": "原文"}
        candidate = "联络 alice.private@example.test"
        assert app.preview_edit_target(user_id, document["document_id"], request, candidate,
                                       True)["safe_replacement_text"] == candidate
        with database.session() as writer:
            SqliteWritingRepository(writer).add_sample(
                user_id, title="样文", genre="report", text="联络 alice.private@example.test",
            )
        with pytest.raises(WritingUnsafeOutput):
            app.preview_edit_target(user_id, document["document_id"], request, candidate, True)
