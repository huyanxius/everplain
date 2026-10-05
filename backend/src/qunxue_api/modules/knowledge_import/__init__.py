"""Import batch states independent of HTTP, formats and storage."""

import hashlib
import json
from collections import Counter


class ImportUnavailable(LookupError):
    pass


def source_fingerprint(item):
    payload = {
        "content": hashlib.sha256(item["content"]).hexdigest(),
        "filename": item["filename"],
        "metadata": item.get("metadata", item.get("details", {}).get("metadata", {})),
        "attachments": sorted(
            (asset["relative_path"], hashlib.sha256(asset["content"]).hexdigest())
            for asset in item.get("attachments", [])
        ),
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()


def batch_progress(items):
    counts = Counter(item["status"] for item in items)
    total = len(items)
    finished = counts["imported"] + counts["updated"] + counts["duplicate"] + counts["failed"]
    return {
        "total": total,
        "finished": finished,
        "imported": counts["imported"],
        "updated": counts["updated"],
        "duplicates": counts["duplicate"],
        "failed": counts["failed"],
        "status": "processing"
        if finished < total
        else "partial"
        if counts["failed"]
        else "completed",
    }
