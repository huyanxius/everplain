"""Validate personal-document evidence through session-bound source lookups."""

from collections.abc import Callable
from typing import Protocol
from urllib.parse import urlparse
from uuid import UUID

from qunxue_api.modules.research_framework import (
    ResearchDocumentEvidenceRef,
    ResearchDocumentEvidenceSourceKind,
)
from qunxue_api.modules.research_materials import MaterialBlock, MaterialLocator, ResearchMaterial
from qunxue_api.modules.shared_knowledge import SharedDocument, SharedKnowledgeBase


class OwnedMaterialLookup(Protocol):
    def __call__(self, material_id: UUID, *, user_id: UUID) -> ResearchMaterial | None: ...


class MaterialSegmentLookup(Protocol):
    def __call__(
        self,
        material_id: UUID,
        parse_id: UUID,
        segment_id: str,
        *,
        user_id: UUID,
        task_id: UUID,
    ) -> MaterialBlock | None: ...


class PersonalDocumentEvidenceValidator:
    def __init__(
        self,
        *,
        owned_document: Callable[[UUID, UUID], tuple[SharedKnowledgeBase, SharedDocument] | None],
        get_owned_material: OwnedMaterialLookup,
        get_segment: MaterialSegmentLookup,
    ) -> None:
        self._owned_document = owned_document
        self._get_owned_material = get_owned_material
        self._get_segment = get_segment

    def __call__(
        self, *, user_id: UUID, evidence: ResearchDocumentEvidenceRef
    ) -> dict[str, object]:
        if evidence.source_kind is ResearchDocumentEvidenceSourceKind.WEB:
            url = urlparse(evidence.source_id)
            if url.scheme not in {"https", "http"} or not url.hostname:
                raise ValueError("网页引用地址无效。")
            return {"title": evidence.source_id, "url": evidence.source_id}
        if evidence.source_kind is ResearchDocumentEvidenceSourceKind.PERSONAL_KNOWLEDGE:
            owned = self._owned_document(user_id, evidence.material_id)
            if owned is None:
                raise ValueError("引用的知识库资料已删除或不可访问。")
            _, document = owned
            segment = next(
                (item for item in document.segments if item["segment_id"] == evidence.segment_id),
                None,
            )
            if (
                segment is None
                or document.parse_id != evidence.parse_id
                or segment["locator"] != evidence.locator
                or evidence.source_id != f"material:{document.id}:{evidence.segment_id}"
            ):
                raise ValueError("知识库引用与原文位置不一致。")
            return {"title": document.filename, "locator": segment["locator"]}
        if evidence.source_kind is ResearchDocumentEvidenceSourceKind.RESEARCH_MATERIAL:
            material = self._get_owned_material(evidence.material_id, user_id=user_id)
            if material is None:
                raise ValueError("引用的项目附件已删除或不可访问。")
            segment = self._get_segment(
                evidence.material_id,
                evidence.parse_id,
                evidence.segment_id,
                user_id=user_id,
                task_id=material.task_id,
            )
            if segment is None or not _matches_project_locator(
                evidence.locator, segment.locator, task_id=material.task_id
            ):
                raise ValueError("项目附件引用与原文位置不一致。")
            return {
                "title": material.display_name or material.original_filename,
                "locator": segment.locator.as_dict(),
            }
        raise ValueError("个人文稿不能引用学科公共库。")


def _matches_project_locator(payload: object, expected: MaterialLocator, *, task_id: UUID) -> bool:
    """Compare wire coordinates without coercing or discarding untrusted fields."""
    if not isinstance(payload, dict) or not payload:
        return False
    coordinates = {
        "time_start_ms": None,
        "time_end_ms": None,
        "speaker": None,
        **expected.as_dict(),
    }
    if payload.keys() - (coordinates.keys() | {"task_id"}):
        return False
    # Agent reads add provenance metadata, not a location coordinate. It must
    # agree with the owned material before it can be left out of the comparison.
    if "task_id" in payload and payload["task_id"] != str(task_id):
        return False
    for name, actual in coordinates.items():
        supplied = payload.get(name, [] if name == "section_path" else None)
        if name == "section_path":
            if not isinstance(supplied, (list, tuple)) or any(
                not isinstance(item, str) for item in supplied
            ):
                return False
            supplied = list(supplied)
        elif name == "speaker":
            if supplied is not None and not isinstance(supplied, str):
                return False
        elif supplied is not None and type(supplied) is not int:
            # bool and float compare equal to some integers in Python. Neither
            # is an exact parser coordinate, and strings must not be coerced.
            return False
        if supplied != actual:
            return False
    return True
