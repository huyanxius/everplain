import re
from contextlib import contextmanager
from pathlib import Path
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, Request, UploadFile

from qunxue_api.api.contracts.common import ErrorCode
from qunxue_api.api.contracts.writing import (
    WritingDocumentCreate,
    WritingDocumentList,
    WritingDocumentResponse,
    WritingDocumentUpdate,
    WritingRevisionCreate,
    WritingRevisionList,
    WritingRevisionResolution,
    WritingRevisionResolve,
    WritingRevisionResponse,
    WritingSampleCreate,
    WritingSampleList,
    WritingSamplePreview,
    WritingSampleResponse,
    WritingSummary,
)
from qunxue_api.api.dependencies import CurrentSessionDependency
from qunxue_api.api.routes.stubs import IdempotencyKey
from qunxue_api.api.writing_errors import (
    WritingApiError,
    safe_writing_output_message,
    safe_writing_validation_message,
)
from qunxue_api.application.writing import WritingApplication
from qunxue_api.modules.billing import BillingFailure
from qunxue_api.modules.research_materials import MaterialParseError
from qunxue_api.modules.writing import (
    Genre,
    WritingConflict,
    WritingUnavailable,
    WritingUnsafeOutput,
)

router = APIRouter(prefix="/api/writing", tags=["writing"])


@contextmanager
def errors():
    try:
        yield
    except LookupError as exc:
        raise WritingApiError(404, ErrorCode.NOT_FOUND, "文稿或样文不存在") from exc
    except WritingConflict as exc:
        # Domain conflicts are created only from fixed application-owned messages.
        raise WritingApiError(409, ErrorCode.CONFLICT, str(exc)) from exc
    except WritingUnavailable as exc:
        raise WritingApiError(503, ErrorCode.CAPABILITY_UNAVAILABLE, str(exc)) from exc
    except WritingUnsafeOutput as exc:
        raise WritingApiError(
            422,
            ErrorCode.VALIDATION_ERROR,
            safe_writing_output_message(exc),
        ) from exc
    except MaterialParseError as exc:
        raise WritingApiError(
            422,
            ErrorCode.NO_EXTRACTABLE_TEXT,
            "无法解析样文，请检查格式、文件是否完整以及是否含有可提取的文字。",
        ) from exc
    except BillingFailure:
        # UnknownPrice is also a ValueError; keep the standard fail-closed billing envelope.
        raise
    except ValueError as exc:
        raise WritingApiError(
            422, ErrorCode.VALIDATION_ERROR, safe_writing_validation_message(exc)
        ) from exc


def application(request: Request):
    with errors(), request.app.state.writing_scope() as value:
        yield value


Application = Annotated[WritingApplication, Depends(application)]


@router.get("/summary", response_model=WritingSummary, operation_id="get_writing_summary")
def summary(current: CurrentSessionDependency, app: Application):
    return app.summary(current.user.user_id)


@router.get("/samples", response_model=WritingSampleList, operation_id="list_writing_samples")
def samples(current: CurrentSessionDependency, app: Application):
    rows = app.repository.samples(current.user.user_id)
    return {
        "items": [
            {
                "sample_id": r.sample_id,
                "title": r.title,
                "genre": r.genre,
                "character_count": len(r.text),
                "created_at": r.created_at,
            }
            for r in rows
        ]
    }


def save_sample(app, user_id, key, payload):
    data = payload.model_dump(mode="json")
    if len(re.sub(r"\s+", "", payload.text)) < 80 or not payload.title.strip():
        raise ValueError("样文至少需要80个有效字符和一个标题")
    return app.mutate(
        user_id, key, "sample:create", data, lambda: app.repository.add_sample(user_id, **data)
    )


@router.post("/samples", response_model=WritingSampleResponse, operation_id="create_writing_sample")
def create_sample(
    payload: WritingSampleCreate,
    current: CurrentSessionDependency,
    app: Application,
    key: IdempotencyKey,
):
    return save_sample(app, current.user.user_id, key, payload)


def read_sample_file(file: UploadFile):
    filename = Path(file.filename or "").name
    if Path(filename).suffix.lower() not in {".md", ".txt", ".docx", ".pdf"}:
        raise ValueError("样文支持 Markdown、TXT、DOCX 和带文字的 PDF")
    content = file.file.read(5 * 1024 * 1024 + 1)
    if len(content) > 5 * 1024 * 1024:
        raise WritingApiError(413, ErrorCode.RESEARCH_MATERIAL_TOO_LARGE, "样文文件不能超过5MB")
    return filename, content


@router.post(
    "/samples/preview",
    response_model=WritingSamplePreview,
    operation_id="preview_writing_samples",
)
def preview_samples(
    current: CurrentSessionDependency,
    app: Application,
    file: Annotated[UploadFile, File()],
):
    filename, content = read_sample_file(file)
    return app.preview_uploaded_samples(
        filename=filename, media_type=file.content_type, content=content
    )


@router.post(
    "/samples/upload", response_model=WritingSampleResponse, operation_id="upload_writing_sample"
)
def upload_sample(
    current: CurrentSessionDependency,
    app: Application,
    key: IdempotencyKey,
    file: Annotated[UploadFile, File()],
    genre: Annotated[Genre, Form()],
):
    filename, content = read_sample_file(file)
    text = app.parse_uploaded_sample(
        filename=filename, media_type=file.content_type, content=content
    )
    return save_sample(
        app,
        current.user.user_id,
        key,
        WritingSampleCreate(title=filename[:200], genre=genre, text=text),
    )


@router.delete("/samples/{sample_id}", status_code=204, operation_id="delete_writing_sample")
def delete_sample(sample_id: UUID, current: CurrentSessionDependency, app: Application):
    app.repository.delete_sample(current.user.user_id, sample_id)


@router.get("/documents", response_model=WritingDocumentList, operation_id="list_writing_documents")
def documents(current: CurrentSessionDependency, app: Application):
    return {"items": app.repository.documents(current.user.user_id)}


@router.post(
    "/documents", response_model=WritingDocumentResponse, operation_id="create_writing_document"
)
def create_document(
    payload: WritingDocumentCreate,
    current: CurrentSessionDependency,
    app: Application,
    key: IdempotencyKey,
):
    user_id, data = current.user.user_id, payload.model_dump(mode="json")
    return app.mutate(
        user_id, key, "document:create", data, lambda: app.repository.create(user_id, data)
    )


@router.get(
    "/documents/{document_id}",
    response_model=WritingDocumentResponse,
    operation_id="get_writing_document",
)
def document(document_id: UUID, current: CurrentSessionDependency, app: Application):
    return app.repository.get(current.user.user_id, document_id)


@router.patch(
    "/documents/{document_id}",
    response_model=WritingDocumentResponse,
    operation_id="update_writing_document",
)
def update_document(
    document_id: UUID,
    payload: WritingDocumentUpdate,
    current: CurrentSessionDependency,
    app: Application,
    key: IdempotencyKey,
):
    user_id, data = current.user.user_id, payload.model_dump(mode="json", exclude_none=True)
    changes = {k: v for k, v in data.items() if k != "expected_version"}
    if "title" in changes and not changes["title"].strip():
        raise ValueError("标题不能为空")
    if not changes:
        raise ValueError("没有要保存的修改")
    return app.mutate(
        user_id,
        key,
        f"document:update:{document_id}",
        data,
        lambda: app.repository.update(user_id, document_id, payload.expected_version, changes),
    )


@router.get(
    "/documents/{document_id}/revisions",
    response_model=WritingRevisionList,
    operation_id="list_writing_revisions",
)
def revisions(document_id: UUID, current: CurrentSessionDependency, app: Application):
    app.repository.reconcile_abandoned_agent_revisions(current.user.user_id, document_id)
    return {"items": app.repository.revisions(current.user.user_id, document_id)}


@router.post(
    "/documents/{document_id}/revisions",
    response_model=WritingRevisionResponse,
    operation_id="create_writing_revision",
)
def propose(
    document_id: UUID,
    payload: WritingRevisionCreate,
    current: CurrentSessionDependency,
    app: Application,
    key: IdempotencyKey,
):
    return app.propose(current.user.user_id, document_id, key, payload.model_dump(mode="json"))


@router.post(
    "/documents/{document_id}/revisions/{revision_id}/resolve",
    response_model=WritingRevisionResolution,
    operation_id="resolve_writing_revision",
)
def resolve(
    document_id: UUID,
    revision_id: UUID,
    payload: WritingRevisionResolve,
    current: CurrentSessionDependency,
    app: Application,
    key: IdempotencyKey,
):
    user_id, data = current.user.user_id, payload.model_dump(mode="json")
    return app.mutate(
        user_id,
        key,
        f"revision:resolve:{document_id}:{revision_id}",
        data,
        lambda: app.repository.resolve(user_id, document_id, revision_id, **data),
    )
