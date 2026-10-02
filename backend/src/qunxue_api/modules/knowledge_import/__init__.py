"""Import batch states independent of HTTP, formats and storage."""

from collections import Counter


class ImportUnavailable(LookupError):
    pass


def batch_progress(items):
    counts = Counter(item["status"] for item in items)
    total = len(items)
    finished = counts["imported"] + counts["duplicate"] + counts["failed"]
    return {
        "total": total,
        "finished": finished,
        "imported": counts["imported"],
        "duplicates": counts["duplicate"],
        "failed": counts["failed"],
        "status": "processing"
        if finished < total
        else "partial"
        if counts["failed"]
        else "completed",
    }
