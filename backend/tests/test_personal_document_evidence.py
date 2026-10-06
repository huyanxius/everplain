from dataclasses import replace
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import Mock, call
from uuid import UUID

import pytest

from qunxue_api.application.personal_document_evidence import PersonalDocumentEvidenceValidator
from qunxue_api.modules.research_framework import (
    ResearchDocumentEvidenceRef,
    ResearchDocumentEvidenceSourceKind,
)
from qunxue_api.modules.research_materials import MaterialBlock, MaterialLocator, ResearchMaterial
from qunxue_api.modules.shared_knowledge import SharedDocument, SharedKnowledgeBase

USER_ID, MATERIAL_ID, PARSE_ID, TASK_ID, OTHER_ID = (UUID(int=value) for value in range(1, 6))
SOURCE_ID = f"material:{MATERIAL_ID}:segment-1"
LOCATOR = {"page": 1}


def _evidence(kind=ResearchDocumentEvidenceSourceKind.PERSONAL_KNOWLEDGE, **changes):
    values = {
        "evidence_ref_id": "reference-1",
        "source_id": SOURCE_ID,
        "knowledge_release_id": None,
        "source_kind": kind,
        "material_id": MATERIAL_ID,
        "parse_id": PARSE_ID,
        "segment_id": "segment-1",
        "locator": LOCATOR,
    }
    values.update(changes)
    return ResearchDocumentEvidenceRef(**values)


def _document(**changes):
    document = SharedDocument(
        id=MATERIAL_ID,
        owner_user_id=USER_ID,
        filename="interviews.txt",
        media_type="text/plain",
        content_hash="test-hash",
        size_bytes=12,
        parse_id=PARSE_ID,
        status="ready",
        segments=({"segment_id": "segment-1", "locator": LOCATOR},),
    )
    return replace(document, **changes)


def _material(**changes):
    material = ResearchMaterial.create(
        material_id=MATERIAL_ID,
        user_id=USER_ID,
        task_id=TASK_ID,
        idempotency_key="upload-1",
        original_filename="attachment.txt",
        display_name="Interview attachment",
        media_type="text/plain",
        content=b"test material",
        now=datetime(2026, 10, 6, tzinfo=UTC),
    )
    return replace(material, **changes)


def _block():
    return MaterialBlock.create(
        parse_id=PARSE_ID,
        material_id=MATERIAL_ID,
        ordinal=0,
        kind="paragraph",
        text="test material",
        locator=MaterialLocator(page=1),
        segment_id="segment-1",
    )


def _validator(*, document=None, material=None, segment=None):
    lookups = Mock()
    library = SharedKnowledgeBase(OTHER_ID, USER_ID, "Library", "", "test-token")
    lookups.owned_document.return_value = (library, document) if document is not None else None
    lookups.get_owned_material.return_value = material
    lookups.get_segment.return_value = segment
    validator = PersonalDocumentEvidenceValidator(
        owned_document=lookups.owned_document,
        get_owned_material=lookups.get_owned_material,
        get_segment=lookups.get_segment,
    )
    assert lookups.mock_calls == []
    return validator, lookups


@pytest.mark.parametrize("url", ["https://example.test/paper?q=1#page-2", "http://example.test/"])
def test_web_returns_original_url_without_repository_lookups(url):
    validator, lookups = _validator()
    evidence = _evidence(ResearchDocumentEvidenceSourceKind.WEB, source_id=url)
    result = validator(user_id=USER_ID, evidence=evidence)
    assert result == {"title": url, "url": url}
    assert result["title"] is evidence.source_id
    assert result["url"] is evidence.source_id
    assert lookups.mock_calls == []


@pytest.mark.parametrize("url", ["ftp://example.test/", "//example.test/", "https://", "http:///x"])
def test_web_rejects_invalid_scheme_or_missing_hostname(url):
    validator, lookups = _validator()
    # Exercise the callable's own guard independently of the evidence constructor.
    evidence = SimpleNamespace(source_kind=ResearchDocumentEvidenceSourceKind.WEB, source_id=url)
    with pytest.raises(ValueError, match="^网页引用地址无效。$"):
        validator(user_id=USER_ID, evidence=evidence)
    assert lookups.mock_calls == []


@pytest.mark.parametrize(
    "kind",
    [
        ResearchDocumentEvidenceSourceKind.PUBLIC_KNOWLEDGE,
        ResearchDocumentEvidenceSourceKind.PERSONAL_MATERIAL,
    ],
)
def test_unsupported_source_kinds_do_not_query_repositories(kind):
    validator, lookups = _validator()
    evidence = _evidence(
        kind,
        knowledge_release_id="legacy-release" if kind.value == "public_knowledge" else None,
        annotation_id=OTHER_ID,
    )
    with pytest.raises(ValueError, match="^个人文稿不能引用学科公共库。$"):
        validator(user_id=USER_ID, evidence=evidence)
    assert lookups.mock_calls == []


def test_private_evidence_keeps_source_title_and_locator_object():
    document = _document()
    validator, lookups = _validator(document=document)
    result = validator(user_id=USER_ID, evidence=_evidence())
    assert result == {"title": "interviews.txt", "locator": LOCATOR}
    assert result["locator"] is document.segments[0]["locator"]
    assert lookups.mock_calls == [call.owned_document(USER_ID, MATERIAL_ID)]


def test_private_owner_lookup_failure_precedes_source_validation():
    validator, lookups = _validator()
    evidence = _evidence(parse_id=OTHER_ID, source_id="wrong", locator={"page": 2})
    with pytest.raises(ValueError, match="^引用的知识库资料已删除或不可访问。$"):
        validator(user_id=USER_ID, evidence=evidence)
    assert lookups.mock_calls == [call.owned_document(USER_ID, MATERIAL_ID)]


@pytest.mark.parametrize(
    "changes",
    [
        {"parse_id": OTHER_ID},
        {"segment_id": "missing"},
        {"locator": {"page": 2}},
        {"source_id": "wrong"},
        {"source_id": f"material:{OTHER_ID}:segment-1"},
    ],
)
def test_private_evidence_rejects_each_source_identity_mismatch(changes):
    validator, lookups = _validator(document=_document())
    with pytest.raises(ValueError, match="^知识库引用与原文位置不一致。$"):
        validator(user_id=USER_ID, evidence=_evidence(**changes))
    assert lookups.mock_calls == [call.owned_document(USER_ID, MATERIAL_ID)]


def test_private_missing_segment_short_circuits_remaining_document_checks():
    validator, _ = _validator(document=SimpleNamespace(segments=()))
    with pytest.raises(ValueError, match="^知识库引用与原文位置不一致。$"):
        validator(user_id=USER_ID, evidence=_evidence())


def test_private_parse_check_precedes_locator_access():
    document = _document(parse_id=OTHER_ID, segments=({"segment_id": "segment-1"},))
    validator, _ = _validator(document=document)
    with pytest.raises(ValueError, match="^知识库引用与原文位置不一致。$"):
        validator(user_id=USER_ID, evidence=_evidence())


def test_private_segment_search_precedes_parse_check():
    validator, _ = _validator(document=_document(parse_id=OTHER_ID, segments=({},)))
    with pytest.raises(KeyError, match="segment_id"):
        validator(user_id=USER_ID, evidence=_evidence())


def test_private_locator_access_precedes_source_id_check():
    validator, _ = _validator(document=_document(segments=({"segment_id": "segment-1"},)))
    with pytest.raises(KeyError, match="locator"):
        validator(user_id=USER_ID, evidence=_evidence(source_id="wrong"))


def test_private_segment_search_uses_first_matching_segment():
    document = _document(
        segments=(
            {"segment_id": "segment-1", "locator": {"page": 2}},
            {"segment_id": "segment-1", "locator": LOCATOR},
        )
    )
    validator, _ = _validator(document=document)
    with pytest.raises(ValueError, match="^知识库引用与原文位置不一致。$"):
        validator(user_id=USER_ID, evidence=_evidence())


@pytest.mark.parametrize("display_name", ["Interview attachment", ""])
def test_project_evidence_preserves_owner_task_lookup_order_and_serializes_locator(display_name):
    material, segment = _material(display_name=display_name), _block()
    validator, lookups = _validator(material=material, segment=segment)
    evidence = _evidence(
        ResearchDocumentEvidenceSourceKind.RESEARCH_MATERIAL,
        source_id="project-source",
        locator=segment.locator.as_dict(),
    )
    result = validator(user_id=USER_ID, evidence=evidence)
    assert result == {
        "title": display_name or "attachment.txt",
        "locator": segment.locator.as_dict(),
    }
    assert isinstance(result["locator"], dict)
    assert lookups.mock_calls == [
        call.get_owned_material(MATERIAL_ID, user_id=USER_ID),
        call.get_segment(MATERIAL_ID, PARSE_ID, "segment-1", user_id=USER_ID, task_id=TASK_ID),
    ]


def test_project_owner_failure_prevents_segment_lookup():
    validator, lookups = _validator(segment=_block())
    with pytest.raises(ValueError, match="^引用的项目附件已删除或不可访问。$"):
        validator(
            user_id=USER_ID,
            evidence=_evidence(
                ResearchDocumentEvidenceSourceKind.RESEARCH_MATERIAL,
                parse_id=OTHER_ID,
            ),
        )
    assert lookups.mock_calls == [call.get_owned_material(MATERIAL_ID, user_id=USER_ID)]


@pytest.mark.parametrize("parse_id,segment_id", [(OTHER_ID, "segment-1"), (PARSE_ID, "missing")])
def test_project_passes_exact_parse_and_segment_to_owned_task_lookup(parse_id, segment_id):
    validator, lookups = _validator(material=_material(task_id=OTHER_ID))
    with pytest.raises(ValueError, match="^项目附件引用与原文位置不一致。$"):
        validator(
            user_id=USER_ID,
            evidence=_evidence(
                ResearchDocumentEvidenceSourceKind.RESEARCH_MATERIAL,
                parse_id=parse_id,
                segment_id=segment_id,
            ),
        )
    assert lookups.mock_calls == [
        call.get_owned_material(MATERIAL_ID, user_id=USER_ID),
        call.get_segment(MATERIAL_ID, parse_id, segment_id, user_id=USER_ID, task_id=OTHER_ID),
    ]


@pytest.mark.parametrize("locator", [MaterialLocator(page=1), {"page": 2}])
def test_project_rejects_non_wire_locator_or_different_position(locator):
    validator, _ = _validator(material=_material(), segment=_block())
    with pytest.raises(ValueError, match="^项目附件引用与原文位置不一致。$"):
        validator(
            user_id=USER_ID,
            evidence=_evidence(
                ResearchDocumentEvidenceSourceKind.RESEARCH_MATERIAL,
                locator=locator,
            ),
        )


@pytest.mark.parametrize("lookup", ["owned_document", "get_owned_material", "get_segment"])
def test_lookup_errors_propagate_without_translation_or_fallback(lookup):
    validator, lookups = _validator(document=_document(), material=_material(), segment=_block())
    error = RuntimeError("source unavailable")
    getattr(lookups, lookup).side_effect = error
    kind = (
        ResearchDocumentEvidenceSourceKind.PERSONAL_KNOWLEDGE
        if lookup == "owned_document"
        else ResearchDocumentEvidenceSourceKind.RESEARCH_MATERIAL
    )
    with pytest.raises(RuntimeError) as raised:
        validator(user_id=USER_ID, evidence=_evidence(kind))
    assert raised.value is error
    assert lookups.mock_calls[-1][0] == lookup
