"""Real private-tool paths stay bounded as unrelated library documents increase."""

import asyncio
import json
from types import SimpleNamespace
from uuid import UUID

import httpx
import pytest
from openai import AsyncOpenAI
from pydantic_ai import Agent, RunContext
from pydantic_ai.messages import ModelMessagesTypeAdapter, ModelRequest, UserPromptPart
from pydantic_ai.models import ModelRequestParameters
from pydantic_ai.providers.openai import OpenAIProvider
from test_web_responses_pipeline import stream_response

from qunxue_api.adapters.model import ModelEndpoint, ModelRouteExecutor
from qunxue_api.adapters.model.metering import MeteredOpenAIChatModel
from qunxue_api.adapters.research_agent.catalog_tools import KnowledgeToolRegistry
from qunxue_api.adapters.research_agent.pydantic_runner import (
    AgentModelRouteError,
    _RetryingOpenAIChatModel,
    _RetryingOpenAIResponsesModel,
)
from qunxue_api.adapters.research_agent.shared_knowledge import SharedKnowledgeReferences


class EmptyCatalog:
    def current_release(self, **kwargs):
        raise LookupError


class Repository:
    def vector_cache(self, documents):
        return SimpleNamespace(get_many=lambda chunks, model: [[0.25, 0.75] for _ in chunks])

    def commit(self):
        pass


def private_tools(count):
    user = UUID(int=1)
    kb = SimpleNamespace(id=UUID(int=2), owner_user_id=user, name="个人资料库")
    documents = [
        SimpleNamespace(
            id=UUID(int=index + 10), owner_user_id=user, parse_id=UUID(int=index + 10000),
            filename=f"bookmark-{index}.txt", content_hash="hash",
            segments=[{"segment_id": "s1", "content_hash": "hash",
                       "text": "死亡搁浅游戏资料", "locator": "网页正文"}],
            knowledge_status="ready", knowledge={"topics": []}, knowledge_error=None,
            index_status="ready", index_error=None,
        )
        for index in range(count)
    ]
    app = SimpleNamespace(
        repository=Repository(), libraries=lambda user: [kb],
        documents=lambda *args, **kwargs: documents,
    )
    references = SharedKnowledgeReferences(app, SimpleNamespace(_embedding_model="existing-model"))
    tools = KnowledgeToolRegistry(EmptyCatalog())
    references.bind_owned(user_id=user, tools=tools)
    return tools


@pytest.mark.parametrize("count", [24, 100, 1000])
def test_search_and_read_do_not_repeat_entire_index_snapshot(count):
    tools = private_tools(count)
    directory = tools.browse_knowledge_directory()
    hits = tools.search_knowledge("死亡搁浅")
    result = tools.read_knowledge_entry(directory[0]["knowledge_id"])
    assert len(directory) == 24
    assert len(hits) == 5
    assert result["content"] == "死亡搁浅游戏资料"
    assert result["citation_ids"] and result["source_ids"]
    assert result["next_knowledge_id"] is None
    for item in [*hits, result]:
        coverage = item["knowledge_index_coverage"]
        assert coverage["total_count"] == coverage["ready_count"] == count
        assert coverage["missing_count"] == 0
        assert not {"ready_document_ids", "ready_documents", "missing_documents"} & coverage.keys()
    assert len(json.dumps(hits, ensure_ascii=False).encode()) < 5000
    assert len(json.dumps(result, ensure_ascii=False).encode()) < 1500
    # UI/index repair retains the full diagnostic snapshot, including original IDs.
    assert len(tools.knowledge_index_coverage["ready_documents"]) == count


def test_real_responses_sdk_search_read_answer_with_one_thousand_documents():
    tools = private_tools(1000)
    document_id = tools.browse_knowledge_directory()[0]["knowledge_id"]
    calls = []

    def reply(request):
        calls.append(json.loads(request.content))
        if len(calls) <= 2:
            name = "search_knowledge" if len(calls) == 1 else "read_knowledge_entry"
            arguments = {"query": "死亡搁浅"} if len(calls) == 1 else {"knowledge_id": document_id}
            output = [{"type": "function_call", "id": f"fc_{len(calls)}",
                       "call_id": f"call_{len(calls)}", "name": name,
                       "arguments": json.dumps(arguments), "status": "completed"}]
        else:
            output = [{"type": "message", "id": "msg_final", "role": "assistant",
                       "status": "completed", "content": [{"type": "output_text",
                       "text": "OK", "annotations": []}]}]
        return stream_response(output, len(calls))

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(reply), trust_env=False) as http:
            provider = OpenAIProvider(openai_client=AsyncOpenAI(
                api_key="synthetic", base_url="https://synthetic.test/v1",
                http_client=http, max_retries=0,
            ))
            model = _RetryingOpenAIResponsesModel(
                "gpt-6-luna", provider=provider,
                route_executor=ModelRouteExecutor(
                    endpoints=(ModelEndpoint("primary", "https://synthetic.test/v1",
                                             "gpt-6-luna", None, 1),),
                    max_input_tokens=32000, max_retries=0,
                ),
            )
            agent = Agent(model, deps_type=KnowledgeToolRegistry)

            @agent.tool
            def search_knowledge(ctx: RunContext[KnowledgeToolRegistry], query: str) -> list[dict]:
                return ctx.deps.search_knowledge(query)

            @agent.tool
            def read_knowledge_entry(
                ctx: RunContext[KnowledgeToolRegistry], knowledge_id: str
            ) -> dict:
                return ctx.deps.read_knowledge_entry(knowledge_id)

            result = await agent.run("请查知识库中的死亡搁浅资料", deps=tools)
            assert result.output == "OK"

    asyncio.run(run())
    assert len(calls) == 3
    assert all(len(json.dumps(call).encode()) < 15000 for call in calls)
    assert tools.selected_evidence_ids


@pytest.mark.parametrize("repetitions, rejected", [(2000, False), (10000, True)])
def test_chat_budget_counts_tokens_and_still_rejects_oversize(monkeypatch, repetitions, rejected):
    captured = []

    async def request_once(model, messages, stream, settings, parameters):
        captured.append(settings)
        return SimpleNamespace(usage=None)

    monkeypatch.setattr(MeteredOpenAIChatModel, "_completions_create", request_once)

    async def run():
        async with httpx.AsyncClient(trust_env=False) as http:
            provider = OpenAIProvider(openai_client=AsyncOpenAI(
                api_key="synthetic", http_client=http, max_retries=0,
            ))
            model = _RetryingOpenAIChatModel(
                "gpt-6-luna", provider=provider,
                route_executor=ModelRouteExecutor(
                    endpoints=(ModelEndpoint("primary", "https://synthetic.test/v1",
                                             "gpt-6-luna", None, 1),),
                    max_input_tokens=32000, max_output_tokens=700, max_retries=0,
                ),
            )
            messages = [ModelRequest(parts=[UserPromptPart(
                content="中文研究证据。" * repetitions
            )])]
            assert len(ModelMessagesTypeAdapter.dump_json(messages)) > 32000
            operation = model._completions_create(
                messages, False, {}, ModelRequestParameters(),
            )
            if rejected:
                with pytest.raises(AgentModelRouteError) as caught:
                    await operation
                assert caught.value.code == "agent_input_limit"
            else:
                await operation

    asyncio.run(run())
    assert len(captured) == (0 if rejected else 1)
    if captured:
        assert captured[0]["max_tokens"] == 700
