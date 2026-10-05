"""Native receipts: inclusive totals, explicit cache evidence, one cumulative attempt."""

from collections.abc import Mapping

from pydantic_ai.usage import RequestUsage

from qunxue_api.modules.billing import UnknownTokenUsage


def raw_native(value):
    if hasattr(value, "model_dump"):
        return value.model_dump(by_alias=True, exclude_none=True, exclude_unset=True)
    return value if isinstance(value, Mapping) else {}


def native_usage(raw, protocol, *, cache_omission_is_zero=False):
    """Return canonical OpenAI-shaped *facts*, without inventing absent counters."""

    def counter(key, *, cache=False):
        value = raw.get(key, 0 if cache and cache_omission_is_zero else None)
        if value is not None and (type(value) is not int or value < 0):
            raise UnknownTokenUsage(f"invalid native counter: {key}")
        return value

    if protocol == "anthropic_messages":
        ordinary, output = counter("input_tokens"), counter("output_tokens")
        read = counter("cache_read_input_tokens", cache=True)
        written = counter("cache_creation_input_tokens", cache=True)
        inputs = ordinary + read + written if None not in (ordinary, read, written) else None
        reasoning = None  # Anthropic output already includes thinking.
    elif protocol == "gemini_generate_content":
        inputs = counter("promptTokenCount")
        candidates, reasoning = counter("candidatesTokenCount"), counter("thoughtsTokenCount")
        total = counter("totalTokenCount")
        output = candidates + reasoning if None not in (candidates, reasoning) else None
        if None not in (inputs, output, total) and inputs + output != total:
            raise UnknownTokenUsage("native Google total contradicts input/output")
        read = counter("cachedContentTokenCount", cache=True)
        # Google supplies no cache-write counter on generateContent. Only a verified
        # route's explicit omission policy can establish zero for settlement.
        written = 0 if cache_omission_is_zero else None
    else:
        raise ValueError("unsupported native usage protocol")
    if None not in (inputs, read, written) and read + written > inputs:
        raise UnknownTokenUsage("native cache subsets exceed input")
    return {
        "input_tokens": inputs,
        "output_tokens": output,
        "input_tokens_details": {"cached_tokens": read, "cache_write_tokens": written},
        "output_tokens_details": {"reasoning_tokens": reasoning} if reasoning is not None else {},
    }


def native_usage_known(usage):
    return all(
        type(v) is int
        for v in (
            usage.get("input_tokens"),
            usage.get("output_tokens"),
            usage.get("input_tokens_details", {}).get("cached_tokens"),
            usage.get("input_tokens_details", {}).get("cache_write_tokens"),
        )
    )


class NativeUsageSnapshot:
    def __init__(self, protocol, *, cache_omission_is_zero=False):
        self.protocol = protocol
        self.cache_omission_is_zero = cache_omission_is_zero
        self.raw = {}
        self.receipt = {}
        self.terminal = False
        self.finish_reason = None
        self.invalid = False
        self.wire_observed = False

    def observe_wire(self, data):
        self.wire_observed = True
        try:
            self.accept(data)
        except (ValueError, TypeError, AttributeError):
            self.invalid = True

    def accept(self, value):
        data = raw_native(value)
        if self.terminal:
            if data.get("type") in {"message_start", "content_block_start", "content_block_delta"}:
                self.invalid = True
            if any(
                candidate.get("content", {}).get("parts")
                for candidate in data.get("candidates", ())
            ):
                self.invalid = True
            incoming = data.get("usageMetadata", data.get("usage", {}))
            if any(key in self.raw and self.raw[key] != val for key, val in incoming.items()):
                self.invalid = True
        if self.protocol == "anthropic_messages":
            kind = data.get("type")
            if kind == "message_start":
                data = data.get("message", {})
            if data.get("id"):
                self.receipt["id"] = data["id"]
            if data.get("model"):
                self.receipt["model"] = data["model"]
            if data.get("usage"):
                self.raw.update(data["usage"])
            reason = data.get("stop_reason") or data.get("delta", {}).get("stop_reason")
            if reason:
                self.finish_reason = (
                    "length"
                    if reason == "max_tokens"
                    else ("content_filter" if reason == "refusal" else reason)
                )
            self.terminal |= kind == "message_stop" or kind == "message" and bool(reason)
        else:
            if data.get("responseId"):
                self.receipt["id"] = data["responseId"]
            if data.get("modelVersion"):
                self.receipt["model"] = data["modelVersion"]
            if data.get("usageMetadata"):
                self.raw = data["usageMetadata"]
            for candidate in data.get("candidates", ()):
                if reason := candidate.get("finishReason"):
                    self.finish_reason = (
                        "length"
                        if reason == "MAX_TOKENS"
                        else "content_filter"
                        if reason in {"SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT"}
                        else reason
                    )
                    self.terminal = True
            if data.get("promptFeedback", {}).get("blockReason"):
                self.finish_reason, self.terminal = "content_filter", True
        try:
            native_usage(
                self.raw, self.protocol, cache_omission_is_zero=self.cache_omission_is_zero
            )
        except UnknownTokenUsage:
            self.invalid = True

    def canonical(self):
        try:
            usage = native_usage(
                self.raw, self.protocol, cache_omission_is_zero=self.cache_omission_is_zero
            )
        except UnknownTokenUsage:
            usage = {}
        return {**self.receipt, "usage": usage}

    @property
    def known(self):
        return self.terminal and not self.invalid and native_usage_known(self.canonical()["usage"])

    def sdk_usage(self):
        if not self.known:
            return RequestUsage()  # Not a settlement receipt; scope remains pending.
        raw = self.canonical()["usage"]
        return RequestUsage(
            input_tokens=raw["input_tokens"],
            output_tokens=raw["output_tokens"],
            cache_read_tokens=raw["input_tokens_details"]["cached_tokens"],
            cache_write_tokens=raw["input_tokens_details"]["cache_write_tokens"],
            details=raw["output_tokens_details"],
        )
