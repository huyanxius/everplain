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


def test_creation_routes_require_only_public_commands_and_serialized_data():
    from io import BytesIO
    from types import SimpleNamespace

    from fastapi import UploadFile

    from qunxue_api.api.contracts.writing import WritingDocumentCreate, WritingSampleCreate
    from qunxue_api.api.routes.writing import create_document, create_sample, upload_sample
    from qunxue_api.modules.writing import Genre

    owner, key = uuid4(), str(uuid4())
    current = SimpleNamespace(user=SimpleNamespace(user_id=owner))
    calls, result = [], object()
    sample = {"title": "  原样样文  ", "genre": "essay", "text": "😀 原文\r\n" * 80}
    filename = "长" * 205 + ".txt"

    class UseCases:
        # No repository, mutate, Session, DTO, or executable callback required.
        def create_sample(self, user_id, request_key, data):
            calls.append(("sample", user_id, request_key, data))
            return result

        def create_document(self, user_id, request_key, data):
            calls.append(("document", user_id, request_key, data))
            return result

        def parse_uploaded_sample(self, **kwargs):
            calls.append(("parse", kwargs))
            return sample["text"]

    app = UseCases()
    assert create_sample(WritingSampleCreate(**sample), current, app, key) is result
    assert create_document(WritingDocumentCreate(title="  文稿  "), current, app, key) is result
    assert create_document(WritingDocumentCreate(), current, app, key) is result
    assert upload_sample(current, app, key, UploadFile(
        filename="/ignored/" + filename, file=BytesIO(b"raw contents"),
    ), Genre.ESSAY) is result
    assert calls == [
        ("sample", owner, key, sample),
        ("document", owner, key, {"title": "文稿", "genre": "essay", "markdown": ""}),
        ("document", owner, key, {"title": "未命名文稿", "genre": "essay", "markdown": ""}),
        ("parse", {"filename": filename, "media_type": None, "content": b"raw contents"}),
        ("sample", owner, key, {**sample, "title": filename[:200]}),
    ]


@pytest.mark.parametrize("command", ["sample", "document"])
@pytest.mark.parametrize("replay", [False, True])
def test_creation_commands_own_legacy_identity_and_action_order(command, replay):
    from types import SimpleNamespace

    owner, key, claim = uuid4(), str(uuid4()), object()
    data = {"title": "  原样  ", "genre": "essay",
            "text" if command == "sample" else "markdown": "😀 原文\r\n" * 80}
    original, result, calls = dict(data), {"id": "original"}, []
    target = command + ":create"
    digest = _legacy_command_digest(target, data)

    class Repository:
        def operation(self, *args):
            calls.append(("operation", *args))
            return SimpleNamespace(result=result) if replay else None

        def start(self, *args):
            calls.append(("start", *args))
            return claim

        def add_sample(self, user_id, **payload):
            calls.append(("sample", user_id, payload))
            return result

        def create(self, user_id, payload):
            calls.append(("document", user_id, payload))
            return result

        def complete(self, *args):
            calls.append(("complete", *args))

    actual = getattr(WritingApplication(Repository()), "create_" + command)(owner, key, data)
    assert actual is result and data == original
    expected = [("operation", owner, key, digest)]
    if not replay:
        expected += [("start", owner, key, digest, target), (command, owner, data),
                     ("complete", claim, result)]
    assert calls == expected


@pytest.mark.parametrize("title,text", [
    ("样文", "字" * 79 + " \t\n"), (" \t", "字" * 80), (" \t", "字" * 79 + " " * 20),
])
def test_sample_creation_validates_before_receipt_lookup(title, text):
    class NoCalls:
        def operation(self, *args):
            pytest.fail("Sample rules must precede receipt lookup, including replay")

    with pytest.raises(ValueError, match="样文至少需要80个有效字符和一个标题"):
        WritingApplication(NoCalls()).create_sample(
            uuid4(), str(uuid4()), {"title": title, "genre": "essay", "text": text},
        )


@pytest.mark.parametrize("command", ["sample", "document"])
def test_creation_replays_persisted_legacy_receipts_and_preserves_http_identity(
    plain_client, command,
):
    from qunxue_api.adapters.sqlite.writing import WritingDocumentRow, WritingSampleRow
    from qunxue_api.api.contracts.writing import WritingDocumentResponse, WritingSampleResponse

    c = plain_client
    owner = _authenticate(c)["user"]["user_id"]
    key, target = str(uuid4()), command + ":create"
    data = ({"title": "  原样样文  ", "genre": "essay", "text": "😀 正文\r\n" * 80}
            if command == "sample" else {"title": "文稿", "genre": "essay", "markdown": ""})
    with c.app.state.database.session() as session:
        repo = SqliteWritingRepository(session)
        old = repo.add_sample(owner, **data) if command == "sample" else repo.create(owner, data)
        session.add(WritingOperationRow(
            operation_id=str(uuid4()), user_id=owner, request_key=key,
            request_hash=_legacy_command_digest(target, data), target=target,
            status="completed", result=old, created_at=old["created_at"],
        ))
    path = "/api/writing/" + ("samples" if command == "sample" else "documents")
    # Document defaults and title trimming must enter the old digest before lookup.
    body = data if command == "sample" else {"title": "  文稿  "}
    headers, writes = {"Idempotency-Key": key}, []

    def record(_connection, _cursor, statement, *_args):
        if statement.lstrip().upper().startswith((
            "UPDATE WRITING_", "INSERT INTO WRITING_", "DELETE FROM WRITING_",
        )):
            writes.append(statement)

    event.listen(c.app.state.database.engine, "before_cursor_execute", record)
    try:
        with c.app.state.writing_scope() as app:
            assert getattr(app, "create_" + command)(owner, key, data) == old
        replay = c.post(path, json=body, headers=headers)
        response = WritingSampleResponse if command == "sample" else WritingDocumentResponse
        assert replay.status_code == 200, replay.text
        assert replay.json() == response.model_validate(old).model_dump(mode="json")
        changes = [("title", "别的标题"), ("genre", "fiction"),
                   ("text" if command == "sample" else "markdown", "其他正文" * 80)]
        if command == "sample":
            changes.append(("text", data["text"].replace("\r\n", " ")))
        for field, value in changes:
            conflict = c.post(path, json={**data, field: value}, headers=headers)
            assert conflict.status_code == 409
            assert conflict.json()["error"]["message"] == "同一请求标识不能用于不同内容"
        other_path = "/api/writing/" + ("documents" if command == "sample" else "samples")
        other_data = ({"title": "文稿"} if command == "sample" else
                      {"title": "样文", "genre": "essay", "text": "正文" * 80})
        conflict = c.post(other_path, json=other_data, headers=headers)
        assert conflict.status_code == 409
        assert conflict.json()["error"]["message"] == "同一请求标识不能用于不同内容"
        assert writes == []
    finally:
        event.remove(c.app.state.database.engine, "before_cursor_execute", record)
    # A create has no existing target owned by someone else. The same key belongs
    # independently to this second owner, rather than producing save's 404.
    stranger = _authenticate(c)["user"]["user_id"]
    created = c.post(path, json=body, headers=headers)
    assert created.status_code == 200, created.text
    id_field = command + "_id"
    assert created.json()[id_field] != old[id_field]
    row_type = WritingSampleRow if command == "sample" else WritingDocumentRow
    with c.app.state.database.session() as session:
        rows = list(session.scalars(select(row_type)))
        assert {row.user_id for row in rows} == {owner, stranger}
        assert len(rows) == 2
        receipts = list(session.scalars(select(WritingOperationRow)))
        assert {receipt.user_id for receipt in receipts} == {owner, stranger}
        assert {receipt.request_hash for receipt in receipts} == {
            _legacy_command_digest(target, data),
        }
        if command == "sample":
            assert all(row.title == data["title"] and row.text == data["text"] for row in rows)
        else:
            assert all(row.title == "文稿" and row.markdown == "" and row.version == 1
                       and row.created_at == row.updated_at for row in rows)


def test_deleted_sample_creation_receipt_replays_without_resurrecting_row(plain_client):
    from qunxue_api.adapters.sqlite.writing import WritingSampleRow

    c = plain_client
    owner = _authenticate(c)["user"]["user_id"]
    headers = {"Idempotency-Key": str(uuid4())}
    data = {"title": "  原样  ", "genre": "essay", "text": "正文\r\n" * 80}
    first = c.post("/api/writing/samples", json=data, headers=headers)
    assert first.status_code == 200
    assert c.delete("/api/writing/samples/" + first.json()["sample_id"]).status_code == 204
    replay = c.post("/api/writing/samples", json=data, headers=headers)
    assert replay.status_code == 200 and replay.json() == first.json()
    with c.app.state.database.session() as session:
        assert list(session.scalars(select(WritingSampleRow))) == []
        receipt = session.scalar(select(WritingOperationRow).where(
            WritingOperationRow.user_id == owner,
            WritingOperationRow.request_key == headers["Idempotency-Key"],
        ))
        assert receipt.status == "completed"
        assert receipt.result["sample_id"] == first.json()["sample_id"]


@pytest.mark.parametrize("outcome", [
    "fresh", "replay", "parse_error", "parser_unavailable", "short", "long", "whitespace",
])
def test_upload_parse_dto_lookup_order_and_unreserved_parser(plain_client, monkeypatch, outcome):
    import sqlite3
    from types import SimpleNamespace

    from qunxue_api.api.routes import writing as routes
    from qunxue_api.api.writing_errors import WritingApiError
    from qunxue_api.modules.research_materials import MaterialParseError
    from qunxue_api.modules.writing import WritingUnavailable

    c = plain_client
    owner = _authenticate(c)["user"]["user_id"]
    database, key = c.app.state.database, str(uuid4())
    text = "合成正文\r\n" * 80
    filename = "长" * 205 + ".txt"
    data = {"title": filename[:200], "genre": "essay", "text": text}
    events, writes, parse_inputs = [], [], []
    with database.session() as session:
        # Independent old receipt exists even for invalid inputs: parse and DTO
        # failures must keep priority over a matching or mismatching old key.
        old = SqliteWritingRepository(session).add_sample(owner, **data)
        if outcome != "fresh":
            session.add(WritingOperationRow(
                operation_id=str(uuid4()), user_id=owner, request_key=key,
                request_hash=_legacy_command_digest("sample:create", data), target="sample:create",
                status="completed", result=old, created_at=old["created_at"],
            ))
    original_dto, original_lookup = routes.WritingSampleCreate, SqliteWritingRepository.operation

    class ObservedDTO(original_dto):
        def __init__(self, **kwargs):
            events.append("DTO")
            super().__init__(**kwargs)

        def model_dump(self, **kwargs):
            events.append("model_dump")
            assert kwargs == {"mode": "json"}
            return super().model_dump(**kwargs)

    def lookup(repository, *args):
        events.append("lookup")
        assert args == (owner, key, _legacy_command_digest("sample:create", data))
        return original_lookup(repository, *args)

    def record(_connection, _cursor, statement, *_args):
        if statement.lstrip().upper().startswith((
            "UPDATE WRITING_", "INSERT INTO WRITING_", "DELETE FROM WRITING_",
        )):
            writes.append(statement)

    monkeypatch.setattr(routes, "WritingSampleCreate", ObservedDTO)
    monkeypatch.setattr(SqliteWritingRepository, "operation", lookup)
    event.listen(database.engine, "before_cursor_execute", record)
    try:
        with c.app.state.writing_scope() as app:
            def parser(**kwargs):
                events.append("parse")
                parse_inputs.append(kwargs)
                connection = app.repository.session.connection().connection.driver_connection
                assert not connection.in_transaction
                claims = list(app.repository.session.scalars(select(WritingOperationRow).where(
                    WritingOperationRow.request_key == key,
                    WritingOperationRow.status == "running",
                )))
                assert claims == []
                # Session existence and a read must not be mistaken for a SQLite
                # write reservation: a second DBAPI connection can still write.
                other = sqlite3.connect(database.engine.url.database, timeout=0)
                try:
                    other.execute("UPDATE writing_samples SET title = title WHERE user_id = ?",
                                  (owner,))
                    assert other.in_transaction
                    other.rollback()
                finally:
                    other.close()
                if outcome == "parse_error":
                    raise MaterialParseError("private parser failure")
                if outcome == "parser_unavailable":
                    raise WritingUnavailable("样文解析器尚未配置")
                content = {"short": "字" * 79, "long": "字" * 100001,
                           "whitespace": "字" * 79 + " \t\n"}.get(outcome, text)
                return SimpleNamespace(full_text=content)

            app.sample_parser = parser
            from io import BytesIO

            from fastapi import UploadFile
            from starlette.datastructures import Headers

            current = SimpleNamespace(user=SimpleNamespace(user_id=owner))

            def upload(raw=b"first raw", mime="text/plain", directory="first"):
                return routes.upload_sample(current, app, key, UploadFile(
                    filename=f"/{directory}/{filename}", file=BytesIO(raw),
                    headers=Headers({"content-type": mime}),
                ), "essay")

            if outcome in {"fresh", "replay"}:
                assert upload() == old
                assert events == ["parse", "DTO", "model_dump", "lookup"]
                if outcome == "replay":
                    events.clear()
                    assert upload(
                        b"different raw bytes", "application/octet-stream", "elsewhere",
                    ) == old
                    assert events == ["parse", "DTO", "model_dump", "lookup"]
                    assert parse_inputs == [
                        {"filename": filename, "media_type": "text/plain", "content": b"first raw"},
                        {"filename": filename, "media_type": "application/octet-stream",
                         "content": b"different raw bytes"},
                    ]
            else:
                with pytest.raises(WritingApiError) as caught, routes.errors():
                    upload()
                expected_status = 503 if outcome == "parser_unavailable" else 422
                assert caught.value.status_code == expected_status
                if outcome in {"short", "long"}:
                    from pydantic import ValidationError

                    assert isinstance(caught.value.__cause__, ValidationError)
                    assert caught.value.message == "输入不符合写作要求，请检查文件格式、长度或选区"
                elif outcome == "whitespace":
                    assert caught.value.message == "样文至少需要80个有效字符和一个标题"
                assert events == (["parse"] if outcome in {"parse_error", "parser_unavailable"}
                                  else ["parse", "DTO"] if outcome in {"short", "long"}
                                  else ["parse", "DTO", "model_dump"])
            if outcome != "fresh":
                assert writes == []
    finally:
        event.remove(database.engine, "before_cursor_execute", record)


def test_creation_http_retains_json_validation_and_upload_dto_error_channels(plain_client):
    from contextlib import contextmanager
    from types import SimpleNamespace

    c = plain_client
    _authenticate(c)
    headers = {"Idempotency-Key": str(uuid4())}
    valid = {"title": "样文", "genre": "essay", "text": "字" * 80}
    assert c.post("/api/writing/samples", json=valid, headers=headers).status_code == 200
    for data in [dict(valid, text="字" * 79 + " \t"), dict(valid, title=" \t")]:
        invalid = c.post("/api/writing/samples", json=data, headers=headers)
        assert invalid.status_code == 422
        assert invalid.json()["error"]["message"] == "样文至少需要80个有效字符和一个标题"
    invalid_json = c.post("/api/writing/samples", json=dict(valid, text="字" * 79), headers=headers)
    assert invalid_json.status_code == 422
    original_scope = c.app.state.writing_scope

    @contextmanager
    def scope():
        with original_scope() as app:
            app.sample_parser = lambda **kwargs: SimpleNamespace(full_text="字" * 79)
            yield app

    c.app.state.writing_scope = scope
    try:
        invalid_upload = c.post("/api/writing/samples/upload", data={"genre": "essay"},
                                files={"file": ("sample.txt", b"raw", "text/plain")},
                                headers=headers)
    finally:
        c.app.state.writing_scope = original_scope
    assert invalid_upload.status_code == 422
    assert invalid_upload.json()["error"]["message"] == (
        "输入不符合写作要求，请检查文件格式、长度或选区"
    )
    assert invalid_json.json()["error"]["code"] == invalid_upload.json()["error"]["code"]
    assert invalid_json.json()["error"]["message"] != invalid_upload.json()["error"]["message"]
    for body in [{"title": " \t"}, {"genre": "invalid"}, {"markdown": "字" * 200001}]:
        response = c.post("/api/writing/documents", json=body,
                          headers={"Idempotency-Key": str(uuid4())})
        assert response.status_code == 422


def test_sample_creation_real_quota_dedupe_precedence_and_owner_isolation(plain_client):
    from qunxue_api.adapters.sqlite.writing import WritingSampleRow

    c = plain_client
    owner = _authenticate(c)["user"]["user_id"]
    data = {"title": "  最早标题  ", "genre": "essay", "text": "原样正文\r\n" * 80}
    with c.app.state.writing_scope() as app:
        first = app.create_sample(owner, str(uuid4()), data)
        for index in range(98):
            app.create_sample(owner, str(uuid4()), {**data, "text": f"唯一{index}:" + "字" * 80})
    hundredth = c.post("/api/writing/samples", json={**data, "text": "第100篇" + "字" * 80},
                       headers={"Idempotency-Key": str(uuid4())})
    assert hundredth.status_code == 200, hundredth.text
    duplicate = {**data, "title": "后来标题", "text": data["text"].replace("\r\n", " \t")}
    replay = c.post("/api/writing/samples", json=duplicate,
                    headers={"Idempotency-Key": str(uuid4())})
    assert replay.status_code == 200 and replay.json()["sample_id"] == first["sample_id"]
    assert replay.json()["title"] == data["title"]
    for body, code, message in [
        ({**duplicate, "genre": "fiction"}, 409,
         "这篇样文已属于另一文体，请先移除旧样文再重新添加"),
        ({**data, "text": "第101篇" + "字" * 80}, 422, "最多保留100篇样文，请先移除不再使用的文章"),
    ]:
        key = str(uuid4())
        rejected = c.post("/api/writing/samples", json=body, headers={"Idempotency-Key": key})
        assert rejected.status_code == code and rejected.json()["error"]["message"] == message
        with c.app.state.database.session() as session:
            assert session.scalar(select(WritingOperationRow).where(
                WritingOperationRow.request_key == key,
            )) is None
    stranger = _authenticate(c)["user"]["user_id"]
    independent = c.post("/api/writing/samples", json=data,
                         headers={"Idempotency-Key": str(uuid4())})
    assert independent.status_code == 200 and independent.json()["sample_id"] != first["sample_id"]
    with c.app.state.database.session() as session:
        rows = list(session.scalars(select(WritingSampleRow)))
        assert sum(row.user_id == owner for row in rows) == 100
        assert sum(row.user_id == stranger for row in rows) == 1
        original = session.get(WritingSampleRow, first["sample_id"])
        assert original.title == data["title"] and original.text == data["text"]
