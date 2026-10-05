import asyncio
import json
from pathlib import Path
from uuid import UUID

from openai import AsyncOpenAI
from pydantic import BaseModel, ConfigDict, Field
from pydantic_ai import Agent
from pydantic_ai.providers.openai import OpenAIProvider
from pydantic_ai.usage import UsageLimits

from qunxue_api.adapters.model.metering import MeteredOpenAIChatModel

from .pydantic_runner import _is_deepseek_flash

_INSTRUCTIONS = (Path(__file__).parent / "prompts" / "conversation_summary.md").read_text()


class SummarySource(BaseModel):
    model_config = ConfigDict(extra="forbid")
    conversation_id: UUID
    message_id: UUID
    quote: str = Field(min_length=1, max_length=400)


class SummaryCard(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1, max_length=80)
    description: str = Field(min_length=1, max_length=240)
    prompt: str = Field(min_length=1, max_length=1200)
    sources: list[SummarySource] = Field(min_length=1, max_length=4)


class ActivitySummary(BaseModel):
    model_config = ConfigDict(extra="forbid")
    summary: str = Field(default="", max_length=1000)
    summary_sources: list[SummarySource] = Field(default_factory=list, max_length=8)
    cards: list[SummaryCard] = Field(default_factory=list, max_length=3)


class PydanticConversationSummarizer:
    def __init__(self, *, base_url, api_key, model, timeout_seconds=30, extra_headers=None):
        self.base_url, self.api_key, self.model = base_url, api_key, model
        self.timeout, self.headers = timeout_seconds, extra_headers

    def __call__(self, batch):
        return asyncio.run(self.summarize(batch))

    async def summarize(self, batch):
        payload = json.dumps(
            {"sources": batch.sources, "omitted_messages": batch.omitted_messages},
            ensure_ascii=False,
        )
        if len((_INSTRUCTIONS + payload).encode()) > 22000:
            raise ValueError("context_summary_input_budget_exceeded")
        async with AsyncOpenAI(
            base_url=self.base_url, api_key=self.api_key, max_retries=0, timeout=self.timeout
        ) as client:
            model = MeteredOpenAIChatModel(
                self.model, provider=OpenAIProvider(openai_client=client), require_billing=True
            )
            settings = {"timeout": self.timeout, "max_tokens": 1800}
            if _is_deepseek_flash(base_url=self.base_url, model=self.model):
                settings["extra_body"] = {"thinking": {"type": "disabled"}}
            if self.headers:
                settings["extra_headers"] = self.headers
            agent = Agent(
                model,
                output_type=ActivitySummary,
                instructions=_INSTRUCTIONS,
                retries=0,
                model_settings=settings,
            )
            result = await agent.run(
                payload, usage_limits=UsageLimits(request_limit=1, tool_calls_limit=0)
            )
            return (
                result.output.model_dump(mode="json"),
                result.usage.input_tokens,
                result.usage.output_tokens,
            )
