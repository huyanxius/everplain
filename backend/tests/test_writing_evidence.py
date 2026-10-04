"""Synthetic evidence/import fixtures only; never author material or model calls."""

from uuid import uuid4

from qunxue_api.application.writing import WritingPipeline
from qunxue_api.modules.writing import StyleSample, retrieve_samples, style_profile


def test_limited_profile_keeps_observations_without_claiming_stable_style():
    sample = StyleSample("one", "片段", "essay", "河岸的风停了，我沿着旧路往前走。灯还亮着。")
    profile = style_profile([sample], "essay")
    assert profile["readiness"] == "limited"
    assert profile["metrics"] == {}
    assert profile["observed_metrics"]["sentence_length"] > 0
    assert profile["observation_confidence"] == "limited"


def test_full_work_count_is_not_inflated_by_paragraphs():
    sample = StyleSample("one", "一篇作品", "fiction", ("一段很长的文字，带有一些停顿。\n\n" * 120))
    profile = style_profile([sample], "fiction")
    assert profile["sample_count"] == 1
    assert profile["readiness"] == "limited"
    assert profile["observed_metrics"]


def test_retrieval_finds_later_relevant_complete_sentences():
    sample = StyleSample(
        "one",
        "雨后",
        "essay",
        "窗边的植物慢慢生长。" * 90 + "\n\n雨停之后，旅人在旧车站收起雨伞。列车还没有来。",
    )
    selected = retrieve_samples([sample], "essay", "写旧车站等列车，雨停后收起雨伞")
    assert len(selected) == 1
    assert "雨伞" in selected[0].text
    assert len(selected[0].text) <= 600
    assert selected[0].text.endswith(("。", "！", "？", "”", "」"))


def test_retrieval_never_uses_explicitly_deleted_tail():
    keep = "河岸上还留着昨夜的雨水。" * 10
    deleted = "秘密的火车站只存在于弃稿。" * 10
    selected = retrieve_samples(
        [StyleSample("one", "样文", "essay", keep + "\n\n删去的：\n\n" + deleted)],
        "essay",
        "秘密的火车站",
    )
    assert selected
    assert "秘密" not in selected[0].text
    assert "删去的" not in selected[0].text


def test_prose_mention_of_deletion_is_not_a_deleted_heading():
    text = "她把删去的段落放回书里，然后继续读了下去。"
    assert (
        retrieve_samples([StyleSample("one", "小说", "fiction", text)], "fiction", "读书")[0].text
        == text
    )


def test_instruction_is_used_for_blank_document_reference_selection():
    samples = [
        StyleSample(
            "one",
            "笔记",
            "essay",
            "晴天的庭院十分安静。" * 80 + "\n\n雨伞下的旧车站，列车迟迟没有来。",
        )
    ]
    calls = []

    def stage(instructions, payload, run_id):
        calls.append(payload)
        return "保留事实。" if payload["stage"] == "content_plan" else "站台很安静。"

    WritingPipeline(stage).generate(
        {"genre": "essay", "markdown": ""},
        {"action": "continue", "instruction": "写雨伞下的旧车站和列车"},
        samples,
        uuid4(),
    )
    assert "雨伞" in calls[0]["reference_samples"][0]["text"]
    assert calls[0]["style_evidence"]["reference_observations"][0]["sample_id"] == "one"


def test_overlong_sentence_is_not_cut_midway():
    sample = StyleSample("one", "长句", "essay", "甲" * 650 + "。\n\n另一段是完整句。")
    selected = retrieve_samples([sample], "essay", "甲")
    assert selected[0].text == "另一段是完整句。"


def test_retrieval_retains_same_genre_and_deduplication():
    text = "在远处，雨水沿着屋檐落下来。"
    samples = [
        StyleSample("one", "a", "essay", text),
        StyleSample("two", "b", "essay", text),
        StyleSample("three", "c", "fiction", text),
    ]
    assert len(retrieve_samples(samples, "essay", "下雨")) == 1


def test_reference_windows_preserve_english_sentence_spacing():
    text = "The station was quiet. The rain had stopped. " * 30
    selected = retrieve_samples([StyleSample("one", "essay", "essay", text)], "essay", "rain")
    assert selected[0].text in text
    assert ". The" in selected[0].text


def test_no_complete_reference_reports_the_evidence_gap():
    sample = StyleSample("one", "long", "essay", "甲" * 2000 + "。")

    def stage(instructions, payload, run_id):
        return "计划" if payload["stage"] == "content_plan" else "新的正文。"

    _, warnings = WritingPipeline(stage).generate(
        {"genre": "essay", "markdown": "原文。"},
        {"action": "personalize", "instruction": "按样文修改"},
        [sample],
        uuid4(),
    )
    assert any("没有引用样文" in warning for warning in warnings)
