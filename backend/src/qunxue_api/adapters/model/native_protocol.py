"""Native wire admission: inline text/history and local function tools only."""

from qunxue_api.modules.billing import BillingContextMissing


def native_payload_facts(payload, api_type):
    if api_type == "gemini_generate_content":
        if payload.get("cachedContent"):
            raise BillingContextMissing("native stored prompts require separate accounting")
        for tool in payload.get("tools", ()):
            if set(tool) - {"functionDeclarations"}:
                raise BillingContextMissing("provider-paid native tools need a separate tariff")
        for message in payload.get("contents", ()):
            for part in message.get("parts", ()):
                if set(part) - {
                    "text",
                    "thought",
                    "thoughtSignature",
                    "functionCall",
                    "functionResponse",
                }:
                    raise BillingContextMissing("native multimodal budgets are not supported")
        config = payload.get("generationConfig", {})
        return config.get("maxOutputTokens"), config.get("thinkingConfig", {}).get("thinkingLevel")
    if api_type != "anthropic_messages":
        raise ValueError("unsupported native request protocol")
    if any(payload.get(key) for key in ("mcp_servers", "context_management", "container")):
        raise BillingContextMissing("native hosted tools/compaction need separate accounting")
    for tool in payload.get("tools", ()):
        if set(tool) - {
            "name",
            "description",
            "input_schema",
            "cache_control",
            "strict",
            "type",
        } or (tool.get("type") not in {None, "custom"}):
            raise BillingContextMissing("provider-paid native tools need a separate tariff")
    for message in payload.get("messages", ()):
        content = message.get("content")
        if isinstance(content, list):
            for part in content:
                kind = part.get("type")
                if kind not in {"text", "thinking", "redacted_thinking", "tool_use", "tool_result"}:
                    raise BillingContextMissing("native multimodal budgets are not supported")
                if (
                    kind == "tool_result"
                    and isinstance(part.get("content"), list)
                    and any(p.get("type") != "text" for p in part["content"])
                ):
                    raise BillingContextMissing("native multimodal tool results are not supported")
    return payload.get("max_tokens"), payload.get("output_config", {}).get("effort")
