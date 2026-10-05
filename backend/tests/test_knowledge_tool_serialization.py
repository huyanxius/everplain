"""Real SDK dispatch must not race tools on one owned SQLite Session."""

import json
import threading
import time
from types import SimpleNamespace
from uuid import UUID

import pytest
from pydantic_ai.models.function import DeltaToolCall, FunctionModel
from test_research_material_api import _authenticate
from test_shared_knowledge_agent import upload
from test_shared_knowledge_api import create_library

from qunxue_api.adapters.research_agent.catalog_tools import KnowledgeToolRegistry
from qunxue_api.adapters.research_agent.pydantic_runner import PydanticAIKnowledgeRunner
from qunxue_api.adapters.research_agent.shared_knowledge import SharedKnowledgeReferences


class EmptyCatalog:
    def current_release(self, **kwargs):
        raise LookupError


@pytest.mark.parametrize("mode", ["read", "mixed", "search"])
def test_knowledge_tools_share_sqlite_session_without_concurrent_calls(plain_client, mode):
    client = plain_client
    identity = _authenticate(client)
    kb = create_library(client)
    docs = [upload(client, kb["id"], f"课堂记录标记 QX-A{index}") for index in range(3)]
    user = UUID(identity["user"]["user_id"])
    lock = threading.Lock()
    active = maximum = 0
    calls = []
    events = []

    with client.app.state.shared_knowledge_scope() as application:
        # Same shared Session/repository wiring as disciplinary_agent_scope.
        application.repository.session.connection()
        references = SharedKnowledgeReferences(application, SimpleNamespace(
            _embedding_model="existing-model"
        ))
        tools = KnowledgeToolRegistry(EmptyCatalog())
        references.bind_owned(user_id=user, tools=tools)

        def track(name):
            original = getattr(tools, name)

            def invoke(*args, **kwargs):
                nonlocal active, maximum
                with lock:
                    active += 1
                    maximum = max(maximum, active)
                    calls.append((name, threading.get_ident()))
                try:
                    # Widen real SQL overlap, without replacing any database operation.
                    time.sleep(0.04)
                    return original(*args, **kwargs)
                finally:
                    with lock:
                        active -= 1

            setattr(tools, name, invoke)

        for name in ("search_knowledge", "read_knowledge_entry", "read_sources",
                     "browse_knowledge_directory"):
            track(name)

        async def model_stream(messages, info):
            if not calls:
                if mode == "mixed":
                    batch = [
                        ("browse_knowledge_directory", {}),
                        ("read_knowledge_entry", {"knowledge_id": docs[0]["id"]}),
                        ("read_sources", {"source_ids": []}),
                    ]
                elif mode == "search":
                    batch = [
                        ("search_knowledge", {"query": "课堂记录标记"}),
                        ("read_knowledge_entry", {"knowledge_id": docs[0]["id"]}),
                        ("browse_knowledge_directory", {}),
                    ]
                else:
                    batch = [("read_knowledge_entry", {"knowledge_id": doc["id"]}) for doc in docs]
                yield {
                    index: DeltaToolCall(name=name, json_args=json.dumps(arguments),
                                         tool_call_id=f"call-{index}")
                    for index, (name, arguments) in enumerate(batch)
                }
            else:
                yield "已读取资料。"

        runner = PydanticAIKnowledgeRunner(
            base_url="http://model-unconfigured.invalid", api_key=None,
            model="unconfigured-model-fallback", timeout_seconds=30, model_api_mock=True,
        )
        with runner._agent.override(model=FunctionModel(stream_function=model_stream)):
            result = runner.run_stream(
                prompt="请逐项读取这些知识库资料", conversation=(), tools=tools,
                on_delta=lambda delta: None, on_tool_event=events.append,
            )

    assert maximum == 1, f"shared SQLite Session tools overlapped: {calls}"
    assert len(calls) == 3
    assert result.answer == "已读取资料。"
    assert len([event for event in events if event.phase == "finished"]) == 3
    assert not [event for event in events if event.phase == "failed"]
    if mode == "read":
        assert len(result.citations) == 3


def test_serializing_shared_session_tools_does_not_disable_web_parallelism():
    runner = PydanticAIKnowledgeRunner(
        base_url="http://model-unconfigured.invalid", api_key=None,
        model="unconfigured-model-fallback", timeout_seconds=30, model_api_mock=True,
    )
    tools = runner._agent._function_toolset.tools
    for name in ("search_knowledge", "read_knowledge_entry", "read_sources",
                 "browse_knowledge_directory"):
        assert tools[name].sequential is True
    assert tools["search_web"].sequential is False
    assert tools["read_web_page"].sequential is False
