from uuid import UUID, uuid4

from test_research_material_api import _authenticate, _task

from qunxue_api.modules.agent_conversation import AgentRunResult


def section(content="We compared offline workflows and identified the remaining evidence gaps."):
    return {
        "section_id": "summary",
        "key": "summary",
        "title": "Findings",
        "content": content,
        "status": "reviewed",
        "evidence_refs": [],
    }


def test_personal_document_can_be_created_edited_exported_without_theory_plan(plain_client):
    client = plain_client
    _authenticate(client)
    task = _task(client)
    created = client.post(
        f"/api/research-tasks/{task}/research-documents",
        headers={"Idempotency-Key": str(uuid4())},
        json={"title": "Workflow research", "sections": [section()]},
    )
    assert created.status_code == 201, created.text
    document = created.json()
    assert document["theory_plan_id"] is None
    document_id = document["document_id"]
    updated = client.patch(
        f"/api/research-documents/{document_id}",
        headers={"Idempotency-Key": str(uuid4())},
        json={
            "expected_version": 1,
            "sections": [section("Reviewed final conclusions.")],
            "change_summary": "Revise findings",
            "source": "user_edit",
        },
    )
    assert updated.status_code == 200, updated.text
    exported = client.get(f"/api/research-documents/{document_id}/export")
    assert exported.status_code == 200, exported.text
    assert "Reviewed final conclusions." in exported.json()["markdown"]
    assert exported.json()["manifest"]["schema_version"] == "everplain-document-v1"
    client.cookies.clear()
    _authenticate(client)
    assert client.get(f"/api/research-documents/{document_id}").status_code == 404


def test_personal_agent_can_propose_document_and_user_accepts_without_matching(plain_client):
    client = plain_client
    identity = _authenticate(client)

    class Runner:
        def run(self, *, prompt, conversation, tools):
            self.proposal = tools.propose_document_creation(
                title="Product research", sections=[section()], rationale="Save current findings"
            )
            assert "error" not in self.proposal, self.proposal
            return AgentRunResult(
                answer="研究文稿已生成，请采纳。",
                citations=(),
                release_id=tools.release.knowledge_release_id,
                provider="test",
                model="proposal-boundary",
            )

    runner = Runner()
    with client.app.state.disciplinary_agent_scope() as app:
        app._runner = runner
        result = app.run_turn(
            user_id=UUID(identity["user"]["user_id"]),
            conversation_id=None,
            prompt="Create a document with our findings",
            workspace="research",
            idempotency_key=str(uuid4()),
        )
    accepted = client.post(
        f"/api/research-document-proposals/{runner.proposal['proposal_id']}/accept",
        headers={"Idempotency-Key": str(uuid4())},
        json={"expected_document_version": None},
    )
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["document"]["theory_plan_id"] is None
    assert result.turn is not None


def test_private_document_citations_are_verified_and_deletion_blocks_export(plain_client):
    from test_shared_knowledge_api import create_library, mutation, upload

    client = plain_client
    identity = _authenticate(client)
    kb = create_library(client)
    doc = upload(client, kb["id"], "EP-42 product interviews prefer offline search.")

    class Runner:
        def run(self, *, prompt, conversation, tools):
            sources = tools.read_knowledge_entry(str(doc["id"]))
            assert sources["citation_ids"]
            self.proposal = tools.propose_document_creation(
                title="Interview findings",
                sections=[
                    {
                        **section("Offline search was requested."),
                        "citation_ids": sources["citation_ids"],
                    }
                ],
                rationale="Keep research sources attached",
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
        first = app.run_turn(
            user_id=UUID(identity["user"]["user_id"]),
            conversation_id=None,
            prompt="Save interview findings",
            workspace="research",
            reference_knowledge_base_id=UUID(kb["id"]),
            idempotency_key=str(uuid4()),
        )
    accepted = mutation(
        client,
        "post",
        f"/api/research-document-proposals/{runner.proposal['proposal_id']}/accept",
        json={"expected_document_version": None},
    )
    assert accepted.status_code == 200, accepted.text
    document = accepted.json()["document"]
    ref = document["sections"][0]["evidence_refs"][0]
    assert ref["source_kind"] == "personal_knowledge"
    assert ref["material_id"] == doc["id"]
    assert (
        client.get(f"/api/research-documents/{document['document_id']}/export").status_code == 200
    )

    class RevisionRunner:
        def run(self, *, prompt, conversation, tools):
            self.proposal = tools.propose_document_revision(
                document_id=document["document_id"],
                expected_version=1,
                section_id="summary",
                replacement_content="The interviews show demand for offline search.",
                rationale="Polish the wording without changing findings",
            )
            assert "error" not in self.proposal, self.proposal
            return AgentRunResult(
                answer="Revision ready.",
                citations=(),
                release_id=tools.release.knowledge_release_id,
                provider="test",
                model="revision-boundary",
            )

    reviser = RevisionRunner()
    with client.app.state.disciplinary_agent_scope() as app:
        app._runner = reviser
        app.run_turn(
            user_id=UUID(identity["user"]["user_id"]),
            conversation_id=first.conversation.conversation_id,
            prompt="Polish the wording",
            workspace="research",
            idempotency_key=str(uuid4()),
        )
    revised = mutation(
        client,
        "post",
        f"/api/research-document-proposals/{reviser.proposal['proposal_id']}/accept",
        json={"expected_document_version": 1},
    )
    assert revised.status_code == 200, revised.text
    assert (
        revised.json()["document"]["sections"][0]["evidence_refs"]
        == document["sections"][0]["evidence_refs"]
    )
    mutation(client, "delete", f"/api/shared-knowledge-bases/{kb['id']}/documents/{doc['id']}")
    exported = client.get(f"/api/research-documents/{document['document_id']}/export")
    assert exported.status_code == 409, exported.text


def test_generic_document_rejects_foreign_private_source(plain_client):
    from test_shared_knowledge_api import create_library, mutation, upload

    client = plain_client
    _authenticate(client)
    kb = create_library(client)
    doc = upload(client, kb["id"], "Owner confidential finding EP-SECRET.")
    source = client.get(
        f"/api/shared-knowledge-bases/{kb['id']}/documents/{doc['id']}/source"
    ).json()
    segment = source["segments"][0]
    client.cookies.clear()
    _authenticate(client)
    task = _task(client)
    key = f"material:{doc['id']}:{segment['segment_id']}"
    created = mutation(
        client,
        "post",
        f"/api/research-tasks/{task}/research-documents",
        json={
            "title": "Foreign source",
            "sections": [
                {
                    **section(),
                    "evidence_refs": [
                        {
                            "evidence_ref_id": key,
                            "source_id": key,
                            "source_kind": "personal_knowledge",
                            "material_id": doc["id"],
                            "parse_id": doc["parse_id"],
                            "segment_id": segment["segment_id"],
                            "locator": segment["locator"],
                        }
                    ],
                }
            ],
        },
    )
    assert created.status_code == 409, created.text


def test_agent_cannot_read_document_with_removed_private_sources(plain_client):
    from test_shared_knowledge_api import create_library, mutation, upload

    client = plain_client
    identity = _authenticate(client)
    kb = create_library(client)
    doc = upload(client, kb["id"], "A confidential customer finding.")

    class Runner:
        document_id = None

        def run(self, *, prompt, conversation, tools):
            if self.document_id:
                self.read = tools.read_research_document(document_id=self.document_id)
            else:
                sources = tools.read_knowledge_entry(str(doc["id"]))
                self.proposal = tools.propose_document_creation(
                    title="Customer analysis",
                    sections=[{**section(), "citation_ids": sources["citation_ids"]}],
                    rationale="Record sources",
                )
            return AgentRunResult(
                answer="Done.",
                citations=tuple(tools.evidence.values()),
                release_id=tools.release.knowledge_release_id,
                provider="test",
                model="source-boundary",
            )

    runner = Runner()
    with client.app.state.disciplinary_agent_scope() as app:
        app._runner = runner
        first = app.run_turn(
            user_id=UUID(identity["user"]["user_id"]),
            conversation_id=None,
            prompt="Save findings",
            workspace="research",
            reference_knowledge_base_id=UUID(kb["id"]),
            idempotency_key=str(uuid4()),
        )
    accepted = mutation(
        client,
        "post",
        f"/api/research-document-proposals/{runner.proposal['proposal_id']}/accept",
        json={"expected_document_version": None},
    )
    runner.document_id = accepted.json()["document"]["document_id"]
    mutation(client, "delete", f"/api/shared-knowledge-bases/{kb['id']}/documents/{doc['id']}")
    with client.app.state.disciplinary_agent_scope() as app:
        app._runner = runner
        app.run_turn(
            user_id=UUID(identity["user"]["user_id"]),
            conversation_id=first.conversation.conversation_id,
            prompt="Read my old document",
            workspace="research",
            idempotency_key=str(uuid4()),
        )
    assert runner.read["error"] == "research_document_sources_unavailable"
