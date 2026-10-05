from typing import Annotated, Literal
from urllib.parse import quote
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, Response, UploadFile
from pydantic import BaseModel, Field

from qunxue_api.api.contracts.knowledge_import import ImportBatchListResponse, ImportBatchResponse
from qunxue_api.api.dependencies import CurrentSessionDependency
from qunxue_api.api.routes.stubs import IdempotencyKey
from qunxue_api.application.knowledge_import import KnowledgeImportApplication
from qunxue_api.modules.knowledge_import import ImportUnavailable

router = APIRouter(prefix="/api/imports", tags=["imports"])


def application(request: Request):
    with request.app.state.knowledge_import_scope() as value:
        yield value


Application = Annotated[KnowledgeImportApplication, Depends(application)]


@router.post(
    "", response_model=ImportBatchResponse, status_code=202, operation_id="create_import_batch"
)
def create_batch(
    current: CurrentSessionDependency,
    app: Application,
    _key: IdempotencyKey,
    source_type: Annotated[
        Literal[
            "chrome",
            "markdown",
            "obsidian",
            "enex",
            "notion",
            "flomo",
            "keep",
            "apple_notes",
            "image",
        ],
        Form(),
    ],
    files: Annotated[list[UploadFile], File()],
    library_id: Annotated[UUID | None, Form()] = None,
):
    if len(files) > 2000:
        raise HTTPException(413, "每批最多2000个文件")
    values, total = [], 0
    for file in files:
        content = file.file.read(16 * 1024 * 1024 + 1)
        total += len(content)
        if len(content) > 16 * 1024 * 1024 or total > 64 * 1024 * 1024:
            raise HTTPException(413, "单文件最多16MB，每批最多64MB")
        values.append((file.filename or "未命名.txt", content))
    try:
        return app.start(current.user.user_id, source_type, values, library_id, _key)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.get("", response_model=ImportBatchListResponse, operation_id="list_import_batches")
def list_batches(current: CurrentSessionDependency, app: Application):
    return {"items": app.list(current.user.user_id)}


class ClipImportRequest(BaseModel):
    url: str = Field(max_length=4096, pattern=r"^https?://")
    title: str = Field(max_length=512)
    html: str = Field(min_length=1, max_length=1500000)
    library_id: UUID | None = None


@router.post(
    "/clip", response_model=ImportBatchResponse, status_code=202, operation_id="create_clip_import"
)
def import_clip(
    payload: ClipImportRequest,
    current: CurrentSessionDependency,
    app: Application,
    _key: IdempotencyKey,
):
    try:
        return app.start_clip(
            current.user.user_id, payload.url, payload.title, payload.html, payload.library_id, _key
        )
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


class BilibiliImportRequest(BaseModel):
    uid: str = Field(pattern=r"^[0-9]{1,20}$")
    library_id: UUID | None = None


@router.post(
    "/bilibili",
    response_model=ImportBatchResponse,
    status_code=202,
    operation_id="create_bilibili_import",
)
def import_bilibili(
    payload: BilibiliImportRequest,
    current: CurrentSessionDependency,
    app: Application,
    _key: IdempotencyKey,
):
    try:
        return app.start_bilibili(current.user.user_id, payload.uid, payload.library_id, _key)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.get("/assets/{document_id}", operation_id="get_import_image_asset")
def get_asset(document_id: UUID, current: CurrentSessionDependency, app: Application):
    try:
        content, media_type = app.asset(current.user.user_id, document_id)
    except ImportUnavailable as exc:
        raise HTTPException(404, str(exc)) from exc
    return Response(
        content,
        media_type=media_type,
        headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"},
    )


@router.get(
    "/assets/{document_id}/attachments/{attachment_id}",
    operation_id="get_import_attachment_asset",
)
def get_attachment_asset(
    document_id: UUID,
    attachment_id: UUID,
    current: CurrentSessionDependency,
    app: Application,
):
    try:
        content, media_type, filename = app.asset(current.user.user_id, document_id, attachment_id)
    except ImportUnavailable as exc:
        raise HTTPException(404, str(exc)) from exc
    # Active documents are downloads, not a same-origin HTML/script execution surface.
    disposition = (
        "inline"
        if media_type
        in {
            "image/png",
            "image/jpeg",
            "image/webp",
            "image/gif",
        }
        else "attachment"
    )
    return Response(
        content,
        media_type=media_type,
        headers={
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "sandbox; default-src 'none'",
            "Content-Disposition": f"{disposition}; filename*=UTF-8''{quote(filename, safe='')}",
        },
    )


@router.get("/{batch_id}", response_model=ImportBatchResponse, operation_id="get_import_batch")
def get_batch(batch_id: UUID, current: CurrentSessionDependency, app: Application):
    try:
        return app.get(current.user.user_id, batch_id)
    except ImportUnavailable as exc:
        raise HTTPException(404, str(exc)) from exc


@router.post(
    "/{batch_id}/items/{item_id}/retry",
    response_model=ImportBatchResponse,
    operation_id="retry_import_item",
)
def retry_item(
    batch_id: UUID,
    item_id: UUID,
    current: CurrentSessionDependency,
    app: Application,
    _key: IdempotencyKey,
):
    try:
        return app.retry(current.user.user_id, batch_id, item_id)
    except ImportUnavailable as exc:
        raise HTTPException(404, str(exc)) from exc
