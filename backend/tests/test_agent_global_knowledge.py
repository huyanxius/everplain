"""Owner-wide tools use the existing documents and preserve real source coordinates."""

from uuid import UUID, uuid4

from test_research_material_api import _authenticate
from test_shared_knowledge_agent import InspectingRunner
from test_shared_knowledge_api import create_library, mutation, upload


class SearchingRunner(InspectingRunner):
    def run(self, **kwargs):
        self.tools = kwargs["tools"]
        self.directory = self.tools.browse_knowledge_directory()
        self.results = self.tools.search_knowledge(kwargs["prompt"])
        return super().run(**kwargs)


def run(client, identity, runner, **kwargs):
    with client.app.state.disciplinary_agent_scope() as app:
        app._runner = runner
        return app.run_turn(
            user_id=UUID(identity["user"]["user_id"]),
            conversation_id=kwargs.pop("conversation_id", None),
            prompt="课堂记录标记",
            idempotency_key=str(uuid4()),
            **kwargs,
        )


def test_default_chat_reads_all_owned_libraries_and_preserves_source_links(plain_client):
    client = plain_client
    identity = _authenticate(client)
    libraries = [create_library(client), create_library(client)]
    docs = [upload(client, kb["id"]) for kb in libraries]
    runner = SearchingRunner()
    result = run(client, identity, runner)
    assert result.conversation.reference_knowledge_base_id is None
    assert result.conversation.task_id is None
    assert {c.material_id for c in result.turn.assistant_message.citations} == {
        doc["id"] for doc in docs
    }
    assert runner.tools.memory.user_text_only is True
    restored = client.get(f"/api/agent/conversations/{result.conversation.conversation_id}").json()
    citations = restored["turns"][0]["assistant"]["citations"]
    assert {c["knowledge_base_id"] for c in citations} == {kb["id"] for kb in libraries}
    for citation in citations:
        assert not citation["deleted"]
        source = client.get(
            f"/api/shared-knowledge-bases/{citation['knowledge_base_id']}"
            f"/documents/{citation['material_id']}/source",
            params={"segment_id": citation["segment_id"]},
        )
        assert source.status_code == 200
        assert "QX-A17" in str(source.json())
        assert citation["parse_id"] and citation["locator"]


def test_default_scope_excludes_other_owner_even_if_subscribed(plain_client):
    client = plain_client
    _authenticate(client)
    foreign_kb = create_library(client)
    foreign_doc = upload(client, foreign_kb["id"], "课堂记录标记 外部秘密")
    foreign_kb = mutation(
        client,
        "patch",
        f"/api/shared-knowledge-bases/{foreign_kb['id']}",
        json={"sharing_enabled": True},
    ).json()
    client.cookies.clear()
    identity = _authenticate(client)
    mutation(
        client,
        "post",
        "/api/shared-knowledge-base-subscriptions",
        json={"share_token": foreign_kb["share_token"]},
    )
    kb = create_library(client)
    doc = upload(client, kb["id"])
    runner = SearchingRunner()
    run(client, identity, runner)
    assert {entry["knowledge_id"] for entry in runner.directory} == {doc["id"]}
    assert "外部秘密" not in str(runner.inputs)
    assert runner.tools.read_knowledge_entry(foreign_doc["id"])["error"] == (
        "knowledge_entry_not_found"
    )


def test_global_removed_sources_are_withheld_from_history(plain_client):
    client = plain_client
    identity = _authenticate(client)
    kb = create_library(client)
    doc = upload(client, kb["id"])
    runner = SearchingRunner()
    first = run(client, identity, runner)
    mutation(client, "delete", f"/api/shared-knowledge-bases/{kb['id']}/documents/{doc['id']}")
    run(client, identity, runner, conversation_id=first.conversation.conversation_id)
    assert "QX-A17" not in str(runner.inputs[-1])
    assert runner.results == []


def test_greeting_binds_tools_without_eager_search_or_indexing(plain_client):
    client = plain_client
    identity = _authenticate(client)
    kb = create_library(client)
    upload(client, kb["id"])
    runner = InspectingRunner()
    with client.app.state.disciplinary_agent_scope() as app:
        app._runner = runner

        def forbidden(**kwargs):
            raise AssertionError("Ordinary chat must not eagerly search or rebuild indexes")

        app._shared_references.search = forbidden
        app._shared_references.document_scope = forbidden
        app.run_turn(
            user_id=UUID(identity["user"]["user_id"]),
            conversation_id=None,
            prompt="你好",
            idempotency_key=str(uuid4()),
        )
    assert runner.inputs[0][1] is None


def test_imported_obsidian_notes_and_web_documents_are_visible_without_reimport(plain_client):
    from test_knowledge_import import drain, start

    client = plain_client
    client.app.state.import_worker_enabled = False
    identity = _authenticate(client)
    batches = []
    for source in ("obsidian", "apple_notes"):
        batches.append(start(client, [(f"{source}.md", "# 课堂记录标记\nQX-A17".encode())], source))
    client.app.state.import_fetch_text = lambda url: "课堂记录标记 QX-A17 网页正文"
    batches.append(
        start(
            client,
            [("bookmarks.html", b'<DL><DT><A HREF="https://example.org/note">Web</A></DL>')],
            "chrome",
        )
    )
    drain(client)
    before = [client.get("/api/imports/" + b["id"]).json() for b in batches]
    assert all(b["status"] == "completed" for b in before)
    documents = {item["document_id"] for b in before for item in b["items"]}
    runner = SearchingRunner()
    result = run(client, identity, runner)
    assert {c.material_id for c in result.turn.assistant_message.citations} == documents
    after = [client.get("/api/imports/" + b["id"]).json() for b in batches]
    assert after == before


def test_default_import_target_never_uses_same_named_subscribed_library(plain_client):
    from test_knowledge_import import drain, start

    client = plain_client
    client.app.state.import_worker_enabled = False
    _authenticate(client)
    foreign = mutation(
        client, "post", "/api/shared-knowledge-bases", json={"name": "我的资料"}
    ).json()
    foreign = mutation(
        client,
        "patch",
        f"/api/shared-knowledge-bases/{foreign['id']}",
        json={"sharing_enabled": True},
    ).json()
    client.cookies.clear()
    identity = _authenticate(client)
    mutation(
        client,
        "post",
        "/api/shared-knowledge-base-subscriptions",
        json={"share_token": foreign["share_token"]},
    )
    batch = start(client, [("note.md", "# 课堂记录标记 QX-A17".encode())], "obsidian")
    assert batch["library_id"] != foreign["id"]
    drain(client)
    runner = SearchingRunner()
    assert run(client, identity, runner).turn.assistant_message.citations


def test_failed_import_is_separate_from_global_retrieval_binding(plain_client):
    from test_knowledge_import import drain, start

    client = plain_client
    client.app.state.import_worker_enabled = False
    identity = _authenticate(client)

    def failed(url):
        raise ValueError("网页没有可读取的正文")

    client.app.state.import_fetch_text = failed
    batch = start(
        client,
        [("bookmarks.html", b'<DL><DT><A HREF="https://example.org/bad">Bad</A></DL>')],
        "chrome",
    )
    drain(client)
    before = client.get("/api/imports/" + batch["id"]).json()
    assert before["failed"] == 1
    runner = SearchingRunner()
    run(client, identity, runner)
    assert runner.directory == [] and runner.results == []
    assert client.get("/api/imports/" + batch["id"]).json() == before


def test_global_search_reuses_existing_document_vectors(plain_client):
    from types import SimpleNamespace

    from qunxue_api.adapters.sqlite.shared_knowledge import SharedDocumentRow

    client = plain_client
    identity = _authenticate(client)
    kb = create_library(client)
    doc = upload(client, kb["id"])
    with client.app.state.shared_knowledge_scope() as app:
        row = app.repository.session.get(SharedDocumentRow, doc["id"])
        cached = {f"material:{doc['id']}:{s['segment_id']}": [0.25, 0.75] for s in row.segments}
        row.vectors = {"existing-model": cached}
        app.repository.commit()

    class CachedRetriever:
        def search_chunks(
            self, *, query, chunks, limit, vector_cache, embed_missing_documents=True
        ):
            assert embed_missing_documents is False
            assert {c.chunk_id for c in chunks} == set(cached)
            assert vector_cache.get_many(chunks, "existing-model") == [
                cached[c.chunk_id] for c in chunks
            ]
            return SimpleNamespace(hits=[SimpleNamespace(chunk=c) for c in chunks], mode="cached")

    runner = SearchingRunner()
    with client.app.state.disciplinary_agent_scope() as app:
        app._runner = runner
        app._shared_references.retriever = CachedRetriever()
        result = app.run_turn(
            user_id=UUID(identity["user"]["user_id"]),
            conversation_id=None,
            prompt="课堂记录标记",
            idempotency_key=str(uuid4()),
        )
    assert result.turn.assistant_message.citations
    with client.app.state.shared_knowledge_scope() as app:
        row = app.repository.session.get(SharedDocumentRow, doc["id"])
        assert row.vectors == {"existing-model": cached}


def test_explicit_research_workspace_keeps_existing_knowledge_scope(plain_client):
    client = plain_client
    identity = _authenticate(client)
    kb = create_library(client)
    upload(client, kb["id"])

    class ScopeRunner(InspectingRunner):
        def run(self, **kwargs):
            assert kwargs["tools"].private_knowledge is None
            assert kwargs["tools"].research_map_enabled
            return super().run(**kwargs)

    run(client, identity, ScopeRunner(), workspace="research")


def test_global_citation_persistence_rejects_subscribed_foreign_source(plain_client):
    import pytest

    from qunxue_api.modules.agent_conversation import ResearchMaterialCitationUnavailable

    client = plain_client
    _authenticate(client)
    kb = create_library(client)
    upload(client, kb["id"])
    kb = mutation(
        client, "patch", f"/api/shared-knowledge-bases/{kb['id']}", json={"sharing_enabled": True}
    ).json()
    client.cookies.clear()
    identity = _authenticate(client)
    mutation(
        client,
        "post",
        "/api/shared-knowledge-base-subscriptions",
        json={"share_token": kb["share_token"]},
    )
    user_id = UUID(identity["user"]["user_id"])
    with client.app.state.disciplinary_agent_scope() as app:

        class InjectingRunner(InspectingRunner):
            def run(self, **kwargs):
                app._shared_references.prepare(
                    user_id=user_id,
                    kb_id=UUID(kb["id"]),
                    query="课堂记录标记",
                    tools=kwargs["tools"],
                )
                return super().run(**kwargs)

        app._runner = InjectingRunner()
        with pytest.raises(ResearchMaterialCitationUnavailable):
            app.run_turn(
                user_id=user_id,
                conversation_id=None,
                prompt="课堂记录标记",
                idempotency_key=str(uuid4()),
            )
