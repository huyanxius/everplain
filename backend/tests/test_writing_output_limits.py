from uuid import uuid4

import pytest

from qunxue_api.api.writing_errors import safe_writing_output_message
from qunxue_api.application.writing import WritingPipeline
from qunxue_api.modules.writing import WritingUnsafeOutput


@pytest.mark.parametrize(
    "payload",
    [
        {"action": "continue", "instruction": "续写"},
        {"action": "rewrite", "instruction": "改写", "selection_start": 0, "selection_end": 1},
    ],
)
def test_revision_cannot_create_document_that_exceeds_save_contract(payload):
    pipeline = WritingPipeline(lambda *_: "新文字")
    with pytest.raises(WritingUnsafeOutput):
        pipeline.generate({"genre": "fiction", "markdown": "原" * 200000}, payload, [], uuid4())


def test_continuation_at_exact_document_limit_is_allowed():
    pipeline = WritingPipeline(lambda *_: "新" * 8)
    result, _ = pipeline.generate(
        {"genre": "fiction", "markdown": "原" * 199990},
        {"action": "continue", "instruction": "续写"},
        [],
        uuid4(),
    )
    assert len(result) == 200000


def test_output_limit_has_safe_specific_message_but_unknown_output_errors_do_not():
    fixed = "修订后文稿超过长度上限，请拆分章节后重试；原文保持不变"
    assert safe_writing_output_message(WritingUnsafeOutput(fixed)) == fixed
    assert "private-output" not in safe_writing_output_message(
        WritingUnsafeOutput("private-output")
    )
