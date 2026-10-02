"""Public, secret-free model availability descriptions (never a live health claim)."""

from dataclasses import dataclass
from typing import Literal


@dataclass(frozen=True)
class CatalogModel:
    id: str
    display_name: str
    provider: str
    model: str
    capabilities: tuple[str, ...]
    availability: Literal["configured", "unavailable"]
    unavailable_reason: str | None = None
