"""Public writing messages only; never broaden generic HTTP/provider error disclosure."""

from uuid import uuid4

from fastapi.responses import JSONResponse

from qunxue_api.api.contracts.common import ErrorCode, ErrorDetail, ErrorResponse


class WritingApiError(Exception):
    def __init__(self, status_code: int, code: ErrorCode, message: str):
        super().__init__(message)
        self.status_code, self.code, self.message = status_code, code, message


# Only our own fixed validation strings can cross this boundary. A model, parser,
# Pydantic or provider ValueError can contain source text or connection details.
_VALIDATION_MESSAGES = {
    "请选择有效的原文范围",
    "选区不能拆开一个字符",
    "本次最多改写20000个字符，请先选择一个章节",
    "原文为空，请使用续写并说明要写的内容",
    "续写不接受选区，请使用改写处理选区",
    "样文至少需要80个有效字符和一个标题",
    "样文支持 Markdown、TXT、DOCX 和带文字的 PDF",
    "标题不能为空",
    "没有要保存的修改",
    "最多保留100篇样文，请先移除不再使用的文章",
}


def safe_writing_validation_message(error):
    message = str(error)
    return (
        message
        if message in _VALIDATION_MESSAGES
        else "输入不符合写作要求，请检查文件格式、长度或选区"
    )


def safe_writing_output_message(error):
    message = str(error)
    if message == "修订后文稿超过长度上限，请拆分章节后重试；原文保持不变":
        return message
    return "改写未通过基础保护检查，原文保持不变；请检查事实、引用、结构或样文复制。"


def install_writing_error_handlers(app):
    async def handle(_request, error: WritingApiError):
        body = ErrorResponse(
            error=ErrorDetail(
                code=error.code,
                message=error.message,
                trace_id=str(uuid4()),
            )
        )
        return JSONResponse(status_code=error.status_code, content=body.model_dump(mode="json"))

    app.add_exception_handler(WritingApiError, handle)
