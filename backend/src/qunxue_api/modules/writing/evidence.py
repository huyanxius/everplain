"""Bounded, deterministic sample previews and reference windows; no model or I/O."""

import re
from math import log1p

MAX_REFERENCE_CHARACTERS = 600
_DELETED_HEADING = re.compile(r"^(?:删去的|删去部分|删除的段落|已删除内容|弃稿)[：:]?$")
_WORK_HEADING = re.compile(
    r"^(?:\d+[.、．]\s*)?(?:散文(?:随笔)?(?:风格)?|随笔(?:风格)?|"
    r"小说(?:\s*[/／]\s*剧本)?|剧本|论文|公文|报告|读书报告|读书笔记|"
    r"辩论(?:文体|资料|稿))(?:[：:].*|[（(].*[）)])?$"
)


def _heading(line: str) -> tuple[str, bool] | None:
    stripped = line.strip()
    title = re.sub(r"^#{1,6}\s+", "", stripped).strip()
    if _DELETED_HEADING.fullmatch(title):
        return title, True
    if _WORK_HEADING.fullmatch(title) or re.match(r"^#\s+\S", stripped):
        return title, False
    return None


def sample_import_preview(text: str, title: str) -> list[dict]:
    """Suggest boundaries only. No genre inference, writes, or independent-work claim."""
    items, lines = [], []
    current_title, excluded = title, False

    def flush():
        body = "\n".join(lines).strip()
        if body:
            items.append(
                {
                    "title": current_title[:200],
                    "text": body,
                    "character_count": len(re.sub(r"\s+", "", body)),
                    "excluded_reason": "原文标记为删去或弃稿，默认不导入。" if excluded else None,
                }
            )

    for line in text.splitlines():
        heading = _heading(line)
        if heading:
            flush()
            lines = []
            current_title, excluded = heading
        else:
            lines.append(line)
    flush()
    return items


def eligible_sample_text(text: str) -> str:
    """Do not reintroduce clearly marked discarded sections from legacy uploads."""
    return "\n\n".join(
        item["text"] for item in sample_import_preview(text, "样文") if not item["excluded_reason"]
    )


def _terms(text: str) -> set[str]:
    # Bounded lexical relevance is explainable and does not require a second model/index.
    text = text[:6000].lower()
    terms = set(re.findall(r"[a-z0-9]{2,}", text))
    for run in re.findall(r"[\u3400-\u9fff]+", text):
        terms.update(run[i : i + 2] for i in range(len(run) - 1))
    return terms


def reference_windows(text: str) -> list[str]:
    """Whole paragraphs/sentences only. Oversized single sentences are omitted, not cut."""
    result = []
    for paragraph in re.split(r"\n\s*\n", eligible_sample_text(text)):
        paragraph = paragraph.strip()
        if not paragraph:
            continue
        if len(paragraph) <= MAX_REFERENCE_CHARACTERS:
            result.append(paragraph)
            continue
        sentences = re.findall(r".*?(?:[。！？!?][”’\"」』]*|\.(?=\s|$)|$)", paragraph, re.S)
        chunk = ""
        for sentence in sentences:
            if not sentence.strip():
                continue
            if len(sentence.strip()) > MAX_REFERENCE_CHARACTERS:
                if chunk:
                    result.append(chunk.strip())
                    chunk = ""
                continue
            if len(chunk) + len(sentence) > MAX_REFERENCE_CHARACTERS:
                if chunk:
                    result.append(chunk.strip())
                chunk = ""
            chunk += sentence if chunk else sentence.lstrip()
        if chunk:
            result.append(chunk.strip())
    return result


def select_reference_window(text: str, target: str) -> tuple[str, float]:
    query = _terms(target)
    size = min(max(len(target), 300), MAX_REFERENCE_CHARACTERS)
    ranked = []
    for index, window in enumerate(reference_windows(text)):
        overlap = len(query & _terms(window)) / max(len(query), 1)
        # With no lexical evidence, prefer a complete length-relevant window.
        ranked.append((overlap, -abs(log1p(len(window)) - log1p(size)), -index, window))
    if not ranked:
        return "", 0.0
    score, _, _, window = max(ranked)
    return window, score
