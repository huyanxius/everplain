"""Allowlisted tool-argument snapshots. Raw JSON never leaves this adapter."""

import json
import re
from dataclasses import dataclass, field

from qunxue_api.modules.agent_conversation import AgentWritingPreviewEvent

_FIELDS = {
    "expected_version",
    "original_text",
    "replacement_text",
    "selection_start",
    "selection_end",
}
_MAX_ARGS = 1_000_000  # Bounded original text plus JSON escape expansion.


class InvalidPreviewArguments(ValueError):
    pass


def _string(raw, index):
    """Decode only complete codepoints, withholding incomplete escape/surrogate tails."""
    assert raw[index] == '"'
    index += 1
    result = []
    escapes = {
        '"': '"',
        "\\": "\\",
        "/": "/",
        "b": "\b",
        "f": "\f",
        "n": "\n",
        "r": "\r",
        "t": "\t",
    }
    while index < len(raw):
        char = raw[index]
        if char == '"':
            return "".join(result), index + 1, True
        if char == "\\":
            if index + 1 >= len(raw):
                break
            escape = raw[index + 1]
            if escape in escapes:
                result.append(escapes[escape])
                index += 2
                continue
            if escape != "u":
                raise InvalidPreviewArguments("invalid_escape")
            digits = raw[index + 2 : index + 6]
            if re.search(r"[^0-9a-fA-F]", digits):
                raise InvalidPreviewArguments("invalid_unicode")
            if len(digits) < 4:
                break
            value = int(digits, 16)
            consumed = 6
            if 0xD800 <= value <= 0xDBFF:
                tail = raw[index + 6 : index + 12]
                if len(tail) < 6:
                    if not "\\u".startswith(tail[:2]):
                        raise InvalidPreviewArguments("invalid_surrogate")
                    break
                if not re.fullmatch(r"\\u[0-9a-fA-F]{4}", tail):
                    raise InvalidPreviewArguments("invalid_surrogate")
                low = int(tail[2:], 16)
                if not 0xDC00 <= low <= 0xDFFF:
                    raise InvalidPreviewArguments("invalid_surrogate")
                value = 0x10000 + ((value - 0xD800) << 10) + low - 0xDC00
                consumed = 12
            elif 0xDC00 <= value <= 0xDFFF:
                raise InvalidPreviewArguments("invalid_surrogate")
            result.append(chr(value))
            index += consumed
            continue
        if ord(char) < 32 or 0xD800 <= ord(char) <= 0xDFFF:
            raise InvalidPreviewArguments("invalid_character")
        result.append(char)
        index += 1
    return "".join(result), index, False


def parse_preview_arguments(raw):
    """Strict flat JSON scanner; duplicate or unknown fields always fail closed."""
    fields, seen = {}, set()
    index, need_key = 0, True
    replacement, replacement_complete = None, False

    def space(i):
        while i < len(raw) and raw[i] in " \r\n\t":
            i += 1
        return i

    index = space(index)
    if index == len(raw):
        return fields, replacement, replacement_complete, False
    if raw[index] != "{":
        raise InvalidPreviewArguments("object_required")
    index += 1
    while True:
        index = space(index)
        if index == len(raw):
            return fields, replacement, replacement_complete, False
        if raw[index] == "}":
            if not need_key:
                raise InvalidPreviewArguments("trailing_comma")
            if space(index + 1) != len(raw):
                raise InvalidPreviewArguments("trailing_data")
            return fields, replacement, replacement_complete, True
        if raw[index] != '"':
            raise InvalidPreviewArguments("key_required")
        key, index, complete = _string(raw, index)
        if not complete:
            return fields, replacement, replacement_complete, False
        if key not in _FIELDS or key in seen:
            raise InvalidPreviewArguments("unexpected_or_duplicate_field")
        seen.add(key)
        index = space(index)
        if index == len(raw):
            return fields, replacement, replacement_complete, False
        if raw[index] != ":":
            raise InvalidPreviewArguments("colon_required")
        index = space(index + 1)
        if index == len(raw):
            return fields, replacement, replacement_complete, False
        if raw[index] == '"':
            value, index, complete = _string(raw, index)
            if key not in {"original_text", "replacement_text"}:
                raise InvalidPreviewArguments("wrong_type")
            if key == "replacement_text":
                replacement, replacement_complete = value, complete
            if not complete:
                return fields, replacement, replacement_complete, False
        else:
            end = index
            while end < len(raw) and raw[end] not in ",} \r\n\t":
                end += 1
            token = raw[index:end]
            if end == len(raw):
                if token and not ("null".startswith(token) or re.fullmatch(r"-?\d*", token)):
                    raise InvalidPreviewArguments("invalid_value")
                return fields, replacement, replacement_complete, False
            if token == "null" and key in {"selection_start", "selection_end"}:
                value = None
            elif re.fullmatch(r"0|[1-9]\d*", token) and key in {
                "expected_version",
                "selection_start",
                "selection_end",
            }:
                value = int(token)
            else:
                raise InvalidPreviewArguments("wrong_type")
            index = end
        fields[key] = value
        index = space(index)
        if index == len(raw):
            return fields, replacement, replacement_complete, False
        if raw[index] == "}":
            if space(index + 1) != len(raw):
                raise InvalidPreviewArguments("trailing_data")
            return fields, replacement, replacement_complete, True
        if raw[index] != ",":
            raise InvalidPreviewArguments("separator_required")
        index += 1
        need_key = False


@dataclass
class _Call:
    raw: str = ""
    sequence: int = 0
    snapshot: str = ""
    binding: dict | None = None
    rejected: bool = False
    terminal: bool = False
    complete: bool = False
    fields: dict = field(default_factory=dict)


class WritingPreviewStream:
    def __init__(self, tools, callback, runtime_instructions):
        self.tools, self.callback = tools, callback
        self.runtime_instructions = runtime_instructions
        self.calls = {}
        self.ready_revision_ids = set()

    def append(self, call_id, args, *, initial=False):
        if self.callback is None or not call_id:
            return
        state = self.calls.setdefault(call_id, _Call())
        if state.terminal or state.rejected:
            return
        if initial and state.raw:
            self.invalidate(call_id, "writing_preview_duplicate_call")
            return
        if isinstance(args, dict):
            if state.raw:
                self.invalidate(call_id, "writing_preview_nonappend_args")
                return
            args = json.dumps(args, ensure_ascii=True)
        if args is None:
            return
        if not isinstance(args, str) or len(state.raw) + len(args) > _MAX_ARGS:
            self.invalidate(call_id, "writing_preview_invalid_arguments")
            return
        state.raw += args
        try:
            fields, replacement, replacement_complete, complete = parse_preview_arguments(state.raw)
            state.fields, state.complete = fields, complete
            if (
                complete
                and not {"expected_version", "original_text", "replacement_text"} <= fields.keys()
            ):
                raise InvalidPreviewArguments("missing_fields")
            if not {"expected_version", "original_text"} <= fields.keys() or replacement is None:
                return
            if ("selection_start" in fields) != ("selection_end" in fields) and not complete:
                return
            # Incomplete offset values cannot be interpreted as absent/null. A
            # complete original may uniquely prove the same anchor before offsets.
            resolver = getattr(self.tools, "writing_preview_target", None)
            if not callable(resolver):
                return
            try:
                binding = resolver(
                    fields,
                    replacement,
                    replacement_complete,
                    runtime_instructions=self.runtime_instructions,
                )
            except (ValueError, LookupError, UnicodeError):
                # A later offset may disambiguate repeated text, or metadata may
                # follow replacement_text. Never release text without proof.
                if state.binding is None:
                    # Target gating does not veto the final tool's semantic
                    # idempotency lookup. A cached exact revision can recover
                    # without releasing an unproven partial draft.
                    state.terminal = complete
                    return
                raise
            if state.binding is not None and any(
                state.binding[key] != binding[key]
                for key in (
                    "document_id",
                    "base_version",
                    "selection_start",
                    "selection_end",
                )
            ):
                raise InvalidPreviewArguments("changed_binding")
            state.binding = binding
            snapshot = binding["safe_replacement_text"]
            if not snapshot.startswith(state.snapshot):
                raise InvalidPreviewArguments("nonappend_replacement")
            if snapshot != state.snapshot:
                self._emit(call_id, state, "streaming", snapshot)
        except (ValueError, LookupError, UnicodeError):
            self.invalidate(call_id, "writing_preview_invalid_arguments")

    def validate_final(self, call_id, payload):
        state = self.calls.get(call_id)
        if state is not None and (
            state.rejected
            or not state.complete
            or state.fields
            != {
                key: value
                for key, value in payload.items()
                if value is not None or key in state.fields
            }
        ):
            raise InvalidPreviewArguments("streamed_arguments_invalid")

    def finish(self, call_id, payload, result):
        state = self.calls.get(call_id)
        if state is None or (state.terminal and state.rejected):
            return
        if result.get("error"):
            self.invalidate(call_id, str(result["error"]))
            return
        try:
            self.validate_final(call_id, payload)
            resolver = getattr(self.tools, "writing_preview_target", None)
            binding = resolver(
                payload,
                payload["replacement_text"],
                True,
                runtime_instructions=self.runtime_instructions,
                revision=result,
            )
            if state.binding is not None and any(
                state.binding[key] != binding[key]
                for key in (
                    "document_id",
                    "base_version",
                    "selection_start",
                    "selection_end",
                )
            ):
                raise InvalidPreviewArguments("final_binding_changed")
            state.binding = binding
            self._emit(
                call_id,
                state,
                "ready",
                payload["replacement_text"],
                revision_id=str(result["revision_id"]),
            )
        except (ValueError, LookupError, TypeError, KeyError, UnicodeError):
            self.invalidate(call_id, "writing_preview_final_binding_failed")

    def invalidate(self, call_id, error_code):
        state = self.calls[call_id]
        if state.terminal:
            return
        state.rejected = state.terminal = True
        if state.binding is not None:
            self._emit(call_id, state, "invalidated", "", error_code=error_code)

    def interrupt(self, error_code):
        # The enclosing turn failure/interruption marks these drafts incomplete.
        # Keep the last safe snapshot available, with no revision or consent.
        for state in self.calls.values():
            if not state.terminal:
                state.rejected = state.terminal = True

    def _emit(self, call_id, state, status, snapshot, **extras):
        state.sequence += 1
        state.snapshot = snapshot
        self.callback(
            AgentWritingPreviewEvent(
                call_id=call_id,
                sequence=state.sequence,
                state=status,
                replacement_text=snapshot,
                **{
                    key: state.binding[key]
                    for key in (
                        "document_id",
                        "base_version",
                        "selection_start",
                        "selection_end",
                    )
                },
                **extras,
            )
        )
        if status == "ready":
            self.ready_revision_ids.add(extras["revision_id"])
            state.terminal = True
