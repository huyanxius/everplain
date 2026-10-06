"""Pydantic stream events to visible body and writing preview, without run execution."""

from collections.abc import AsyncIterable, Callable

from pydantic_ai import AgentStreamEvent, PartDeltaEvent, PartStartEvent, RunContext
from pydantic_ai.messages import TextPart, TextPartDelta, ToolCallPart, ToolCallPartDelta

from qunxue_api.modules.agent_conversation import AgentInterrupted

from .writing_preview import WritingPreviewStream


class VisibleTextStream:
    """Forward answer text while removing model reasoning tags across chunks."""

    _OPEN = "<thinking>"
    _CLOSE = "</thinking>"

    def __init__(self, on_text: Callable[[str], None]) -> None:
        self._on_text = on_text
        self._buffer = ""
        self._in_thinking = False

    def push(self, chunk: str) -> None:
        self._buffer += chunk
        self._drain()

    def finish(self) -> None:
        remaining, self._buffer = self._buffer, ""
        if not self._in_thinking and remaining:
            self._on_text(remaining)

    def _drain(self) -> None:
        while self._buffer:
            marker = self._CLOSE if self._in_thinking else self._OPEN
            index = self._buffer.find(marker)
            if index >= 0:
                visible = self._buffer[:index] if not self._in_thinking else ""
                self._buffer = self._buffer[index + len(marker) :]
                self._in_thinking = not self._in_thinking
                if visible:
                    self._on_text(visible)
                continue
            # Hold only a real split-marker prefix, not an arbitrary nine
            # characters of ordinary body on every stream/error boundary.
            keep = next((size for size in range(len(marker) - 1, 0, -1)
                         if self._buffer.endswith(marker[:size])), 0)
            visible = self._buffer[:-keep] if keep else self._buffer
            self._buffer = self._buffer[-keep:] if keep else ""
            if not self._in_thinking and visible:
                self._on_text(visible)
            break


def visible_text(answer: str) -> str:
    chunks: list[str] = []
    stream = VisibleTextStream(chunks.append)
    stream.push(answer)
    stream.finish()
    return "".join(chunks)


class AgentEventBridge:
    """One bridge per run; SDK part indexes are scoped to each response step."""

    def __init__(self, *, visible_stream: VisibleTextStream,
                 writing_preview: WritingPreviewStream,
                 is_cancelled: Callable[[], bool] | None = None) -> None:
        self.visible_stream = visible_stream
        self.writing_preview = writing_preview
        self.is_cancelled = is_cancelled

    async def handle(
        self, _: RunContext,
        events: AsyncIterable[AgentStreamEvent],
    ) -> None:
        parts = {}  # SDK indexes restart for every model-response step.
        async for event in events:
            if self.is_cancelled is not None and self.is_cancelled():
                raise AgentInterrupted("Agent run was interrupted during model stream")
            if isinstance(event, PartStartEvent) and isinstance(event.part, ToolCallPart):
                part = event.part
                parts[event.index] = part
                if part.tool_name == "propose_writing_edit":
                    self.writing_preview.append(part.tool_call_id, part.args, initial=True)
            elif (
                isinstance(event, PartDeltaEvent)
                and isinstance(event.delta, ToolCallPartDelta)
            ):
                part = parts.get(event.index)
                if isinstance(part, ToolCallPart):
                    delta = event.delta
                    changed = delta.apply(part)
                    if (changed.tool_call_id != part.tool_call_id
                            or changed.tool_name != part.tool_name):
                        if part.tool_name == "propose_writing_edit":
                            self.writing_preview.invalidate(
                                part.tool_call_id, "writing_preview_identity_changed",
                            )
                            self.writing_preview.append(changed.tool_call_id, "[]", initial=True)
                    elif part.tool_name == "propose_writing_edit":
                        self.writing_preview.append(part.tool_call_id, delta.args_delta)
                    parts[event.index] = changed
            if isinstance(event, PartStartEvent) and isinstance(event.part, TextPart):
                if event.part.content:
                    self.visible_stream.push(event.part.content)
            elif (
                isinstance(event, PartDeltaEvent)
                and isinstance(event.delta, TextPartDelta)
                and event.delta.content_delta
            ):
                self.visible_stream.push(event.delta.content_delta)
