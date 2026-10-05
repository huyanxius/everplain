from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class ImportAttachmentResponse(BaseModel):
    id: str
    relative_path: str
    filename: str
    media_type: str
    size_bytes: int
    references: list[str] = Field(description="Percent-decoded local targets in the original note")
    url: str | None = Field(
        description="Owner-authenticated relative asset URL; null until the note is imported"
    )


class ImportItemResponse(BaseModel):
    id: str
    title: str
    filename: str
    source_url: str | None
    relative_path: str
    status: Literal["queued", "running", "imported", "updated", "duplicate", "failed"]
    document_id: str | None
    error: str | None
    attempts: int
    attachments: list[ImportAttachmentResponse] = Field(default_factory=list)


class ImportBatchResponse(BaseModel):
    id: str
    library_id: str
    source_type: str
    created_at: datetime
    items: list[ImportItemResponse]
    total: int
    finished: int
    imported: int
    updated: int = 0
    duplicates: int
    failed: int
    attachment_count: int = Field(
        default=0, description="Referenced attachments across batch items"
    )
    attachment_bytes: int = Field(
        default=0, description="Bytes of referenced attachments across items"
    )
    status: Literal["processing", "partial", "completed"]


class ImportBatchListResponse(BaseModel):
    items: list[ImportBatchResponse]
