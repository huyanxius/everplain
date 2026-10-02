"""Generic research survives retirement of interview and coding capabilities."""

from types import SimpleNamespace
from uuid import uuid4

from pydantic_ai.models.function import FunctionModel
from test_research_material_api import _authenticate, _task

from qunxue_api.adapters.research_agent import ResearchDocumentToolRegistry
from qunxue_api.adapters.research_agent.pydantic_runner import PydanticAIKnowledgeRunner


def test_retired_interview_and_coding_routes_are_absent(plain_client):
    task_id, material_id, record_id = uuid4(), uuid4(), uuid4()
    base = f"/api/research-tasks/{task_id}"
    paths = [
        ("GET", f"materials/{material_id}/transcription"),
        ("POST", f"materials/{material_id}/transcription/runs"),
        ("POST", f"materials/{material_id}/transcription/imports"),
        ("POST", f"materials/{material_id}/transcription/versions"),
        ("POST", "batch-coding"),
        ("GET", f"batch-coding/{record_id}"),
        ("POST", f"batch-coding/{record_id}/retry"),
        ("POST", "analysis/codes"),
        ("POST", f"analysis/codes/{record_id}/decision"),
        ("POST", f"analysis/coding-plans/{record_id}/decision"),
        ("POST", f"analysis/coding-plans/{record_id}/revoke"),
        ("GET", "analysis/retrieved-segments"),
        ("PUT", f"analysis/workspace/codebook/{record_id}"),
        ("POST", f"analysis/workspace/codebook/{record_id}/transition"),
        ("POST", "analysis/workspace/themes"),
        ("POST", f"analysis/workspace/themes/{record_id}/decision"),
        ("POST", "analysis/workspace/memo-links"),
        ("POST", "analysis/workspace/cases"),
        ("PUT", "analysis/workspace/matrix-cell"),
        ("PUT", "analysis/workspace/method"),
        ("POST", "exchange/qdpx-preview"),
    ]
    for method, path in paths:
        assert plain_client.request(method, f"{base}/{path}").status_code == 404, path
    schema = plain_client.app.openapi()
    assert not any(
        marker in path
        for path in schema["paths"]
        for marker in (
            "/transcription",
            "/batch-coding",
            "/analysis/codes",
            "/coding-plans",
            "/retrieved-segments",
            "/analysis/workspace",
            "/qdpx-preview",
        )
    )
    properties = schema["components"]["schemas"]["ResearchAnalysisSnapshotResponse"]["properties"]
    assert properties.keys() == {"task_id", "annotations", "memos", "comparisons"}
    assert "/api/research-tasks/{task_id}/method-plans" in schema["paths"]
    assert "/api/research-tasks/{task_id}/exchange/archive" in schema["paths"]


def test_generic_material_annotations_memos_and_comparisons_remain_owned(plain_client):
    client = plain_client
    _authenticate(client)
    task_id = _task(client)
    base = f"/api/research-tasks/{task_id}"
    text = "The evaluation found offline search useful for field work."
    uploaded = client.post(
        f"{base}/materials",
        headers={"Idempotency-Key": str(uuid4())},
        data={"material_kind": "other"},
        files={"file": ("evaluation.txt", text.encode(), "text/plain")},
    )
    assert uploaded.status_code == 201, uploaded.text
    material_id = uploaded.json()["material_id"]
    detail = client.get(f"{base}/materials/{material_id}")
    assert detail.status_code == 200, detail.text
    segment = detail.json()["segments"][0]
    annotation = client.post(
        f"{base}/analysis/annotations",
        headers={"Idempotency-Key": str(uuid4())},
        json={
            "material_id": material_id,
            "parse_id": segment["parse_id"],
            "segment_id": segment["segment_id"],
            "quote_start": 0,
            "quote_end": len(text),
            "annotation_kind": "descriptive",
            "case_label": "Offline",
            "note": "Keep the evaluation source.",
        },
    )
    assert annotation.status_code == 201, annotation.text
    record = annotation.json()
    assert record["quote"] == text and record["locator"]["line_start"] == 1
    memo_body = {
        "title": "Offline capability",
        "content": "The evaluation supports offline search.",
        "memo_kind": "analytic",
        "annotation_ids": [record["annotation_id"]],
    }
    memo = client.post(
        f"{base}/analysis/memos",
        headers={"Idempotency-Key": str(uuid4())},
        json=memo_body,
    )
    assert memo.status_code == 201, memo.text
    assert "code_ids" not in memo.json()
    rejected = client.post(
        f"{base}/analysis/memos",
        headers={"Idempotency-Key": str(uuid4())},
        json={**memo_body, "code_ids": [str(uuid4())]},
    )
    assert rejected.status_code == 422
    second_text = "The online option requires a stable connection."
    second = client.post(
        f"{base}/materials",
        headers={"Idempotency-Key": str(uuid4())},
        data={"material_kind": "other"},
        files={"file": ("online.txt", second_text.encode(), "text/plain")},
    )
    assert second.status_code == 201, second.text
    second_id = second.json()["material_id"]
    second_segment = client.get(f"{base}/materials/{second_id}").json()["segments"][0]
    second_annotation = client.post(
        f"{base}/analysis/annotations",
        headers={"Idempotency-Key": str(uuid4())},
        json={
            "material_id": second_id,
            "parse_id": second_segment["parse_id"],
            "segment_id": second_segment["segment_id"],
            "quote_start": 0,
            "quote_end": len(second_text),
            "annotation_kind": "descriptive",
            "case_label": "Online",
            "note": "Record the connection constraint.",
        },
    )
    assert second_annotation.status_code == 201, second_annotation.text
    comparison = client.post(
        f"{base}/analysis/comparisons",
        headers={"Idempotency-Key": str(uuid4())},
        json={
            "title": "Search options",
            "question": "Which option serves field work?",
            "case_labels": ["Offline", "Online"],
            "findings": [
                {"kind": "support", "statement": text, "annotation_ids": [record["annotation_id"]]},
                {
                    "kind": "support",
                    "statement": second_text,
                    "annotation_ids": [second_annotation.json()["annotation_id"]],
                },
            ],
            "evidence_gaps": ["Connection reliability has not been evaluated."],
            "theory_implication": "Test both options before selecting one.",
        },
    )
    assert comparison.status_code == 201, comparison.text
    snapshot = client.get(f"{base}/analysis")
    assert snapshot.status_code == 200
    assert set(snapshot.json()) == {"task_id", "annotations", "memos", "comparisons"}
    assert text in [item["quote"] for item in snapshot.json()["annotations"]]
    assert len(snapshot.json()["memos"]) == len(snapshot.json()["comparisons"]) == 1
    _authenticate(client)
    assert client.get(f"{base}/analysis").status_code == 404
    assert client.get(f"{base}/materials/{material_id}").status_code == 404
    assert (
        client.post(
            f"{base}/analysis/memos",
            headers={"Idempotency-Key": str(uuid4())},
            json=memo_body,
        ).status_code
        == 404
    )


class _Catalog:
    def current_release(self, **_kwargs):
        return SimpleNamespace(knowledge_release_id="test", content_hash="test")


class _Analysis:
    def get_for_agent(self, **_kwargs):
        return {
            "schema_version": "research-analysis-v1",
            "annotations": [],
            "codes": [{"code_id": "legacy-code"}],
            "coding_plans": ["legacy-plan"],
            "workspace": {"codebook": ["legacy-code"]},
            "memos": [
                {"memo_id": "memo", "content": "Keep this note", "code_ids": ["legacy-code"]}
            ],
            "comparisons": [],
        }

    def get_comparison_context_for_agent(self, **_kwargs):
        return self.get_for_agent()

    def propose_memo_from_agent(self, **payload):
        assert payload["code_ids"] == ()
        return {"memo_id": "memo", "code_ids": [], "content": payload["content"]}


def _registry():
    registry = ResearchDocumentToolRegistry(
        catalog=_Catalog(),
        documents=SimpleNamespace(),
        proposals=SimpleNamespace(),
        materials=SimpleNamespace(list=lambda **_kwargs: ()),
        analysis=_Analysis(),
    )
    registry.bind_agent_context(
        user_id=uuid4(),
        task_id=uuid4(),
        conversation_id=uuid4(),
        agent_run_id=uuid4(),
        agent_turn_id=uuid4(),
    )
    return registry


def test_agent_analysis_projection_hides_archived_coding_but_keeps_notes():
    registry = _registry()
    for result in (
        registry.get_research_analysis(),
        registry.get_research_comparison_context(
            case_labels=["A", "B"],
        ),
    ):
        assert set(result) == {"schema_version", "annotations", "memos", "comparisons"}
        assert result["memos"] == [{"memo_id": "memo", "content": "Keep this note"}]
    memo = registry.propose_analysis_memo(
        title="A note",
        content="Keep this note",
        memo_kind="analytic",
        annotation_ids=[],
        tool_call_id="memo-only",
    )
    assert "code_ids" not in memo
    assert memo["requires_user_confirmation"] is True
    for name in ("propose_analysis_code", "propose_coding_plan", "retrieve_coded_segments"):
        assert not hasattr(registry, name)


def test_agent_registers_generic_analysis_tools_without_coding():
    visible = {}

    async def model_stream(_messages, info):
        visible.update({tool.name: tool.parameters_json_schema for tool in info.function_tools})
        yield "Ready."

    runner = PydanticAIKnowledgeRunner(
        base_url="https://unused.example/v1",
        api_key="unused-test-key",
        model="test",
        timeout_seconds=5,
    )
    with runner._agent.override(model=FunctionModel(stream_function=model_stream)):
        result = runner.run_stream(
            prompt="Hello",
            conversation=(),
            tools=_registry(),
            on_delta=lambda _delta: None,
        )
    assert result.answer == "Ready."
    assert {
        "get_research_analysis",
        "propose_analysis_memo",
        "get_research_comparison_context",
        "propose_case_comparison",
        "read_research_material_context",
    } <= visible.keys()
    removed = {"propose_analysis_code", "propose_coding_plan", "retrieve_coded_segments"}
    assert not removed & visible.keys()
    assert "code_ids" not in visible["propose_analysis_memo"]["properties"]
