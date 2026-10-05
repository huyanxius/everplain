from dataclasses import asdict
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, File, Query, Request, Response, UploadFile

from qunxue_api.api.contracts.common import ErrorResponse
from qunxue_api.api.contracts.shared_knowledge import (
    CreateSharedKnowledgeRequest,
    JoinSharedKnowledgeRequest,
    KnowledgeStorageResponse,
    PublicKnowledgeDetailResponse,
    PublicKnowledgeDirectoryResponse,
    PublicKnowledgePublicationResponse,
    PublishKnowledgeRequest,
    SharedDocumentResponse,
    SharedDocumentSourceResponse,
    SharedKnowledgeJoinResponse,
    SharedKnowledgeListResponse,
    SharedKnowledgeResponse,
    UpdateDocumentKnowledgeRequest,
    UpdateSharedKnowledgeRequest,
)
from qunxue_api.api.dependencies import CurrentSessionDependency
from qunxue_api.api.routes.stubs import IdempotencyKey
from qunxue_api.application.shared_knowledge import SharedKnowledgeApplication
from qunxue_api.modules.shared_knowledge import SharedKnowledgeUnavailable

router = APIRouter(
    prefix="/api",
    tags=["shared-knowledge"],
    responses={
        401: {"model": ErrorResponse},
        403: {"model": ErrorResponse},
        404: {"model": ErrorResponse},
        422: {"model": ErrorResponse},
    },
)


def get_application(request: Request, response: Response):
    response.headers["Cache-Control"] = "no-store"
    with request.app.state.shared_knowledge_scope() as application:
        yield application


Application = Annotated[SharedKnowledgeApplication, Depends(get_application)]


def document_response(doc):
    return SharedDocumentResponse(**asdict(doc))


def publication_response(application, publication):
    return PublicKnowledgePublicationResponse(
        **asdict(publication),
        document_count=len(application.public_documents(publication.knowledge_base_id)),
    )


def projection(application, user_id, kb, *, detail=False):
    try:
        application.require_read(user_id, kb.id)
    except SharedKnowledgeUnavailable:
        return SharedKnowledgeResponse(id=kb.id, viewer_access="unavailable")
    owner = kb.owner_user_id == user_id
    docs = application.documents(user_id, kb.id, include_segments=False)
    return SharedKnowledgeResponse(
        id=kb.id,
        name=kb.name,
        description=kb.description,
        sharing_enabled=kb.sharing_enabled,
        publication=(
            publication_response(application, publication)
            if owner and (publication := application.repository.publication(kb.id))
            else None
        ),
        viewer_access="owner" if owner else "reader",
        share_token=kb.share_token if owner and kb.sharing_enabled else None,
        ready_document_count=sum(doc.status == "ready" for doc in docs),
        documents=[document_response(doc) for doc in docs] if detail else [],
    )


@router.get(
    "/shared-knowledge-bases",
    operation_id="list_shared_knowledge_bases",
    response_model=SharedKnowledgeListResponse,
)
def list_libraries(current: CurrentSessionDependency, application: Application):
    user_id = current.user.user_id
    return SharedKnowledgeListResponse(
        items=[projection(application, user_id, kb) for kb in application.libraries(user_id)]
    )


@router.post(
    "/shared-knowledge-bases",
    operation_id="create_shared_knowledge_base",
    response_model=SharedKnowledgeResponse,
    status_code=201,
)
def create_library(
    payload: CreateSharedKnowledgeRequest,
    current: CurrentSessionDependency,
    application: Application,
    idempotency_key: IdempotencyKey,
):
    kb = application.create(
        current.user.user_id, payload.name, payload.description, idempotency_key
    )
    return projection(application, current.user.user_id, kb, detail=True)


@router.get(
    "/shared-knowledge-bases/{kb_id}",
    operation_id="get_shared_knowledge_base",
    response_model=SharedKnowledgeResponse,
)
def get_library(kb_id: UUID, current: CurrentSessionDependency, application: Application):
    kb = application.require_read(current.user.user_id, kb_id)
    return projection(application, current.user.user_id, kb, detail=True)


@router.patch(
    "/shared-knowledge-bases/{kb_id}",
    operation_id="update_shared_knowledge_base",
    response_model=SharedKnowledgeResponse,
)
def update_library(
    kb_id: UUID,
    payload: UpdateSharedKnowledgeRequest,
    current: CurrentSessionDependency,
    application: Application,
    _idempotency_key: IdempotencyKey,
):
    kb = application.update(current.user.user_id, kb_id, **payload.model_dump(exclude_unset=True))
    return projection(application, current.user.user_id, kb, detail=True)


@router.delete(
    "/shared-knowledge-bases/{kb_id}", operation_id="delete_shared_knowledge_base", status_code=204
)
def delete_library(
    kb_id: UUID,
    current: CurrentSessionDependency,
    application: Application,
    _idempotency_key: IdempotencyKey,
):
    application.delete(current.user.user_id, kb_id)


@router.post(
    "/shared-knowledge-base-subscriptions",
    operation_id="join_shared_knowledge_base",
    response_model=SharedKnowledgeJoinResponse,
)
def join_library(
    payload: JoinSharedKnowledgeRequest,
    current: CurrentSessionDependency,
    application: Application,
    _idempotency_key: IdempotencyKey,
):
    kb, added = application.join(current.user.user_id, payload.share_token)
    return SharedKnowledgeJoinResponse(knowledge_base_id=kb.id, name=kb.name, added=added)


@router.delete(
    "/shared-knowledge-base-subscriptions/{kb_id}",
    operation_id="leave_shared_knowledge_base",
    status_code=204,
)
def leave_library(
    kb_id: UUID,
    current: CurrentSessionDependency,
    application: Application,
    _idempotency_key: IdempotencyKey,
):
    application.leave(current.user.user_id, kb_id)


@router.post(
    "/shared-knowledge-bases/{kb_id}/documents",
    operation_id="upload_shared_document",
    response_model=SharedDocumentResponse,
    status_code=201,
)
def upload_document(
    kb_id: UUID,
    current: CurrentSessionDependency,
    application: Application,
    idempotency_key: IdempotencyKey,
    file: Annotated[UploadFile, File()],
):
    from fastapi import HTTPException

    application.require_manage(current.user.user_id, kb_id)
    content = file.file.read(application.max_file_bytes + 1)
    file.file.close()
    if len(content) > application.max_file_bytes:
        raise HTTPException(
            413, f"单份资料不能超过 {application.max_file_bytes // 1024 // 1024} MB。"
        )
    return document_response(
        application.upload(
            current.user.user_id,
            kb_id,
            filename=(file.filename or "")[:512],
            media_type=file.content_type or "",
            content=content,
            request_key=idempotency_key,
        )
    )


@router.delete(
    "/shared-knowledge-bases/{kb_id}/documents/{document_id}",
    operation_id="detach_shared_document",
    status_code=204,
)
def detach_document(
    kb_id: UUID,
    document_id: UUID,
    current: CurrentSessionDependency,
    application: Application,
    _idempotency_key: IdempotencyKey,
):
    application.detach(current.user.user_id, kb_id, document_id)


@router.get(
    "/shared-knowledge-bases/{kb_id}/documents/{document_id}/source",
    operation_id="get_shared_document_source",
    response_model=SharedDocumentSourceResponse,
)
def source(
    kb_id: UUID,
    document_id: UUID,
    current: CurrentSessionDependency,
    application: Application,
    segment_id: Annotated[str | None, Query(max_length=128)] = None,
):
    doc = application.source(current.user.user_id, kb_id, document_id, segment_id)
    return SharedDocumentSourceResponse(
        document=document_response(doc),
        knowledge_base_id=kb_id,
        knowledge_base_name=application.require_read(current.user.user_id, kb_id).name,
        segments=list(doc.segments),
        attachments=application.repository.source_attachments(current.user.user_id, document_id),
    )


@router.post(
    "/shared-knowledge-bases/{kb_id}/documents/{document_id}/organize",
    operation_id="organize_shared_document",
    response_model=SharedDocumentResponse,
    status_code=202,
)
def organize_document(
    kb_id: UUID,
    document_id: UUID,
    current: CurrentSessionDependency,
    application: Application,
    _idempotency_key: IdempotencyKey,
):
    application.require_manage(current.user.user_id, kb_id)
    application.source(current.user.user_id, kb_id, document_id)
    return document_response(application.repository.retry_document(document_id))


@router.get(
    "/knowledge-storage",
    operation_id="get_knowledge_storage",
    response_model=KnowledgeStorageResponse,
)
def knowledge_storage(current: CurrentSessionDependency, application: Application):
    return KnowledgeStorageResponse(**application.storage(current.user.user_id))


@router.put(
    "/shared-knowledge-bases/{kb_id}/documents/{document_id}/knowledge",
    operation_id="update_document_knowledge",
    response_model=SharedDocumentResponse,
)
def update_document_knowledge(
    kb_id: UUID,
    document_id: UUID,
    payload: UpdateDocumentKnowledgeRequest,
    current: CurrentSessionDependency,
    application: Application,
    _idempotency_key: IdempotencyKey,
):
    return document_response(
        application.update_knowledge(current.user.user_id, kb_id, document_id, payload.model_dump())
    )


@router.get(
    "/public-knowledge-directory",
    operation_id="list_public_knowledge_directory",
    response_model=PublicKnowledgeDirectoryResponse,
)
def public_directory(
    application: Application,
    query: Annotated[str, Query(max_length=100)] = "",
    limit: Annotated[int, Query(ge=1, le=100)] = 24,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    return PublicKnowledgeDirectoryResponse(
        items=[
            publication_response(application, item)
            for item in application.public_directory(query=query, limit=limit, offset=offset)
        ]
    )


@router.put(
    "/shared-knowledge-bases/{kb_id}/publication",
    operation_id="publish_knowledge_metadata",
    response_model=PublicKnowledgePublicationResponse,
)
def publish_knowledge(
    kb_id: UUID,
    payload: PublishKnowledgeRequest,
    current: CurrentSessionDependency,
    application: Application,
    idempotency_key: IdempotencyKey,
):
    return publication_response(
        application,
        application.publish(
            current.user.user_id, kb_id, request_key=idempotency_key, **payload.model_dump()
        ),
    )


@router.delete(
    "/shared-knowledge-bases/{kb_id}/publication",
    operation_id="unpublish_knowledge_metadata",
    status_code=204,
)
def unpublish_knowledge(
    kb_id: UUID,
    current: CurrentSessionDependency,
    application: Application,
    _idempotency_key: IdempotencyKey,
):
    application.unpublish(current.user.user_id, kb_id)


@router.get(
    "/public-knowledge-directory/{kb_id}",
    operation_id="get_public_knowledge_library",
    response_model=PublicKnowledgeDetailResponse,
)
def public_knowledge_detail(kb_id: UUID, application: Application):
    return PublicKnowledgeDetailResponse(
        publication=publication_response(application, application.public_publication(kb_id)),
        documents=[document_response(doc) for doc in application.public_documents(kb_id)],
    )


@router.get(
    "/public-knowledge-directory/{kb_id}/documents/{document_id}/source",
    operation_id="get_public_knowledge_source",
    response_model=SharedDocumentSourceResponse,
)
def public_knowledge_source(
    kb_id: UUID,
    document_id: UUID,
    application: Application,
    segment_id: Annotated[str | None, Query(max_length=128)] = None,
):
    doc = application.public_source(kb_id, document_id, segment_id)
    publication = application.public_publication(kb_id)
    return SharedDocumentSourceResponse(
        document=document_response(doc),
        knowledge_base_id=kb_id,
        knowledge_base_name=publication.title,
        segments=list(doc.segments),
    )
