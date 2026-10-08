import ast
import inspect
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException
from test_research_tasks import authenticate

from qunxue_api.api.routes import research_tasks
from qunxue_api.application.research_task_creation import (
    ResearchTaskCreationCommand,
    SeedTheoryNotInCurrentRelease,
)
from qunxue_api.modules.knowledge_catalog import KnowledgeUsePurpose
from qunxue_api.modules.research_intake import (
    EntryType,
    ProjectLifecycleStatus,
    ResearchCentralTool,
    ResearchEntryMode,
    ResearchTaskService,
)


@pytest.mark.parametrize("mode", list(ResearchEntryMode))
@pytest.mark.parametrize("seed", [None, "seed-theory"])
@pytest.mark.parametrize("title", [None, "Explicit title", "   "])
def test_command_resolves_policy_before_persistence(mode, seed, title):
    events = []
    user_id = uuid4()

    class Catalog:
        def current_release(self, *, purpose):
            assert purpose is KnowledgeUsePurpose.BROWSE
            events.append("release")
            return SimpleNamespace(knowledge_release_id="browse-release")

        def get_theory_profile(self, *, theory_id, release_id):
            assert (theory_id, release_id) == (seed, "browse-release")
            events.append("profile")
            return SimpleNamespace(title="Seed title")

    class Repository:
        def add_or_get_by_idempotency_key(self, task):
            events.append("persist")
            return task

    def catalog():
        events.append("catalog")
        return Catalog()

    task = ResearchTaskCreationCommand(ResearchTaskService(Repository()), catalog).create(
        user_id=user_id,
        entry_type=EntryType.MATERIAL_INPUT,
        idempotency_key="creation-key",
        entry_mode=mode,
        project_title=title,
        project_stage="  stage  ",
        method_orientation="  method  ",
        seed_theory_id=seed,
    )
    assert events == (["catalog", "release", "profile"] if seed else []) + ["persist"]
    assert task.user_id == user_id
    assert task.entry_type is EntryType.MATERIAL_INPUT
    assert task.idempotency_key == "creation-key"
    assert task.entry_mode is mode
    existing = mode is ResearchEntryMode.EXISTING_RESEARCH
    assert task.lifecycle_status is (
        ProjectLifecycleStatus.IN_PROGRESS if existing else ProjectLifecycleStatus.DRAFT
    )
    assert task.last_central_tool is (
        ResearchCentralTool.MATERIALS if existing else ResearchCentralTool.PHENOMENON
    )
    selected_title = title or ("Seed title" if seed else "未命名研究")
    assert task.project_title == (selected_title.strip() or "未命名研究")
    assert (task.project_stage, task.method_orientation) == ("stage", "method")
    assert (task.seed_theory_id, task.seed_theory_name) == (seed, "Seed title" if seed else None)
    assert task.knowledge_release_id is None


@pytest.mark.parametrize("failure", ["release", "profile", "persist"])
def test_command_only_translates_profile_lookup_error(failure):
    events = []
    error = LookupError(failure)

    class Catalog:
        def current_release(self, **kwargs):
            events.append("release")
            if failure == "release":
                raise error
            return SimpleNamespace(knowledge_release_id="release")

        def get_theory_profile(self, **kwargs):
            events.append("profile")
            if failure == "profile":
                raise error
            return SimpleNamespace(title="Seed")

    class Service:
        def create(self, **kwargs):
            events.append("persist")
            raise error

    with pytest.raises(
        SeedTheoryNotInCurrentRelease if failure == "profile" else LookupError
    ) as raised:
        ResearchTaskCreationCommand(Service(), Catalog).create(
            user_id=uuid4(),
            entry_type=EntryType.DIRECT_INPUT,
            idempotency_key="creation-key",
            seed_theory_id="seed",
        )
    assert (raised.value.__cause__ if failure == "profile" else raised.value) is error
    assert (
        events
        == ["release", "profile", "persist"][: {"release": 1, "profile": 2, "persist": 3}[failure]]
    )


def test_http_create_is_only_command_adapter():
    tree = ast.parse(inspect.getsource(research_tasks.create_research_task))
    attributes = {node.attr for node in ast.walk(tree) if isinstance(node, ast.Attribute)}
    assert not attributes & {
        "app",
        "state",
        "current_release",
        "get_theory_profile",
        "DRAFT",
        "IN_PROGRESS",
        "MATERIALS",
        "PHENOMENON",
        "EXISTING_RESEARCH",
    }
    assert not any(isinstance(node, (ast.If, ast.IfExp, ast.With)) for node in ast.walk(tree))
    calls = [node for node in ast.walk(tree) if isinstance(node, ast.Call)]
    create_calls = [
        node
        for node in calls
        if isinstance(node.func, ast.Attribute) and node.func.attr == "create"
    ]
    assert len(create_calls) == 1
    assert ast.unparse(create_calls[0].func) == "command.create"


def test_seeded_api_replay_lookup_order_and_exact_missing_seed_error(plain_client, monkeypatch):
    client = plain_client
    authenticate(client)
    events = []
    missing = False

    class Catalog:
        def current_release(self, *, purpose):
            assert purpose is KnowledgeUsePurpose.BROWSE
            events.append("release")
            return SimpleNamespace(knowledge_release_id="release")

        def get_theory_profile(self, **kwargs):
            assert kwargs == {"theory_id": "seed", "release_id": "release"}
            events.append("profile")
            if missing:
                raise LookupError("seed removed")
            return SimpleNamespace(title="Seed title")

    monkeypatch.setattr(client.app.state, "knowledge_catalog", Catalog())
    original = ResearchTaskService.create

    def create(self, **kwargs):
        events.append("persist")
        return original(self, **kwargs)

    monkeypatch.setattr(ResearchTaskService, "create", create)
    headers = {"Idempotency-Key": "seeded-replay-key"}
    payload = {"seed_theory_id": "seed"}
    first = client.post("/api/research-tasks", headers=headers, json=payload)
    second = client.post("/api/research-tasks", headers=headers, json=payload)
    assert first.status_code == second.status_code == 201
    assert first.json() == second.json()
    assert first.json()["project_title"] == "Seed title"
    assert events == ["release", "profile", "persist"] * 2
    missing = True
    response = client.post("/api/research-tasks", headers=headers, json=payload)
    assert response.status_code == 422
    body = response.json()
    assert body["error"]["message"] == "Request failed."
    assert body["error"]["code"] == "validation_error"
    assert UUID(body["error"]["trace_id"])
    assert events == ["release", "profile", "persist"] * 2 + ["release", "profile"]
    restored = client.get(f"/api/research-tasks/{first.json()['task_id']}")
    assert restored.json() == first.json()


def test_create_key_is_scoped_to_owner(plain_client):
    client = plain_client
    headers = {"Idempotency-Key": "shared-between-owners"}
    authenticate(client)
    first = client.post("/api/research-tasks", headers=headers, json={})
    client.cookies.clear()
    authenticate(client)
    second = client.post("/api/research-tasks", headers=headers, json={})
    assert first.status_code == second.status_code == 201
    assert first.json()["task_id"] != second.json()["task_id"]
    assert client.get(f"/api/research-tasks/{first.json()['task_id']}").status_code == 404
    assert client.post("/api/research-tasks", headers=headers, json={}).json() == second.json()


def test_response_conversion_failure_rolls_back_existing_service_scope(plain_client, monkeypatch):
    client = plain_client
    authenticate(client)
    headers = {"Idempotency-Key": "rollback-response-conversion"}
    created_ids = []
    original = ResearchTaskService.create

    def create(self, **kwargs):
        task = original(self, **kwargs)
        created_ids.append(task.task_id)
        return task

    def fail(_task):
        raise RuntimeError("synthetic serialization failure")

    with monkeypatch.context() as patch:
        patch.setattr(ResearchTaskService, "create", create)
        patch.setattr(research_tasks.ResearchTaskResponse, "from_domain", fail)
        with pytest.raises(RuntimeError, match="synthetic serialization failure"):
            client.post("/api/research-tasks", headers=headers, json={})
    assert len(created_ids) == 1
    assert client.get(f"/api/research-tasks/{created_ids[0]}").status_code == 404
    retry = client.post("/api/research-tasks", headers=headers, json={})
    assert retry.status_code == 201
    assert UUID(retry.json()["task_id"]) != created_ids[0]


def test_http_adapter_keeps_exact_seed_exception_detail():
    class MissingSeed:
        def create(self, **kwargs):
            raise SeedTheoryNotInCurrentRelease

    with pytest.raises(HTTPException) as raised:
        research_tasks.create_research_task(
            payload=research_tasks.CreateResearchTaskRequest(seed_theory_id="missing"),
            command=MissingSeed(),
            current=SimpleNamespace(user=SimpleNamespace(user_id=uuid4())),
            idempotency_key="missing-seed-key",
        )
    assert raised.value.status_code == 422
    assert raised.value.detail == "Seed theory is not in the current knowledge release."
