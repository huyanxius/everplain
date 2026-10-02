from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field


class ExternalAgentConnectionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=80)
    library_ids: list[UUID] = Field(min_length=1, max_length=50)
    expires_at: AwareDatetime


class ExternalAgentConnectionResponse(BaseModel):
    connection_id: UUID
    name: str
    library_ids: list[UUID]
    created_at: datetime
    expires_at: datetime
    revoked_at: datetime | None
    status: Literal["active", "expired", "revoked"]


class ExternalAgentConnectionList(BaseModel):
    connections: list[ExternalAgentConnectionResponse]
    mcp_endpoint: str = "/api/mcp"


class ExternalAgentConnectionGrant(BaseModel):
    connection: ExternalAgentConnectionResponse
    secret: str
    mcp_endpoint: str = "/api/mcp"
