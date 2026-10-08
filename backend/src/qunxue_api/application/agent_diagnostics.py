"""Content-free diagnostics for the Agent's output failure boundaries."""

import json
import sqlite3
from types import TracebackType
from uuid import UUID

from qunxue_api.modules.agent_conversation import AgentTerminalJournalFailure

_EVENTS = {
    "turn": "Agent turn failed",
    "terminal_journal": "Agent terminal journal transaction failed",
    "terminal_projection": "Agent terminal event projection failed",
    "terminal_fallback": "Agent terminal event could not be journaled",
}
_STORAGE_ERRORS = frozenset({
    sqlite3.Error, sqlite3.DatabaseError, sqlite3.IntegrityError,
    sqlite3.OperationalError, sqlite3.ProgrammingError, sqlite3.InterfaceError,
    sqlite3.DataError, sqlite3.InternalError, sqlite3.NotSupportedError,
})
# Fixed labels, never an exception's filename, function name or source line.
_FRAME_MODULES = frozenset({
    "qunxue_api.api.routes.agent",
    "qunxue_api.application.disciplinary_agent",
    "qunxue_api.modules.agent_conversation.service",
    "qunxue_api.adapters.sqlite.agent_conversation_repository",
})


def _slot(error, name):
    return BaseException.__dict__[name].__get__(error)


def _uuid(value):
    if type(value) is not UUID:
        return None
    number = value.int
    if type(number) is not int or not 0 <= number < 1 << 128:
        return None
    return str(UUID(int=number))


def _attempt_id(value):
    if type(value) is not str or len(value) != 36:
        return None
    try:
        normalized = str(UUID(value))
    except ValueError:
        return None
    return normalized if normalized == value else None


def _category(error):
    current, seen = error, set()
    for _ in range(5):
        if not isinstance(current, BaseException) or id(current) in seen:
            break
        seen.add(id(current))
        if any(type(current) is kind for kind in _STORAGE_ERRORS):
            return "storage_error"
        cause = _slot(current, "__cause__")
        current = cause if cause is not None else _slot(current, "__context__")
    return "terminal_journal_error" if type(error) is AgentTerminalJournalFailure else "unknown"


def _frames(error):
    frames = []
    traceback = _slot(error, "__traceback__")
    for _ in range(64):
        if type(traceback) is not TracebackType:
            break
        module = traceback.tb_frame.f_globals.get("__name__")
        line = traceback.tb_lineno
        if type(module) is str and module in _FRAME_MODULES and type(line) is int:
            frames.append({"module": module, "line": line})
        traceback = traceback.tb_next
    return frames[-4:]


def log_agent_failure(
    logger, phase, error, *, run_id=None, conversation_id=None, attempt_id=None,
):
    """Best effort only: no exception objects, arbitrary text or traceback formatting."""
    try:
        phase = phase if type(phase) is str and phase in _EVENTS else "unknown"
        payload = {
            "phase": phase,
            "category": _category(error),
            "run_id": _uuid(run_id),
            "conversation_id": _uuid(conversation_id),
            "attempt_id": _attempt_id(attempt_id),
            "frames": _frames(error),
        }
        logger.error(
            "%s %s", _EVENTS.get(phase, "Agent operation failed"),
            json.dumps(payload, sort_keys=True),
            exc_info=False, stack_info=False, stacklevel=2,
        )
    except Exception:
        # Diagnostics, including a failing log sink, cannot change the outcome.
        pass
