"""Explicit model-only fallback; never synthesize research or execute tools."""

from collections.abc import AsyncIterator

from pydantic_ai.messages import ModelMessage, ModelResponse, TextPart, ToolCallPart
from pydantic_ai.models.function import AgentInfo, FunctionModel

MODEL_API_MOCK_NAME = "model-api-mock"
MODEL_API_MOCK_RESPONSE = (
    "模型 API 未配置；当前仅返回模型层的本地占位响应。"
    "本轮未生成真实模型回答或研究结论。请配置模型服务后重试。"
)


def _respond(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
    del messages
    if info.output_tools:
        # The planner's output tool is a typed result, not a business tool.
        # Return no plan rather than pretend research can run without a model.
        return ModelResponse(
            parts=[
                ToolCallPart(
                    info.output_tools[0].name,
                    {"request_type": "conversation", "title": ""},
                )
            ]
        )
    return ModelResponse(parts=[TextPart(MODEL_API_MOCK_RESPONSE)])


async def _stream(messages: list[ModelMessage], info: AgentInfo) -> AsyncIterator[str]:
    del messages, info
    yield MODEL_API_MOCK_RESPONSE


def unconfigured_model() -> FunctionModel:
    """Retain PydanticAI execution without a provider client or network calls.

    Unlike TestModel, this adapter never selects registered function tools. It
    cannot write memory, create documents, update maps, or fabricate web results.
    """
    return FunctionModel(
        _respond,
        stream_function=_stream,
        model_name=MODEL_API_MOCK_NAME,
    )
