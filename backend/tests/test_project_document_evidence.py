"""Project source wire/domain boundary and synthetic HTTP/Agent regressions."""

import json
from copy import deepcopy
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from test_everplain_documents import section
from test_personal_document_evidence import (
    MATERIAL_ID,
    OTHER_ID,
    PARSE_ID,
    SOURCE_ID,
    TASK_ID,
    USER_ID,
    _block,
    _material,
    _validator,
)
from test_research_material_api import _authenticate, _task, _upload

from qunxue_api.adapters.research_agent.document_tools import (
    ResearchDocumentToolRegistry,
    _section_from_payload,
)
from qunxue_api.adapters.sqlite.research_material_repository import SqliteResearchMaterialRepository
from qunxue_api.api.contracts.research_documents import ResearchDocumentSectionContract
from qunxue_api.api.routes.research_documents import _section
from qunxue_api.application.research_documents import ResearchDocumentApplication
from qunxue_api.modules.agent_conversation import AgentRunResult
from qunxue_api.modules.research_materials import MaterialLocator

FULL_LOCATOR = MaterialLocator(
    page=2,
    section_path=("Source",),
    paragraph=1,
    line_start=1,
    line_end=2,
    char_start=0,
    char_end=9,
    block_index=0,
    time_start_ms=0,
    time_end_ms=1000,
    speaker="A",
)
INTEGER_FIELDS = (
    "page",
    "paragraph",
    "line_start",
    "line_end",
    "char_start",
    "char_end",
    "block_index",
    "time_start_ms",
    "time_end_ms",
)


def _converted_section(entry, locator):
    payload = {
        **section(),
        "evidence_refs": [
            {
                "evidence_ref_id": SOURCE_ID,
                "source_id": SOURCE_ID,
                "source_kind": "research_material",
                "material_id": str(MATERIAL_ID),
                "parse_id": str(PARSE_ID),
                "segment_id": "segment-1",
                "locator": locator,
            }
        ],
    }
    if entry == "http":
        return _section(ResearchDocumentSectionContract.model_validate_json(json.dumps(payload)))
    registry = object.__new__(ResearchDocumentToolRegistry)
    registry.evidence = {
        SOURCE_ID: SimpleNamespace(
            source_kind="personal_material",
            knowledge_base_id=None,
            material_id=str(MATERIAL_ID),
            parse_id=str(PARSE_ID),
            segment_id="segment-1",
            locator=locator,
        )
    }
    return _section_from_payload(registry._personal_section_sources(payload))


def _validate_converted(entry, locator, *, expected=FULL_LOCATOR):
    # Use the production SQLite row conversion, not a dictionary-shaped stand-in.
    block = SqliteResearchMaterialRepository._to_block(
        SimpleNamespace(
            segment_id="segment-1",
            parse_id=str(PARSE_ID),
            material_id=str(MATERIAL_ID),
            ordinal=0,
            kind="paragraph",
            text="Synthetic source",
            content_hash="synthetic",
            locator=expected.as_dict(),
        )
    )
    validator, _ = _validator(material=_material(), segment=block)
    converted = _converted_section(entry, locator)
    application = object.__new__(ResearchDocumentApplication)
    application._validate_personal_evidence = validator
    application._validate_evidence_refs((converted,), theory_plan=None, user_id=USER_ID)
    return validator(user_id=USER_ID, evidence=converted.evidence_refs[0])


@pytest.mark.parametrize("entry", ["http", "agent"])
@pytest.mark.parametrize(
    "expected",
    [
        MaterialLocator(page=2, block_index=0),
        MaterialLocator(section_path=("Heading",), paragraph=2, char_start=0, char_end=8),
        MaterialLocator(line_start=1, line_end=2, char_start=0, char_end=9),
        MaterialLocator(time_start_ms=0, time_end_ms=1000, speaker="A"),
    ],
    ids=["pdf", "docx", "txt", "media"],
)
@pytest.mark.parametrize("shape", ["canonical", "sparse", "explicit_null_media", "tuple_path"])
def test_http_and_agent_accept_same_coordinates_across_serialized_shapes(entry, expected, shape):
    payload = expected.as_dict()
    if shape == "sparse":
        payload = {
            key: value for key, value in payload.items() if value is not None and value != []
        }
    elif shape == "explicit_null_media":
        payload = {"time_start_ms": None, "time_end_ms": None, "speaker": None, **payload}
    elif shape == "tuple_path":
        payload["section_path"] = tuple(payload["section_path"])
    if entry == "agent":
        payload["task_id"] = str(TASK_ID)
    original = deepcopy(payload)
    assert _validate_converted(entry, payload, expected=expected)["locator"] == expected.as_dict()
    assert payload == original


@pytest.mark.parametrize("entry", ["http", "agent"])
@pytest.mark.parametrize("field", [*INTEGER_FIELDS, "section_path", "speaker"])
def test_http_and_agent_reject_missing_proven_coordinates(entry, field):
    payload = FULL_LOCATOR.as_dict()
    del payload[field]
    with pytest.raises(ValueError, match="项目附件引用与原文位置不一致"):
        _validate_converted(entry, payload)


@pytest.mark.parametrize("entry", ["http", "agent"])
@pytest.mark.parametrize("field", INTEGER_FIELDS)
@pytest.mark.parametrize("shape", ["string", "float", "bool"])
def test_http_and_agent_do_not_coerce_numeric_coordinates(entry, field, shape):
    payload = FULL_LOCATOR.as_dict()
    payload[field] = {"string": str, "float": float, "bool": bool}[shape](payload[field])
    with pytest.raises(ValueError, match="项目附件引用与原文位置不一致"):
        _validate_converted(entry, payload)


@pytest.mark.parametrize("entry", ["http", "agent"])
@pytest.mark.parametrize(
    "changes",
    [
        {"page": 3},
        {"page": 0},
        {"paragraph": -1},
        {"line_end": 0},
        {"char_end": -1},
        {"time_end_ms": 0},
        {"section_path": ["Other"]},
        {"section_path": "Source"},
        {"section_path": [1]},
        {"section_path": None},
        {"speaker": "B"},
        {"speaker": ""},
        {"speaker": 1},
        {"task_id": str(OTHER_ID)},
        {"task_id": None},
        {"task_id": 1},
        {"unknown_coordinate": None},
        {"page_number": 2},
    ],
)
def test_http_and_agent_reject_mismatch_invalid_values_and_unrecognized_fields(entry, changes):
    with pytest.raises(ValueError, match="项目附件引用与原文位置不一致"):
        _validate_converted(entry, {**FULL_LOCATOR.as_dict(), **changes})


@pytest.mark.parametrize("entry", ["http", "agent"])
@pytest.mark.parametrize("payload", [None, {}, [], [1], "page 2", 2, True])
def test_http_and_agent_reject_missing_or_non_object_locators(entry, payload):
    with pytest.raises(ValueError):
        _validate_converted(entry, payload)


def test_project_source_is_rechecked_after_access_revocation():
    validator, lookups = _validator(material=_material(), segment=_block())
    evidence = _converted_section("http", {"page": 1}).evidence_refs[0]
    assert validator(user_id=USER_ID, evidence=evidence)["locator"]["page"] == 1
    lookups.get_owned_material.return_value = None
    with pytest.raises(ValueError, match="已删除或不可访问"):
        validator(user_id=USER_ID, evidence=evidence)
    assert lookups.get_segment.call_count == 1


def _uploaded_source(client, task_id, filename="source.txt"):
    uploaded = _upload(client, task_id, filename=filename)
    assert uploaded.status_code == 201, uploaded.text
    material = uploaded.json()
    detail = client.get(f"/api/research-tasks/{task_id}/materials/{material['material_id']}")
    assert detail.status_code == 200, detail.text
    block = detail.json()["segments"][0]
    source_id = f"material:{material['material_id']}:{block['segment_id']}"
    return material, {
        "evidence_ref_id": source_id,
        "source_id": source_id,
        "source_kind": "research_material",
        "material_id": material["material_id"],
        "parse_id": material["parse_id"],
        "segment_id": block["segment_id"],
        "locator": block["locator"],
    }


def _create(client, task_id, evidence):
    return client.post(
        f"/api/research-tasks/{task_id}/research-documents",
        headers={"Idempotency-Key": str(uuid4())},
        json={
            "title": "Project source findings",
            "sections": [
                {**section(), "evidence_refs": [evidence]},
            ],
        },
    )


@pytest.mark.parametrize("filename", ["source.txt", "source.docx"])
def test_http_project_citation_creates_exports_and_preserves_access_checks(plain_client, filename):
    client = plain_client
    _authenticate(client)
    task_id = _task(client)
    material, evidence = _uploaded_source(client, task_id, filename)
    created = _create(client, task_id, evidence)
    assert created.status_code == 201, created.text
    document_id = created.json()["document_id"]
    exported = client.get(f"/api/research-documents/{document_id}/export")
    assert exported.status_code == 200, exported.text
    assert filename in exported.json()["markdown"]
    for changes in (
        {"parse_id": str(OTHER_ID)},
        {"segment_id": "missing"},
        {"material_id": str(OTHER_ID)},
        {"locator": {**evidence["locator"], "page": 999}},
        {"locator": {**evidence["locator"], "task_id": str(OTHER_ID)}},
    ):
        rejected = _create(client, task_id, {**evidence, **changes})
        assert rejected.status_code == 409, rejected.text
    deleted = client.delete(
        f"/api/research-tasks/{task_id}/materials/{material['material_id']}",
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert deleted.status_code == 204, deleted.text
    assert client.get(f"/api/research-documents/{document_id}/export").status_code == 409
    _, foreign_evidence = _uploaded_source(client, task_id)
    client.cookies.clear()
    _authenticate(client)
    foreign_attempt = _create(client, _task(client), foreign_evidence)
    assert foreign_attempt.status_code == 409, foreign_attempt.text


def test_agent_project_source_can_be_proposed_accepted_and_exported(plain_client):
    client = plain_client
    identity = _authenticate(client)
    task_id = _task(client)
    material, _ = _uploaded_source(client, task_id)

    class Runner:
        def run(self, *, prompt, conversation, tools):
            source = tools.read_research_material_context(material["material_id"])
            assert "error" not in source, source
            assert source["locator"]["task_id"] == task_id
            self.proposal = tools.propose_document_creation(
                title="Project findings",
                sections=[
                    {
                        **section(),
                        "citation_ids": [source["citation_id"]],
                    }
                ],
                rationale="Retain project source",
            )
            assert "error" not in self.proposal, self.proposal
            return AgentRunResult(
                answer="Findings ready.",
                citations=tuple(tools.evidence.values()),
                release_id=tools.release.knowledge_release_id,
                provider="test",
                model="source-boundary",
            )

    runner = Runner()
    with client.app.state.disciplinary_agent_scope() as app:
        app._runner = runner
        app.run_turn(
            user_id=UUID(identity["user"]["user_id"]),
            conversation_id=None,
            prompt="Save project findings",
            workspace="research",
            task_id=UUID(task_id),
            material_ids=(UUID(material["material_id"]),),
            idempotency_key=str(uuid4()),
        )
    accepted = client.post(
        f"/api/research-document-proposals/{runner.proposal['proposal_id']}/accept",
        headers={"Idempotency-Key": str(uuid4())},
        json={"expected_document_version": None},
    )
    assert accepted.status_code == 200, accepted.text
    document = accepted.json()["document"]
    assert document["sections"][0]["evidence_refs"][0]["source_kind"] == "research_material"
    exported = client.get(f"/api/research-documents/{document['document_id']}/export")
    assert exported.status_code == 200, exported.text
    assert "source.txt" in exported.json()["markdown"]
