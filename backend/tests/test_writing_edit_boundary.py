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


def _legacy_command_digest(target, payload):
    # Deliberately independent of WritingApplication.mutate: this is the old
    # HTTP route's persisted operation identity, including default=str.
    return sha256(json.dumps(
        {"target": target, "payload": payload}, sort_keys=True, default=str,
    ).encode()).hexdigest()


@pytest.mark.parametrize("decision", ["accept", "reject"])
def test_http_write_routes_require_only_public_commands(decision):
    from types import SimpleNamespace

    from qunxue_api.api.contracts.writing import WritingDocumentUpdate, WritingRevisionResolve
    from qunxue_api.api.routes.writing import resolve, update_document

    owner, document_id, revision_id, key = uuid4(), uuid4(), uuid4(), str(uuid4())
    current = SimpleNamespace(user=SimpleNamespace(user_id=owner))
    calls = []
    saved = {"title": "  原样标题  ", "markdown": "", "version": 2}
    resolved = {"document": saved, "revision": {"status": decision + "ed"}}

    class UseCases:
        # No repository, mutate, Session, or executable callback on this fake.
        def save_document(self, user_id, document, request_key, data):
            calls.append(("save", user_id, document, request_key, data))
            return saved

        def resolve_revision(self, user_id, document, revision, request_key, data):
            calls.append(("resolve", user_id, document, revision, request_key, data))
            return resolved

    app = UseCases()
    assert update_document(
        document_id, WritingDocumentUpdate(expected_version="1", title="  原样标题  ",
                                           markdown="", genre=None), current, app, key,
    ) == saved
    assert resolve(
        document_id, revision_id, WritingRevisionResolve(expected_version="2", decision=decision),
        current, app, key,
    ) == resolved
    assert calls == [
        ("save", owner, document_id, key,
         {"expected_version": 1, "title": "  原样标题  ", "markdown": ""}),
        ("resolve", owner, document_id, revision_id, key,
         {"decision": decision, "expected_version": 2}),
    ]


@pytest.mark.parametrize("data,message", [
    ({"expected_version": 1}, "没有要保存的修改"),
    ({"expected_version": 1, "title": " \t\n"}, "标题不能为空"),
    ({"expected_version": 1, "title": " \t\n", "markdown": "正文"}, "标题不能为空"),
])
def test_save_command_validates_before_even_looking_up_a_receipt(data, message):
    class NoCalls:
        def operation(self, *args):
            pytest.fail("Validation must precede receipt lookup, including replay")

    with pytest.raises(ValueError, match=message):
        WritingApplication(NoCalls()).save_document(uuid4(), uuid4(), str(uuid4()), data)


@pytest.mark.parametrize("command", ["save", "accept", "reject"])
@pytest.mark.parametrize("replay", [False, True])
def test_write_commands_own_legacy_identity_action_order_and_replay(command, replay):
    from types import SimpleNamespace

    owner, document, revision, key = uuid4(), uuid4(), uuid4(), str(uuid4())
    calls, receipt = [], object()
    result = {"markdown": "😀原样\r\n[[笔记]]", "version": 2}
    data = ({"expected_version": 1, "title": "  标题  ", "markdown": result["markdown"]}
            if command == "save" else {"expected_version": 1, "decision": command})
    original = dict(data)
    target = (f"document:update:{document}" if command == "save"
              else f"revision:resolve:{document}:{revision}")
    digest = _legacy_command_digest(target, data)

    class Commands:
        def operation(self, *args):
            calls.append(("operation", *args))
            return SimpleNamespace(result=result) if replay else None

        def start(self, *args):
            calls.append(("start", *args))
            return receipt

        def update(self, *args):
            calls.append(("update", *args))
            return result

        def resolve(self, *args, **kwargs):
            calls.append(("resolve", *args, kwargs))
            return result

        def complete(self, *args):
            calls.append(("complete", *args))

    app = WritingApplication(Commands())
    actual = (app.save_document(owner, document, key, data) if command == "save"
              else app.resolve_revision(owner, document, revision, key, data))
    assert actual is result and data == original
    expected = [("operation", owner, key, digest)]
    if not replay:
        expected += [("start", owner, key, digest, target)]
        if command == "save":
            expected += [("update", owner, document, 1,
                          {"title": "  标题  ", "markdown": result["markdown"]})]
        else:
            expected += [("resolve", owner, document, revision, data)]
        expected += [("complete", receipt, result)]
    assert calls == expected


@pytest.mark.parametrize("command", ["save", "accept", "reject"])
def test_http_commands_replay_old_completed_receipts_and_reject_changed_identity(
    plain_client, command,
):
    from qunxue_api.api.contracts.writing import (
        WritingDocumentResponse,
        WritingRevisionResolution,
    )

    c = plain_client
    owner = UUID(_authenticate(c)["user"]["user_id"])
    document = doc(c, "😀原稿\r\n[[笔记|别名]]\n- [ ] 待办")
    key = str(uuid4())
    document_id = document["document_id"]
    with c.app.state.database.session() as session:
        repo = SqliteWritingRepository(session)
        revision = repo.add_revision(owner, document, action="rewrite",
                                     after_markdown="😀修订\r\n> [!note]\n> 引文[^来源]",
                                     warnings=[])
        if command == "save":
            data = {"expected_version": 1, "title": "  原样标题  ", "markdown": ""}
            target = f"document:update:{document_id}"
            old_result = repo.update(owner, document_id, 1,
                                     {"title": data["title"], "markdown": ""})
        else:
            data = {"expected_version": 1, "decision": command}
            target = f"revision:resolve:{document_id}:{revision['revision_id']}"
            old_result = repo.resolve(owner, document_id, revision["revision_id"], command, 1)
        # Seed a durable receipt using the old computation, without new commands.
        session.add(WritingOperationRow(
            operation_id=str(uuid4()), user_id=str(owner), request_key=key,
            request_hash=_legacy_command_digest(target, data), target=target,
            status="completed", result=old_result, created_at=document["created_at"],
        ))
    path = f"/api/writing/documents/{document_id}"
    if command != "save":
        path += f"/revisions/{revision['revision_id']}/resolve"
    send = c.patch if command == "save" else c.post
    writes = []

    def record(_connection, _cursor, statement, *_args):
        if statement.lstrip().upper().startswith((
            "UPDATE WRITING_", "INSERT INTO WRITING_", "DELETE FROM WRITING_",
        )):
            writes.append(statement)

    event.listen(c.app.state.database.engine, "before_cursor_execute", record)
    try:
        # Null fields must still be omitted before hashing a save request.
        body = {**data, "genre": None} if command == "save" else data
        with c.app.state.writing_scope() as app:
            raw_replay = (app.save_document(owner, UUID(document_id), key, data)
                          if command == "save" else app.resolve_revision(
                              owner, UUID(document_id), UUID(revision["revision_id"]), key, data,
                          ))
        assert raw_replay == old_result
        replay = send(path, json=body, headers={"Idempotency-Key": key})
        assert replay.status_code == 200, replay.text
        response_model = WritingDocumentResponse if command == "save" else WritingRevisionResolution
        assert replay.json() == response_model.model_validate(old_result).model_dump(mode="json")
        changes = ({**body, "markdown": "别的内容"} if command == "save"
                   else {**body, "decision": "reject" if command == "accept" else "accept"})
        conflict = send(path, json=changes, headers={"Idempotency-Key": key})
        assert conflict.status_code == 409
        assert conflict.json()["error"]["message"] == "同一请求标识不能用于不同内容"
        targets = [path.replace(document_id, str(uuid4()))]
        if command != "save":
            targets.append(path.replace(revision["revision_id"], str(uuid4())))
        for other_path in targets:
            conflict = send(other_path, json=body, headers={"Idempotency-Key": key})
            assert conflict.status_code == 409
            assert conflict.json()["error"]["message"] == "同一请求标识不能用于不同内容"
        assert writes == []
    finally:
        event.remove(c.app.state.database.engine, "before_cursor_execute", record)
    stranger = UUID(_authenticate(c)["user"]["user_id"])
    forbidden = send(path, json=body, headers={"Idempotency-Key": key})
    assert forbidden.status_code == 404
    assert forbidden.json()["error"]["code"] == "not_found"
    with c.app.state.database.session() as session:
        assert session.scalar(select(WritingOperationRow).where(
            WritingOperationRow.user_id == str(stranger), WritingOperationRow.request_key == key,
        )) is None
        repo = SqliteWritingRepository(session)
        assert repo.get(owner, document_id) == (
            old_result if command == "save" else old_result["document"]
        )
        assert repo.revisions(owner, document_id)[0]["status"] == {
            "save": "stale", "accept": "accepted", "reject": "rejected",
        }[command]


def test_http_save_keeps_validation_precedence_nulls_and_exact_title(plain_client):
    c = plain_client
    _authenticate(c)
    document = doc(c)
    path = f"/api/writing/documents/{document['document_id']}"
    headers = {"Idempotency-Key": str(uuid4())}
    saved = c.patch(path, json={"expected_version": "1", "title": "  标题  ",
                                "markdown": "", "genre": None}, headers=headers)
    assert saved.status_code == 200
    assert saved.json()["title"] == "  标题  "
    assert saved.json()["markdown"] == "" and saved.json()["genre"] == document["genre"]
    for body, message in [
        ({"expected_version": 1, "title": None, "markdown": None}, "没有要保存的修改"),
        ({"expected_version": 1, "title": " \t", "markdown": "new"}, "标题不能为空"),
    ]:
        # Reusing the completed key must not turn validation into an identity conflict.
        response = c.patch(path, json=body, headers=headers)
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "validation_error"
        assert response.json()["error"]["message"] == message
    assert c.get(path).json() == saved.json()
