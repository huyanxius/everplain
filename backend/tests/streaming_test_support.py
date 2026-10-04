"""Synthetic provider wire fixtures for adapters that always request SSE."""

import json

import httpx


def chat_sse(completion):
    base = {"id": completion.get("id", "synthetic-stream"),
            "model": completion.get("model", "synthetic"),
            "created": completion.get("created", 1), "object": "chat.completion.chunk"}
    if "service_tier" in completion:
        base["service_tier"] = completion["service_tier"]
    choices = completion.get("choices", [])
    deltas = []
    for i, choice in enumerate(choices):
        delta = dict(choice.get("message", {}))
        if "tool_calls" in delta:
            delta["tool_calls"] = [{"index": n, **tool}
                                   for n, tool in enumerate(delta["tool_calls"])]
        deltas.append({"index": choice.get("index", i), "delta": delta, "finish_reason": None})
    events = [{**base, "choices": deltas}, {**base, "choices": [
        {"index": c.get("index", i), "delta": {}, "finish_reason": c.get("finish_reason", "stop")}
        for i, c in enumerate(choices)
    ]}]
    if completion.get("usage") is not None:
        events.append({**base, "choices": [], "usage": completion["usage"]})
    return ("".join("data: " + json.dumps(e) + "\n\n" for e in events)
            + "data: [DONE]\n\n").encode()


def chat_http_response(completion, **kwargs):
    return httpx.Response(200, content=chat_sse(completion),
                          headers={"content-type": "text/event-stream"}, **kwargs)
