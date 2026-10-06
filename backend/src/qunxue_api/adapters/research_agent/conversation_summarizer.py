import asyncio
import json
from pathlib import Path
from uuid import UUID

from openai import APIConnectionError, APIStatusError, APITimeoutError, AsyncOpenAI
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from pydantic_ai import Agent
from pydantic_ai.exceptions import (
    ModelHTTPError,
    UnexpectedModelBehavior,
    UsageLimitExceeded,
    UserError,
)
from pydantic_ai.providers.openai import OpenAIProvider
from pydantic_ai.usage import UsageLimits

from qunxue_api.adapters.model.metering import MeteredOpenAIChatModel, current_operation
from qunxue_api.modules.agent_conversation import ContextSummaryGenerationFailure

from .pydantic_runner import _is_deepseek_flash, _responses_input_token_estimate

_INSTRUCTIONS = (Path(__file__).parent / "prompts" / "conversation_summary.md").read_text()
_OUTPUT_TOKENS = 1800


def _generation_failure(error: Exception) -> ContextSummaryGenerationFailure:
    current, seen = error, set()
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        if isinstance(current, (APIStatusError, ModelHTTPError)):
            status = current.status_code
            return ContextSummaryGenerationFailure(
                "http_error",
                http_status=status if type(status) is int and 100 <= status <= 599 else None,
            )
        if isinstance(current, APITimeoutError):
            return ContextSummaryGenerationFailure("timeout")
        if isinstance(current, APIConnectionError):
            return ContextSummaryGenerationFailure("transport_error")
        if isinstance(current, (UnexpectedModelBehavior, ValidationError)):
            return ContextSummaryGenerationFailure("invalid_output")
        if isinstance(current, UsageLimitExceeded):
            return ContextSummaryGenerationFailure("request_limit")
        if isinstance(current, UserError):
            return ContextSummaryGenerationFailure("model_config")
        current = current.__cause__ or current.__context__
    return ContextSummaryGenerationFailure("model_error")


class SummarySource(BaseModel):
    model_config = ConfigDict(extra="forbid")
    conversation_id: UUID
    message_id: UUID
    quote: str = Field(min_length=1, max_length=400)


class SummaryCard(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1, max_length=80)
    description: str = Field(min_length=1, max_length=240)
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

    def reservation_tokens(self, sources, omitted_messages=0):
        """Same bounded input, estimated with the existing context safety margin.

        o200k is an approximation for this configured proxy, not its certified
        tokenizer. Include instructions, source JSON and the actual output schema,
        then reserve the finite provider output cap. Provider usage remains truth.
        Cash/risk guards at the final wire boundary are unchanged.
        """
        serialized = json.dumps(
            {"instructions": _INSTRUCTIONS, "sources": sources,
             "omitted_messages": omitted_messages,
             "output_schema": ActivitySummary.model_json_schema()},
            ensure_ascii=False,
        )
        return _responses_input_token_estimate(serialized) + _OUTPUT_TOKENS

    def __call__(self, batch):
        try:
            return asyncio.run(self.summarize(batch))
        except Exception as error:
            raise _generation_failure(error) from error

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
            settings = {"timeout": self.timeout, "max_tokens": _OUTPUT_TOKENS}
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
            operation = current_operation()
            usage_known = not operation or not operation.independent_delivery or (
                operation.delivery_state.get("usage_status") == "known"
            )
            return (
                result.output.model_dump(mode="json"),
                result.usage.input_tokens if usage_known else None,
                result.usage.output_tokens if usage_known else None,
            )
