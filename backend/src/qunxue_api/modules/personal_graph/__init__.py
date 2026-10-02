"""Incremental, deterministic greedy cosine clustering of personal documents."""

import hashlib
import math
import re


def cosine(a, b):
    if len(a) != len(b) or not a or not b:
        return 0.0
    norm = math.sqrt(sum(x * x for x in a) * sum(x * x for x in b))
    return sum(x * y for x, y in zip(a, b, strict=True)) / norm if norm else 0.0


def mock_vector(text, size=96):
    """Offline test/dev representation, explicitly not a semantic model embedding."""
    vector = [0.0] * size
    tokens = re.findall(r"[a-z0-9]+|[\u4e00-\u9fff]{2}", text.lower())
    for token in tokens:
        bucket = int(hashlib.sha256(token.encode()).hexdigest()[:8], 16) % size
        vector[bucket] += 1
    norm = math.sqrt(sum(x * x for x in vector))
    return [x / norm for x in vector] if norm else vector


def update_clusters(previous, documents, *, limit=300, threshold=0.36, name_topic=None):
    docs = {d["id"]: d for d in documents}
    assignments = {
        k: v
        for k, v in previous.get("assignments", {}).items()
        if k in docs and v["hash"] == docs[k]["hash"]
    }
    topics = {}
    for id, assignment in assignments.items():
        topic_id = assignment["topic_id"]
        topic = topics.setdefault(
            topic_id,
            {"id": topic_id, "label": previous["topics"][topic_id]["label"], "members": []},
        )
        topic["members"].append(id)

    def centroid(ids):
        vectors = [docs[id]["vector"] for id in ids if docs[id].get("vector")]
        if not vectors:
            return []
        size = len(vectors[0])
        vectors = [v for v in vectors if len(v) == size]
        return [sum(v[i] for v in vectors) / len(vectors) for i in range(size)]

    for topic in topics.values():
        topic["centroid"] = centroid(topic["members"])
    pending = [d for d in documents if d["id"] not in assignments]
    for doc in pending[:limit]:
        if not doc.get("vector"):
            continue
        match = max(
            topics.values(), key=lambda t: cosine(doc["vector"], t["centroid"]), default=None
        )
        if match is None or cosine(doc["vector"], match["centroid"]) < threshold:
            topic_id = "topic:" + hashlib.sha256(doc["id"].encode()).hexdigest()[:16]
            label = name_topic([doc["title"]]) if name_topic else doc["title"][:24]
            match = topics[topic_id] = {
                "id": topic_id,
                "label": label,
                "members": [],
                "centroid": [],
            }
        match["members"].append(doc["id"])
        match["centroid"] = centroid(match["members"])
        assignments[doc["id"]] = {"topic_id": match["id"], "hash": doc["hash"]}
    return {"topics": topics, "assignments": assignments}, sum(
        d["id"] not in assignments for d in documents
    )
