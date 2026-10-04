import hashlib
from pathlib import PurePosixPath

from qunxue_api.modules.personal_graph import update_clusters


class PersonalGraphApplication:
    def __init__(self, repository, *, name_topic=None):
        self.repository, self.name_topic = repository, name_topic

    def refresh(self, user_id, *, eligible_document_ids=None):
        docs = self.repository.documents(user_id)
        previous = self.repository.load(user_id)
        if eligible_document_ids is None and "scope_document_ids" in previous:
            eligible_document_ids = set(previous["scope_document_ids"])
        if eligible_document_ids is not None:
            docs = [doc for doc in docs if doc["id"] in eligible_document_ids]
        if any(not doc.get("vector") or not doc.get("knowledge_ready", True) for doc in docs):
            # Background work must not silently generate a partial graph or hot
            # retry an index/knowledge stage it does not own. Explicit repair and
            # refresh can resume later; keep the previous visible graph intact.
            self.repository.save(user_id, self.repository.load(user_id), False)
            return self.read(user_id)
        state, pending = update_clusters(
            previous, docs, limit=300, name_topic=None
        )
        state["scope_document_ids"] = [doc["id"] for doc in docs]
        if self.name_topic:
            old_state = self.repository.load(user_id)
            old_topics = old_state.get("topics", {}) if old_state.get("named_by_model") else {}
            todo = [
                {"id": key, "titles": [d["title"] for d in docs if d["id"] in topic["members"]][:5]}
                for key, topic in state["topics"].items()
                if key not in old_topics
            ]
            if todo:
                try:
                    labels = self.name_topic(todo)
                    state["named_by_model"] = bool(labels)
                    for key, label in labels.items():
                        if key in state["topics"]:
                            state["topics"][key]["label"] = label
                except Exception:
                    # Keep source-title labels if the optional naming provider is unavailable.
                    pass
        # Missing model embeddings cannot be fixed by an infinite hot retry loop.
        can_continue = any(d.get("vector") and d["id"] not in state["assignments"] for d in docs)
        self.repository.save(user_id, state, bool(pending and can_continue))
        return self.read(user_id)

    def read(self, user_id):
        profile = self.repository.profile(user_id)
        docs = self.repository.documents(user_id)
        total_count = len(docs)
        state = self.repository.load(user_id)
        if "scope_document_ids" in state:
            selected = set(state["scope_document_ids"])
            docs = [doc for doc in docs if doc["id"] in selected]
        live = {d["id"]: d for d in docs}
        assignments = {
            key: value
            for key, value in state["assignments"].items()
            if key in live and value["hash"] == live[key]["hash"]
        }
        nodes = [{"id": "self", "label": profile.name, "nodeType": "self", "level": 0}]
        edges, sources = [], {}

        def edge(a, b, label="属于"):
            edges.append(
                {
                    "id": a + "->" + b,
                    "source": a,
                    "target": b,
                    "relationType": label,
                    "direction": "undirected",
                    "layer": "structure",
                }
            )

        topic_ids = {a["topic_id"] for id, a in assignments.items() if id in live}
        for tid in sorted(topic_ids):
            nodes.append(
                {"id": tid, "label": state["topics"][tid]["label"], "nodeType": "topic", "level": 1}
            )
            edge("self", tid)
        for interest in profile.questionnaire.get("interests", []):
            tid = "interest:" + hashlib.sha256(interest.encode()).hexdigest()[:12]
            nodes.append({"id": tid, "label": interest, "nodeType": "topic", "level": 1})
            edge("self", tid, "兴趣")
        pending = sum(d["id"] not in assignments for d in docs)
        if pending:
            nodes.append({"id": "pending", "label": "待归类资料", "nodeType": "topic", "level": 1})
            edge("self", "pending")
        for doc in docs:
            id = "document:" + doc["id"]
            nodes.append({"id": id, "label": doc["title"], "nodeType": "document", "level": 2})
            sources[id] = {
                "library_id": doc["library_id"],
                "document_id": doc["id"],
                "title": doc["title"],
                "source_url": doc["source_url"],
                "asset_url": doc.get("asset_url"),
            }
            edge(assignments.get(doc["id"], {}).get("topic_id", "pending"), id)
            for topic in doc["knowledge"].get("topics", []):
                pid = (
                    "point:"
                    + doc["id"]
                    + ":"
                    + hashlib.sha256(topic["title"].encode()).hexdigest()[:12]
                )
                nodes.append(
                    {"id": pid, "label": topic["title"], "nodeType": "knowledge", "level": 3}
                )
                sources[pid] = sources[id] | {"segment_id": (topic.get("segment_ids") or [None])[0]}
                edge(id, pid, "知识点")
        by_path = {str(PurePosixPath(d["relative_path"]).with_suffix("")): d for d in docs}
        by_name = {}
        for d in docs:
            by_name.setdefault(PurePosixPath(d["relative_path"]).stem, []).append(d)
        for d in docs:
            for link in d["wiki_links"]:
                target = link.split("#")[0].split("|")[0]
                candidate = by_path.get(target) or by_path.get(
                    str(PurePosixPath(d["relative_path"]).parent / target)
                )
                matches = by_name.get(PurePosixPath(target).stem, [])
                candidate = candidate or (matches[0] if len(matches) == 1 else None)
                if candidate and candidate["id"] != d["id"]:
                    edge("document:" + d["id"], "document:" + candidate["id"], "双链")
        return {
            "coverage": {"included_count": len(docs), "total_count": total_count,
                         "excluded_count": total_count - len(docs)},
            "releaseId": "personal",
            "nodes": nodes,
            "edges": edges,
            "sources": sources,
            "pending_count": pending,
            "document_count": len(docs),
            "topic_count": len(topic_ids),
            "mode": "mock" if self.repository.mock else "semantic",
            "avatar_id": profile.avatar_id,
            "color": profile.color,
            "name": profile.name,
        }
