"""Visible body forwarding has no arbitrary tail holdback or reasoning leak."""

import pytest

from qunxue_api.adapters.research_agent.pydantic_runner import VisibleTextStream


@pytest.mark.parametrize("ending", ["success", "length", "eof", "error", "cancel"])
def test_every_terminal_boundary_preserves_received_ordinary_body(ending):
    chunks = []
    stream = VisibleTextStream(chunks.append)
    body = "abcdefghijklmnopqrstuvwxyz这是已经收到的正文。"
    stream.push(body)
    # All ordinary body is forwarded before any error or final frame.
    assert "".join(chunks) == body
    try:
        if ending in {"eof", "error", "cancel"}:
            raise RuntimeError(ending)
    except RuntimeError:
        pass
    finally:
        stream.finish()
    assert "".join(chunks) == body


@pytest.mark.parametrize("split", range(1, 10))
def test_split_reasoning_marker_is_suppressed_without_holding_plain_tail(split):
    chunks = []
    stream = VisibleTextStream(chunks.append)
    marker = "<thinking>"
    stream.push("原文" + marker[:split])
    assert "".join(chunks) == "原文"
    stream.push(marker[split:] + "internal reasoning must stay private")
    stream.finish()
    assert "".join(chunks) == "原文"


def test_thinking_end_resumes_visible_body_and_callback_error_cannot_repeat_tail():
    chunks = []

    def forward(body):
        chunks.append(body)
        if body == "尾段":
            raise RuntimeError("subscriber failed")

    stream = VisibleTextStream(forward)
    stream.push("<thinking>private</think")
    with pytest.raises(RuntimeError, match="subscriber failed"):
        stream.push("ing>尾段")
    stream.finish()
    assert chunks == ["尾段"]
