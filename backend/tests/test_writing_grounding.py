from uuid import uuid4

import pytest

from qunxue_api.application.writing import WritingPipeline
from qunxue_api.modules.writing import StyleSample, output_issues, redact_style_contacts
from qunxue_api.modules.writing.grounding import quantities


@pytest.mark.parametrize(
    ("old", "new"),
    [
        ("共12份材料。", "共十二份材料。"),
        ("木板长100厘米。", "木板长1米。"),
        ("木板长0.001公里。", "木板长一米。"),
        ("负载为1,000克。", "负载为1千克。"),
        ("完成率是12%。", "完成率是百分之十二。"),
        ("共120000000元。", "共一亿二千万元。"),
        ("共1000000000000元。", "共一万亿元。"),
    ],
)
def test_supported_numeric_renderings_and_exact_units(old, new):
    assert quantities(old) == quantities(new)
    assert output_issues(old, new, []) == []


@pytest.mark.parametrize(
    ("old", "new"),
    [
        ("木板长12厘米。", "木板长12米。"),
        ("会议在4月5日举行。", "会议在5月4日举行。"),
        ("甲组12人，乙组15人。", "甲组12人。"),
        ("只有12份记录。", "共有13份记录。"),
    ],
)
def test_material_quantity_changes_are_not_normalized_away(old, new):
    assert output_issues(old, new, [])


@pytest.mark.parametrize(
    "contact",
    [
        "writer@example.invalid",
        "+86 138 1234 5678",
        "https://private.example.invalid",
        "微信：sample_writer",
    ],
)
def test_style_contact_redacted_and_leak_blocked(contact):
    sample = StyleSample("synthetic", "样文", "essay", f"仅供文风参考。联系 {contact}。")
    assert contact not in redact_style_contacts(sample.text)
    assert "sample_contact_leak" in output_issues(
        "写一段天气。", f"天晴了。联系 {contact}。", [sample]
    )
    assert "sample_contact_leak" not in output_issues(
        f"联系 {contact}。", f"请联系 {contact}。", [sample]
    )
    assert "sample_contact_leak" not in output_issues(
        "天气。", f"联系 {contact}。", [sample], instruction=f"请加入 {contact}"
    )


def test_contacts_are_removed_before_any_model_stage():
    calls = []
    sample = StyleSample(
        "synthetic", "样文", "fiction", "联系 writer@example.invalid，电话13812345678。"
    )

    def stage(instructions, payload, run_id):
        calls.append(payload)
        return "计划" if payload["stage"] == "content_plan" else "雨终于停了。"

    WritingPipeline(stage).generate(
        {"genre": "fiction", "markdown": "雨停了。"},
        {"action": "personalize", "instruction": "更像我"},
        [sample],
        uuid4(),
    )
    assert len(calls) == 2
    for call in calls:
        reference = call["reference_samples"][0]["text"]
        assert "writer@example.invalid" not in reference
        assert "13812345678" not in reference


def test_rewrite_warns_semantics_are_unverified_without_claiming_keyword_fix():
    def stage(instructions, payload, run_id):
        return "计划" if payload["stage"] == "content_plan" else "报告发现异常。"

    result, warnings = WritingPipeline(stage).generate(
        {"genre": "academic", "markdown": "报告没有发现异常。"},
        {"action": "rewrite", "instruction": "润色"},
        [],
        uuid4(),
    )
    assert result == "报告发现异常。"  # Known limitation, deliberately exposed.
    assert any("未验证语义等价" in warning and "否定" in warning for warning in warnings)


def test_fiction_continuation_can_introduce_numbers_but_not_sample_contacts():
    def stage(instructions, payload, run_id):
        return "计划" if payload["stage"] == "content_plan" else "3名旅人等了2天，终于出发。"

    result, warnings = WritingPipeline(stage).generate(
        {"genre": "fiction", "markdown": "他们来到山口。"},
        {"action": "continue", "instruction": "续写故事"},
        [],
        uuid4(),
    )
    assert "3名旅人" in result
    assert any("人物设定" in warning for warning in warnings)
    sample = StyleSample("synthetic", "样文", "fiction", "联系 writer@example.invalid。")
    assert "sample_contact_leak" in output_issues(
        "", "联系 writer@example.invalid。", [sample], continuation=True, allow_new_quantities=True
    )


def test_nonfiction_continuation_requires_numeric_basis_but_ignores_list_ordinals():
    assert output_issues("已有12份材料。", "新增13份材料。", [], continuation=True)
    assert (
        output_issues(
            "已有12份材料。",
            "补充13份材料。",
            [],
            instruction="已确认补充13份材料",
            continuation=True,
        )
        == []
    )
    assert output_issues("先整理。", "1. 整理资料\n2. 核对出处", [], continuation=True) == []
    assert quantities("一定要检查，万一出错，也不能一概否定。") == {}


def test_large_exponent_does_not_crash_rule_checker():
    assert isinstance(output_issues("正文", "估计为1e9999999999999。", []), list)


def test_equivalent_repeated_quantity_and_phone_format_do_not_overblock():
    assert output_issues("甲组12人，乙组12人。", "两组各12人。", []) == []
    sample = StyleSample("synthetic", "样文", "essay", "电话 +86 138 1234 5678。")
    assert "sample_contact_leak" in output_issues("天气。", "联系13812345678。", [sample])
    assert "sample_contact_leak" not in output_issues(
        "联系13812345678。", "请联系 +86 138 1234 5678。", [sample]
    )


def test_known_sample_handle_remains_protected_without_contact_label():
    sample = StyleSample("synthetic", "样文", "essay", "微信：sample_writer。")
    assert "sample_contact_leak" in output_issues("天气。", "请联系sample_writer。", [sample])
    assert "sample_contact_leak" not in output_issues(
        "请联系sample_writer。", "联系sample_writer。", [sample]
    )
    assert "sample_contact_leak" not in output_issues(
        "天气。", "sample_writer。", [sample], instruction="加入sample_writer"
    )
