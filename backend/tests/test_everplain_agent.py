from uuid import UUID, uuid4

from test_research_material_api import _authenticate
from test_shared_knowledge_api import create_library, mutation, upload

from qunxue_api.adapters.research_agent.catalog_tools import KnowledgeToolRegistry
from qunxue_api.modules.agent_conversation import AgentRunResult


class EmptyCatalog:
    def current_release(self, *, purpose):
        raise LookupError(purpose)


def test_empty_catalog_allows_unbound_personal_agent_tools():
    tools = KnowledgeToolRegistry(EmptyCatalog())
    assert tools.search_knowledge("Compare note-taking workflows") == []
    assert tools.browse_knowledge_directory() == []
    assert tools.read_sources(["arbitrary"]) == []
    assert tools.read_knowledge_entry("arbitrary")["error"] == "knowledge_entry_not_found"
    assert tools.evidence == {}


def test_bound_library_tools_search_and_read_only_authorized_documents(plain_client):
    client = plain_client
    identity = _authenticate(client)
    kb = create_library(client)
    doc = upload(
        client, kb["id"], "Product interviews identify demand for offline search. Code EP-42."
    )
    other = create_library(client)
    private = upload(client, other["id"], "Other private library secret EP-99.")

    class Runner:
        def run(self, *, prompt, conversation, tools):
            found = tools.search_knowledge("offline search")
            assert found and "EP-42" in str(found)
            self.read = tools.read_knowledge_entry(str(doc["id"]))
            self.foreign = tools.read_knowledge_entry(str(private["id"]))
            self.directory = tools.browse_knowledge_directory()
            return AgentRunResult(
                answer="Offline search is requested.",
                citations=tuple(tools.evidence.values()),
                release_id=tools.release.knowledge_release_id,
                provider="test",
                model="boundary-test",
            )

    runner = Runner()
    with client.app.state.disciplinary_agent_scope() as app:
        app._runner = runner
        app.run_turn(
            user_id=UUID(identity["user"]["user_id"]),
            conversation_id=None,
            prompt="What do the interviews say?",
            idempotency_key=str(uuid4()),
            reference_knowledge_base_id=UUID(kb["id"]),
        )
    assert "EP-42" in runner.read["content"]
    assert runner.foreign["error"] == "knowledge_entry_not_found"
    assert "EP-99" not in str(runner.directory)


def test_library_memory_allows_explicit_user_text_but_rejects_derived_sources(plain_client):
    client = plain_client
    identity = _authenticate(client)
    kb = create_library(client)
    doc = upload(client, kb["id"], "Interview confidential finding EP-42.")

    class Runner:
        def run(self, *, prompt, conversation, tools):
            assert tools.memory is not None
            self.saved = tools.memory.change(
                action="remember", scope="user", key="language", content="请用中文回答"
            )
            self.rejected = tools.memory.change(
                action="remember",
                scope="user",
                key="interview",
                content="Interview confidential finding EP-42.",
            )
            return AgentRunResult(
                answer="已记住偏好。",
                citations=tuple(tools.evidence.values()),
                release_id=tools.release.knowledge_release_id,
                provider="test",
                model="memory-boundary",
            )

    runner = Runner()
    with client.app.state.disciplinary_agent_scope() as app:
        app._runner = runner
        app.run_turn(
            user_id=UUID(identity["user"]["user_id"]),
            conversation_id=None,
            prompt="记住：请用中文回答",
            idempotency_key=str(uuid4()),
            reference_knowledge_base_id=UUID(kb["id"]),
        )
    assert runner.saved["saved"] is True
    assert runner.rejected["error"] == "source_derived_memory_disallowed"
    mutation(client, "delete", f"/api/shared-knowledge-bases/{kb['id']}/documents/{doc['id']}")
    entries = client.get("/api/memories").json()["items"]
    assert any(item["content"] == "请用中文回答" for item in entries)
    assert "EP-42" not in str(entries)


def test_deleted_library_source_removes_derived_answer_history(plain_client):
    client = plain_client
    identity = _authenticate(client)
    kb = create_library(client)
    doc = upload(client, kb["id"], "EP-42 findings from interviews.")

    class Runner:
        inputs = []

        def run(self, *, prompt, conversation, tools):
            self.inputs.append(conversation)
            return AgentRunResult(
                answer="The EP-42 findings imply offline search demand.",
                citations=tuple(tools.evidence.values()) if len(self.inputs) == 1 else (),
                release_id=tools.release.knowledge_release_id,
                provider="test",
                model="history-boundary",
            )

    runner = Runner()
    conversation_id = None
    for prompt in ("EP-42 findings", "Summarize that conclusion"):
        with client.app.state.disciplinary_agent_scope() as app:
            app._runner = runner
            result = app.run_turn(
                user_id=UUID(identity["user"]["user_id"]),
                conversation_id=conversation_id,
                prompt=prompt,
                idempotency_key=str(uuid4()),
                reference_knowledge_base_id=UUID(kb["id"]),
            )
            conversation_id = result.conversation.conversation_id
    mutation(client, "delete", f"/api/shared-knowledge-bases/{kb['id']}/documents/{doc['id']}")
    with client.app.state.disciplinary_agent_scope() as app:
        app._runner = runner
        app.run_turn(
            user_id=UUID(identity["user"]["user_id"]),
            conversation_id=conversation_id,
            prompt="Continue",
            idempotency_key=str(uuid4()),
        )
    assert all("EP-42" not in turn.assistant_message.content for turn in runner.inputs[-1])


def test_removed_source_is_omitted_from_model_canvas_context_without_deleting_user_map():
    from types import SimpleNamespace

    from qunxue_api.adapters.research_agent.shared_knowledge import _PrivateKnowledgeTools

    citation = f"material:{uuid4()}:segment-one"
    references = SimpleNamespace(removed_citation_ids={citation})
    tools = KnowledgeToolRegistry(EmptyCatalog())
    tools.enable_research_map(
        {
            "nodes": [
                {"id": "finding", "kind": "claim", "title": "EP-SECRET", "citation_ids": [citation]}
            ],
            "relations": [],
        }
    )
    tools.private_knowledge = _PrivateKnowledgeTools(references, uuid4(), uuid4(), tools)
    assert tools.research_map_prompt_context["nodes"] == []
    assert tools.research_map["nodes"][0]["title"] == "EP-SECRET"
