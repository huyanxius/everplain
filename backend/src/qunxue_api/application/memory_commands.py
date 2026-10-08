"""Owned memory edits and forgetting, including post-commit overview invalidation."""

from collections.abc import Callable, Iterator
from contextlib import AbstractContextManager, contextmanager
from uuid import UUID

from qunxue_api.modules.agent_memory import (
    Memory,
    MemoryConflict,
    MemoryNotFound,
    MemoryService,
)


class MemoryCommandError(Exception):
    """A scoped mutation failure, distinct from post-commit invalidation errors."""

    def __init__(self, reason: Exception):
        super().__init__(str(reason))
        self.reason = reason


class MemoryCommands:
    def __init__(
        self,
        service_scope: Callable[[], AbstractContextManager[MemoryService]],
        invalidate: Callable[[UUID, UUID | None], None],
    ):
        self._service_scope = service_scope
        self._invalidate = invalidate

    @contextmanager
    def _mutation(self) -> Iterator[MemoryService]:
        try:
            with self._service_scope() as memory:
                yield memory
        except (MemoryNotFound, MemoryConflict, ValueError) as error:
            raise MemoryCommandError(error) from error

    def update(
        self,
        user_id: UUID,
        memory_id: UUID,
        *,
        content: str,
        expected_version: int,
        idempotency_key: str,
    ) -> Memory:
        with self._mutation() as memory:
            existing = memory.repository.get(user_id, memory_id)
            updated = memory.save(
                user_id=user_id,
                task_id=existing.task_id,
                key=existing.key,
                memory_id=memory_id,
                content=content,
                expected_version=expected_version,
                origin="manual",
                idempotency_key=idempotency_key,
            )
        if (updated.content, updated.origin) != (existing.content, existing.origin):
            self._invalidate(user_id, existing.task_id)
        return updated

    def delete(self, user_id: UUID, memory_id: UUID, expected_version: int) -> None:
        with self._mutation() as memory:
            existing = memory.repository.get(user_id, memory_id)
            memory.repository.delete(user_id, memory_id, expected_version)
        self._invalidate(user_id, existing.task_id)
