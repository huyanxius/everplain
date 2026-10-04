from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from qunxue_api.modules.writing import MAX_DOCUMENT_CHARACTERS, Genre


class WritingInput(BaseModel):
    model_config = ConfigDict(extra="forbid")


class WritingSampleCreate(WritingInput):
    title: str = Field(min_length=1, max_length=200)
    genre: Genre
    text: str = Field(min_length=80, max_length=100000)


class WritingSampleResponse(BaseModel):
    sample_id: UUID
    title: str
    genre: Genre
    character_count: int
    created_at: datetime


class WritingSampleList(BaseModel):
    items: list[WritingSampleResponse]


class WritingGenreSummary(BaseModel):
    genre: Genre
    sample_count: int
    character_count: int
    readiness: Literal["empty", "limited", "ready"]


class WritingDocumentCreate(WritingInput):
    title: str = Field(default="未命名文稿", min_length=1, max_length=200)
    genre: Genre = Genre.ESSAY
    markdown: str = Field(default="", max_length=MAX_DOCUMENT_CHARACTERS)

    @field_validator("title")
    @classmethod
    def title_not_blank(cls, value):
        if not value.strip():
            raise ValueError("标题不能为空")
        return value.strip()


class WritingDocumentUpdate(WritingInput):
    expected_version: int = Field(ge=1)
    title: str | None = Field(default=None, min_length=1, max_length=200)
    genre: Genre | None = None
    markdown: str | None = Field(default=None, max_length=MAX_DOCUMENT_CHARACTERS)


class WritingDocumentResponse(BaseModel):
    document_id: UUID
    title: str
    genre: Genre
    markdown: str
    version: int
    created_at: datetime
    updated_at: datetime


class WritingDocumentList(BaseModel):
    items: list[WritingDocumentResponse]


class WritingSummary(BaseModel):
    sample_count: int
    genres: list[WritingGenreSummary]
    documents: list[WritingDocumentResponse]


class WritingRevisionCreate(WritingInput):
    expected_version: int = Field(ge=1)
    action: Literal["rewrite", "personalize", "continue"]
    instruction: str = Field(default="", max_length=4000)
    selection_start: int | None = Field(default=None, ge=0)
    selection_end: int | None = Field(default=None, ge=1)


class WritingRevisionResponse(BaseModel):
    revision_id: UUID
    document_id: UUID
    base_version: int
    action: Literal["rewrite", "personalize", "continue"]
    before_markdown: str
    after_markdown: str
    status: Literal["pending", "accepted", "rejected", "stale"]
    warnings: list[str]
    created_at: datetime


class WritingRevisionList(BaseModel):
    items: list[WritingRevisionResponse]


class WritingRevisionResolve(WritingInput):
    decision: Literal["accept", "reject"]
    expected_version: int = Field(ge=1)


class WritingRevisionResolution(BaseModel):
    document: WritingDocumentResponse
    revision: WritingRevisionResponse
