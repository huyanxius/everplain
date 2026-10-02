"""Import boundary: text bytes only; errors never impersonate successful documents."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True, slots=True)
class ImportItem:
    source_key: str
    title: str
    filename: str
    content: bytes
    media_type: str = "text/plain; charset=utf-8"
    source_url: str | None = None
    relative_path: str | None = None
    wiki_links: tuple[str, ...] = ()
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class ImportError:
    source_key: str
    code: str
    message: str
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class ImportResult:
    item: ImportItem | None = None
    error: ImportError | None = None

    def __post_init__(self) -> None:
        if (self.item is None) == (self.error is None):
            raise ValueError("exactly one item or error is required")


@dataclass(frozen=True, slots=True)
class FavoritesReport:
    folders: tuple[dict[str, Any], ...] = ()
    items: tuple[ImportItem, ...] = ()
    errors: tuple[ImportError, ...] = ()
    notices: tuple[str, ...] = (
        "Only public folders are visible; private folders may be omitted by Bilibili.",
    )
