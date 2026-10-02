from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class ImportItemResponse(BaseModel):
    id: str
    title: str
    filename: str
    source_url: str | None
    relative_path: str
    status: Literal["queued", "running", "imported", "duplicate", "failed"]
    document_id: str | None
    error: str | None
    attempts: int


class ImportBatchResponse(BaseModel):
    id: str
    library_id: str
    source_type: str
    created_at: datetime
    items: list[ImportItemResponse]
    total: int
    finished: int
    imported: int
    duplicates: int
    failed: int
    status: Literal["processing", "partial", "completed"]


class ImportBatchListResponse(BaseModel):
    items: list[ImportBatchResponse]
