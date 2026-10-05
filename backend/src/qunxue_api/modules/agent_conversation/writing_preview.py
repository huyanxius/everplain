"""Strict allowlist for the dedicated ephemeral writing-preview event channel."""

import re
from uuid import UUID

_FIELDS = {
    "type", "run_id", "call_id", "document_id", "base_version", "selection_start",
    "selection_end", "sequence", "replacement_text", "state", "revision_id", "error_code",
}
_REQUIRED = _FIELDS - {"revision_id", "error_code"}


def validated_writing_preview(payload):
    if not isinstance(payload, dict) or set(payload) - _FIELDS or _REQUIRED - set(payload):
        raise ValueError("invalid_writing_preview_fields")
    result = {key: value for key, value in payload.items() if value is not None}
    if result.get("type") != "writing_preview":
        raise ValueError("invalid_writing_preview_type")
    for key in ("run_id", "document_id"):
        if not isinstance(result.get(key), str):
            raise ValueError("invalid_writing_preview_identity")
        UUID(result[key])
    for key in ("base_version", "selection_start", "selection_end", "sequence"):
        value = result[key]
        if not isinstance(value, int) or isinstance(value, bool) or value < 0:
            raise ValueError("invalid_writing_preview_number")
    if (result["base_version"] < 1 or result["sequence"] < 1
            or result["selection_end"] < result["selection_start"]):
        raise ValueError("invalid_writing_preview_range")
    call_id, text = result["call_id"], result["replacement_text"]
    if not isinstance(call_id, str) or not 1 <= len(call_id) <= 200:
        raise ValueError("invalid_writing_preview_call")
    if not isinstance(text, str) or len(text) > 30000:
        raise ValueError("invalid_writing_preview_text")
    text.encode("utf-16-le")
    state = result["state"]
    if state == "ready":
        if not isinstance(result.get("revision_id"), str):
            raise ValueError("invalid_writing_preview_revision")
        UUID(result["revision_id"])
        if "error_code" in result:
            raise ValueError("invalid_writing_preview_ready")
    elif state == "streaming":
        if "revision_id" in result or "error_code" in result:
            raise ValueError("invalid_writing_preview_streaming")
    elif state == "invalidated":
        error = result.get("error_code", "")
        if text or "revision_id" in result or not isinstance(error, str) or not re.fullmatch(
            r"[a-z_]{1,80}", error,
        ):
            raise ValueError("invalid_writing_preview_invalidation")
    else:
        raise ValueError("invalid_writing_preview_state")
    return result
