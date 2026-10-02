from uuid import uuid4

from test_knowledge_import import drain, start
from test_research_material_api import _authenticate

from qunxue_api.modules.personal_graph import update_clusters


def test_incremental_cluster_ids_and_300_limit():
    docs = [
        {"id": str(i), "hash": "1", "title": f"Doc{i}", "vector": [1.0, 0.0]} for i in range(305)
    ]
    state, pending = update_clusters({}, docs)
    assert len(state["assignments"]) == 300 and pending == 5
    first_id = state["assignments"]["0"]["topic_id"]
    state2, pending = update_clusters(state, docs)
    assert pending == 0 and state2["assignments"]["0"]["topic_id"] == first_id
    state3, pending = update_clusters(state2, docs[1:])
    assert "0" not in state3["assignments"] and pending == 0
    assert state3["assignments"]["1"]["topic_id"] == first_id


def test_personal_graph_is_owner_scoped_and_source_bound(plain_client):
    c = plain_client
    c.app.state.import_worker_enabled = False
    _authenticate(c)
    start(
        c, [("vault/A.md", b"# Alpha\n\n[[B]]"), ("vault/B.md", b"# Beta\n\nSecond source")]
    )
    drain(c)
    response = c.post("/api/personal-graph/refresh", headers={"Idempotency-Key": str(uuid4())})
    assert response.status_code == 200, response.text
    graph = response.json()
    assert graph["document_count"] == 2 and graph["pending_count"] == 0
    assert graph["mode"] == "mock"
    assert any(e["relationType"] == "双链" for e in graph["edges"])
    source = next(iter(graph["sources"].values()))
    assert (
        c.get(
            f"/api/shared-knowledge-bases/{source['library_id']}/documents/{source['document_id']}/source"
        ).status_code
        == 200
    )
    c.delete(
        f"/api/shared-knowledge-bases/{source['library_id']}/documents/{source['document_id']}",
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert c.get("/api/personal-graph").json()["document_count"] == 1
    _authenticate(c)
    other = c.get("/api/personal-graph").json()
    assert other["document_count"] == 0 and not other["sources"]
