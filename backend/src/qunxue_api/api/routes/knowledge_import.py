from typing import Annotated, Literal
from urllib.parse import quote
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, Response, UploadFile
from fastapi.routing import APIRoute
from pydantic import BaseModel, Field
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.formparsers import MultiPartException

from qunxue_api.api.contracts.knowledge_import import ImportBatchListResponse, ImportBatchResponse
from qunxue_api.api.dependencies import CurrentSessionDependency
from qunxue_api.api.routes.stubs import IdempotencyKey
from qunxue_api.application.knowledge_import import KnowledgeImportApplication
from qunxue_api.modules.knowledge_import import ImportUnavailable

MAX_IMPORT_FILES = 2000
MAX_IMPORT_FILE_BYTES = 16 * 1024 * 1024
MAX_IMPORT_TOTAL_BYTES = 64 * 1024 * 1024
# Leave a bounded 4 MiB for multipart headers, filenames and field framing.
# Keep this in sync with the exact /api/imports location in ops/nginx.conf.
MAX_IMPORT_REQUEST_BYTES = 68 * 1024 * 1024
IMPORT_REQUEST_TOO_LARGE = "导入请求超过68MB（含文件名和上传格式开销），请缩小后重试"


class ImportUploadRequest(Request):
    async def stream(self):
        size = 0
        async for chunk in super().stream():
            size += len(chunk)
            if size > MAX_IMPORT_REQUEST_BYTES:
                # The multipart parser closes spooled files on MultiPartException.
                raise MultiPartException(IMPORT_REQUEST_TOO_LARGE)
            yield chunk


class ImportUploadRoute(APIRoute):
    def get_route_handler(self):
        handler = super().get_route_handler()
        if self.path != "/api/imports" or "POST" not in self.methods:
            return handler

        async def bounded_upload(request: Request):
            length = request.headers.get("content-length")
            if length is not None:
                try:
                    size = int(length)
                except ValueError as exc:
                    raise HTTPException(400, "上传请求的长度无效") from exc
                if size < 0:
                    raise HTTPException(400, "上传请求的长度无效")
                if size > MAX_IMPORT_REQUEST_BYTES:
                    raise HTTPException(413, IMPORT_REQUEST_TOO_LARGE)
            bounded = ImportUploadRequest(request.scope, request.receive)
            try:
                # FastAPI otherwise parses at Starlette's 1000-file default before
                # reaching create_batch. Cache the bounded form without changing
                # the typed endpoint or generated multipart OpenAPI contract.
                await bounded.form(max_files=MAX_IMPORT_FILES, max_fields=2, max_part_size=1024)
            except StarletteHTTPException as exc:
                if exc.detail == IMPORT_REQUEST_TOO_LARGE:
                    raise HTTPException(413, IMPORT_REQUEST_TOO_LARGE) from exc
                raise
            return await handler(bounded)

        return bounded_upload


router = APIRouter(prefix="/api/imports", tags=["imports"], route_class=ImportUploadRoute)


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
    if len(files) > MAX_IMPORT_FILES:
        raise HTTPException(413, "每批最多2000个文件")
    values, total = [], 0
    for file in files:
        content = file.file.read(MAX_IMPORT_FILE_BYTES + 1)
        total += len(content)
        if len(content) > MAX_IMPORT_FILE_BYTES or total > MAX_IMPORT_TOTAL_BYTES:
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
