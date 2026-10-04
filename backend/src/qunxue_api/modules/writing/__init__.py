"""Private, genre-scoped writing data and deterministic style diagnostics.

This module makes no provider calls and treats samples as data, never instructions.
Readiness thresholds are product safeguards, not validated confidence estimates.
"""

import re
from dataclasses import dataclass
from enum import StrEnum
from hashlib import sha256
from statistics import mean, median

from .evidence import eligible_sample_text, sample_import_preview, select_reference_window
from .grounding import quantities, redact_style_contacts, sample_contact_leaks

__all__ = [
    "MAX_DOCUMENT_CHARACTERS",
    "Genre",
    "StyleSample",
    "WritingConflict",
    "WritingUnavailable",
    "WritingUnsafeOutput",
    "fingerprint",
    "features",
    "style_profile",
    "retrieve_samples",
    "cliché_findings",
    "protected_markers",
    "output_issues",
    "utf16_slice",
    "redact_style_contacts",
    "sample_import_preview",
]

MAX_DOCUMENT_CHARACTERS = 200000


class Genre(StrEnum):
    OFFICIAL = "official"
    REPORT = "report"
    ACADEMIC = "academic"
    FICTION = "fiction"
    ESSAY = "essay"


class WritingConflict(ValueError):
    pass


class WritingUnavailable(RuntimeError):
    pass


class WritingUnsafeOutput(ValueError):
    pass


@dataclass(frozen=True)
class StyleSample:
    sample_id: str
    title: str
    genre: str
    text: str


def fingerprint(text: str) -> str:
    return sha256(re.sub(r"\s+", "", text).encode()).hexdigest()


def features(text: str) -> dict[str, float]:
    sentences = [s.strip() for s in re.split(r"[。！？!?\n]+|\.(?:\s|$)", text) if s.strip()]
    paragraphs = [p for p in re.split(r"\n\s*\n", text) if p.strip()]
    n = max(len(text), 1)
    return {
        "sentence_length": round(mean(map(len, sentences)), 2) if sentences else 0,
        "sentence_length_median": round(median(map(len, sentences)), 2) if sentences else 0,
        "sentence_length_max": max(map(len, sentences), default=0),
        "clauses_per_sentence": round(
            mean(
                len([part for part in re.split(r"[，,；;：:]", sentence) if part.strip()])
                for sentence in sentences
            ),
            2,
        )
        if sentences
        else 0,
        "paragraph_length": round(mean(map(len, paragraphs)), 2) if paragraphs else 0,
        "comma_per_100": round(100 * len(re.findall(r"[，,]", text)) / n, 3),
        "semicolon_per_100": round(100 * len(re.findall(r"[；;]", text)) / n, 3),
        "question_per_100": round(100 * len(re.findall(r"[？?]", text)) / n, 3),
        "dialogue_per_100": round(100 * len(re.findall(r"[“「\"]", text)) / n, 3),
    }


def style_profile(samples: list[StyleSample], genre: str) -> dict:
    selected = []
    for sample in samples:
        if sample.genre == genre:
            text = eligible_sample_text(sample.text)
            if text:
                selected.append(StyleSample(sample.sample_id, sample.title, sample.genre, text))
    n = len(selected)
    chars = sum(len(re.sub(r"\s+", "", s.text)) for s in selected)
    readiness = "empty" if not n else "ready" if n >= 3 and chars >= 1200 else "limited"
    # Observations describe supplied text; readiness is not an authorship confidence score.
    vectors = [features(s.text) for s in selected]
    observed = {k: round(mean(v[k] for v in vectors), 3) for k in vectors[0]} if vectors else {}
    metrics = {}
    if readiness == "ready":
        metrics = observed
    return {
        "genre": genre,
        "sample_count": n,
        "character_count": chars,
        "readiness": readiness,
        "metrics": metrics,
        "observed_metrics": observed,
        "observation_confidence": "none"
        if not n
        else "limited"
        if readiness != "ready"
        else "descriptive",
        "sample_ids": [s.sample_id for s in selected],
    }


def retrieve_samples(samples: list[StyleSample], genre: str, target: str) -> list[StyleSample]:
    """Same-genre, bounded relevant windows; one window per independent saved sample."""
    candidates = []
    for sample in samples:
        if sample.genre == genre:
            window, score = select_reference_window(sample.text, target)
            if window:
                candidates.append((score, sample.sample_id, sample, window))
    candidates.sort(key=lambda item: (-item[0], item[1]))
    result, seen = [], set()
    for _, _, sample, window in candidates:
        key = fingerprint(window)
        if key not in seen:
            result.append(StyleSample(sample.sample_id, sample.title, sample.genre, window))
            seen.add(key)
        if len(result) == 3:
            break
    return result


_CLICHES = {
    "defensive_preface": r"作为(?:一个|一名)?(?:AI|人工智能)|仅供参考|需要指出的是|值得注意的是",
    "formulaic_concession": (
        r"(?:诚然|固然|不可否认).{0,80}?(?:但是|然而|不过)|"
        r"你的.{0,30}?(?:很好|正确).{0,50}?(?:但是|不过)"
    ),
    "generic_closing": r"综上所述|总而言之|总的来说|让我们共同|在当今.{0,20}时代",
}


def cliché_findings(text: str) -> list[str]:
    return [name for name, pattern in _CLICHES.items() if re.search(pattern, text, re.S)]


def protected_markers(text: str) -> set[str]:
    """Conservative mechanical checks, never a factual-entailment guarantee."""
    return set(
        re.findall(
            r"https?://[^\s)\]>]+|\[\^[^\]]+\]|\[@[^\]]+\]|\[[0-9]+\]",
            text,
        )
    )


def output_issues(
    original: str,
    candidate: str,
    samples: list[StyleSample],
    *,
    instruction: str = "",
    continuation: bool = False,
    allow_new_quantities: bool = False,
) -> list[str]:
    issues = []
    old, new = protected_markers(original), protected_markers(candidate)
    allowed = old | protected_markers(instruction)
    if not continuation and old - new:
        issues.append("missing_facts_or_citations")
    if new - allowed:
        issues.append("unsupported_facts_or_citations")
    # Compare distinct normalized amounts, not occurrence counts: combining
    # "both groups have 12 people" must not fail merely for writing 12 once.
    # Assignment of an amount to its subject still requires semantic review.
    original_quantities, candidate_quantities = (
        set(quantities(original)),
        set(quantities(candidate)),
    )
    if not continuation and original_quantities - candidate_quantities:
        issues.append("missing_facts_or_citations")
    if not allow_new_quantities and candidate_quantities - (
        original_quantities | set(quantities(instruction))
    ):
        issues.append("unsupported_facts_or_citations")
    if sample_contact_leaks(original, candidate, [s.text for s in samples], instruction):
        issues.append("sample_contact_leak")
    compact = re.sub(r"\s+", "", candidate)
    original_compact = re.sub(r"\s+", "", original)
    candidate_spans = {compact[i : i + 32] for i in range(max(0, len(compact) - 31))}
    original_spans = {
        original_compact[i : i + 32] for i in range(max(0, len(original_compact) - 31))
    }
    new_spans = candidate_spans - original_spans
    for sample in samples:
        source = re.sub(r"\s+", "", sample.text)
        # Reject newly copied long spans; source draft reuse is allowed.
        if any(source[i : i + 32] in new_spans for i in range(max(0, len(source) - 31))):
            issues.append("copied_sample_span")
            break
    # Preserve opaque Markdown/Obsidian syntax instead of letting a rewrite corrupt it.
    if not continuation:
        protected = re.findall(
            r"\A---\n.*?\n---(?:\n|$)|```.*?```|~~~.*?~~~|\[\[.*?\]\]|"
            r"!\[[^\]]*\]\([^)]*\)|(?m:^> \[![^\]]+\])",
            original,
            re.S,
        )
        if any(fragment not in candidate for fragment in protected):
            issues.append("lost_markdown_structure")
    if not candidate.strip():
        issues.append("empty_output")
    return list(dict.fromkeys(issues))


def utf16_slice(text: str, start: int | None, end: int | None) -> tuple[str, str, str]:
    raw = text.encode("utf-16-le")
    if start is None and end is None:
        return "", text, ""
    if start is None or end is None or not 0 <= start < end <= len(raw) // 2:
        raise ValueError("请选择有效的原文范围")
    try:
        return tuple(
            part.decode("utf-16-le")
            for part in (raw[: start * 2], raw[start * 2 : end * 2], raw[end * 2 :])
        )
    except UnicodeDecodeError as exc:
        raise ValueError("选区不能拆开一个字符") from exc
