from typing import Literal

from pydantic import BaseModel


class PersonalGraphNode(BaseModel):
    id: str
    label: str
    nodeType: Literal["self", "topic", "document", "knowledge"]
    level: int


class PersonalGraphEdge(BaseModel):
    id: str
    source: str
    target: str
    relationType: str
    direction: str
    layer: str


class PersonalGraphSource(BaseModel):
    library_id: str
    document_id: str
    title: str
    source_url: str | None = None
    segment_id: str | None = None


class PersonalGraphResponse(BaseModel):
    releaseId: str
    nodes: list[PersonalGraphNode]
    edges: list[PersonalGraphEdge]
    sources: dict[str, PersonalGraphSource]
    pending_count: int
    document_count: int
    topic_count: int
    mode: Literal["mock", "semantic"]
    avatar_id: str
    color: str
    name: str
