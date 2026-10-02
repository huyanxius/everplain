from datetime import datetime
from uuid import UUID

from pydantic import BaseModel

from qunxue_api.modules.research_exchange import (
    AuditActorType,
    ResearchAuditEvent,
    ResearchAuditEventType,
)


class ResearchAuditEventResponse(BaseModel):
    event_id: UUID
    event_type: ResearchAuditEventType
    object_type: str
    object_id: str
    object_version: str | None
    actor_type: AuditActorType
    actor_id: str | None
    payload: dict[str, object]
    occurred_at: datetime

    @classmethod
    def from_domain(cls, event: ResearchAuditEvent) -> "ResearchAuditEventResponse":
        return cls(
            event_id=event.event_id,
            event_type=event.event_type,
            object_type=event.object_type,
            object_id=event.object_id,
            object_version=event.object_version,
            actor_type=event.actor_type,
            actor_id=event.actor_id,
            payload=event.payload,
            occurred_at=event.occurred_at,
        )


class ResearchAuditEventListResponse(BaseModel):
    task_id: UUID
    items: list[ResearchAuditEventResponse]
