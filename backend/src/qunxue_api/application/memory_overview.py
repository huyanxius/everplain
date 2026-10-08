"""A disposable reading aid, never a new memory or a conversation turn."""

import json
from collections import OrderedDict
from collections.abc import Callable, Iterator
from contextlib import AbstractContextManager, contextmanager, nullcontext
from dataclasses import dataclass
from hashlib import sha256
from threading import Lock
from uuid import UUID, uuid4

from qunxue_api.modules.agent_memory import Memory, MemoryConflict, MemoryNotFound


class MemoryOverviewUnavailable(Exception):
    pass


class MemoryOverviewStale(Exception):
    """The requested snapshot changed before the summary could be delivered."""


class MemoryOverviewBusy(Exception):
    pass


def memory_overview_fingerprint(items: tuple[Memory, ...]) -> bytes:
    # Scope versions and list order also change after settings or no-op
    # edits. Only identity, origin and content change the summary's meaning.
    return sha256(
        json.dumps(
            [
                (str(m.memory_id), m.origin, m.content)
                for m in sorted(items, key=lambda m: m.memory_id)
            ],
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8")
    ).digest()


@dataclass
class _OverviewEntry:
    fingerprint: bytes
    summary: str | None = None


class MemoryOverview:
    def __init__(
        self, generate: Callable[[tuple[Memory, ...]], str] | None = None, *, billing=None
    ):
        self.generate = generate
        self.billing = billing
        self._lock = Lock()
        self._active: set[UUID] = set()
        self._cache: OrderedDict[tuple[UUID, UUID | None], _OverviewEntry] = OrderedDict()

    def invalidate(self, user_id: UUID, task_id: UUID | None) -> None:
        with self._lock:
            self._cache.pop((user_id, task_id), None)

    def summarize(
        self,
        user_id: UUID,
        task_id: UUID | None,
        version: int,
        items: tuple[Memory, ...],
        *,
        before_delivery=None,
    ) -> str:
        if not items:
            self.invalidate(user_id, task_id)
            return ""
        fingerprint = memory_overview_fingerprint(items)
        key = (user_id, task_id)
        with self._lock:
            cached = self._cache.get(key)
            if (
                cached is not None
                and cached.fingerprint == fingerprint
                and cached.summary is not None
            ):
                self._cache.move_to_end(key)
                return cached.summary
            if cached is not None and cached.fingerprint != fingerprint:
                del self._cache[key]
            if self.generate is None:
                raise MemoryOverviewUnavailable("记忆概览暂不可用，仍可查看和编辑下方记录。")
            if user_id in self._active or len(self._active) >= 4:
                raise MemoryOverviewBusy("正在整理记忆，请稍后重试。")
            self._active.add(user_id)
            entry = _OverviewEntry(fingerprint)
            self._cache[key] = entry
            self._cache.move_to_end(key)
            while len(self._cache) > 64:
                self._cache.popitem(last=False)
        try:
            context = (
                self.billing.open(
                    user_id=user_id,
                    run_id=uuid4(),
                    payload={"fingerprint": fingerprint.hex()},
                    phase="memory_overview",
                )
                if self.billing
                else nullcontext()
            )
            with context as scope:
                summary = self.generate(items).strip()
                if not summary or len(summary) > 2000:
                    raise ValueError("invalid_memory_overview")
                with self._lock:
                    # A mutation can invalidate this placeholder while the model
                    # runs. Its old result must never repopulate a cleared scope.
                    if self._cache.get(key) is entry:
                        entry.summary = summary
                if before_delivery:
                    before_delivery()
                if scope:
                    scope.finish("success")
                return summary
        except Exception as error:
            with self._lock:
                if self._cache.get(key) is entry:
                    del self._cache[key]
            if isinstance(error, MemoryOverviewStale):
                raise
            raise MemoryOverviewUnavailable("概览暂未生成，可以先查看下方记忆记录。") from error
        finally:
            with self._lock:
                self._active.discard(user_id)


@dataclass(frozen=True)
class MemoryOverviewReader:
    """Identity-bound reads usable only within one short-lived read scope."""

    version: Callable[[], int]
    items: Callable[[], tuple[Memory, ...]]


@dataclass(frozen=True)
class MemoryOverviewResult:
    summary: str
    scope_version: int
    memory_count: int


class MemoryOverviewReadError(Exception):
    """Keep scoped read failures distinct from unscoped engine failures."""

    def __init__(self, reason: Exception):
        super().__init__(str(reason))
        self.reason = reason


class MemoryOverviewQuery:
    """Read and revalidate one owned snapshot before delivering its overview."""

    def __init__(
        self,
        read_scope: Callable[[UUID, UUID | None], AbstractContextManager[MemoryOverviewReader]],
        overview: MemoryOverview,
    ):
        self._read_scope = read_scope
        self._overview = overview

    @contextmanager
    def _read(self, user_id: UUID, task_id: UUID | None) -> Iterator[MemoryOverviewReader]:
        try:
            with self._read_scope(user_id, task_id) as reader:
                yield reader
        except (MemoryNotFound, MemoryConflict, ValueError) as error:
            raise MemoryOverviewReadError(error) from error

    def summarize(
        self, user_id: UUID, task_id: UUID | None, expected_version: int
    ) -> MemoryOverviewResult:
        try:
            with self._read(user_id, task_id) as reader:
                version = reader.version()
                if version != expected_version:
                    raise MemoryConflict("记忆已更新，请刷新后重新整理概览。")
                items = reader.items()
        except (MemoryOverviewBusy, MemoryOverviewUnavailable, MemoryOverviewStale) as error:
            # Initial read failures historically occur outside the engine's
            # delivery-error mapping. Keep that phase distinguishable to callers.
            raise MemoryOverviewReadError(error) from error

        # The first read scope is closed before model work. Paid results verify
        # before settlement; cache hits and empty scopes verify after returning.
        latest_version, validation_done = version, False

        def verify_snapshot():
            nonlocal latest_version, validation_done
            with self._read(user_id, task_id) as reader:
                latest_version = reader.version()
                if latest_version != version and memory_overview_fingerprint(
                    reader.items()
                ) != memory_overview_fingerprint(items):
                    self._overview.invalidate(user_id, task_id)
                    raise MemoryOverviewStale()
            validation_done = True

        summary = self._overview.summarize(
            user_id, task_id, version, items, before_delivery=verify_snapshot
        )
        if not validation_done:
            verify_snapshot()
        return MemoryOverviewResult(summary, latest_version, len(items))
