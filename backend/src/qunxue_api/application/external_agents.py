"""Read-only external access, rechecking account ownership and current membership on each call."""

from uuid import UUID

from qunxue_api.modules.external_agents import (
    ConnectionUnauthorized,
    ConnectionUnavailable,
    ConnectionValidationError,
    ExternalAgentService,
)
from qunxue_api.modules.identity import AccountStatus
from qunxue_api.modules.shared_knowledge import (
    SharedKnowledgeForbidden,
    SharedKnowledgeUnavailable,
)


class ExternalAgentApplication:
    def __init__(self, service: ExternalAgentService, *, identities, libraries):
        self.service = service
        self.identities = identities
        self.libraries = libraries

    def _active(self, user_id):
        user = self.identities.get_user(user_id)
        if user is None or user.status != AccountStatus.ACTIVE or user.deactivated_at is not None:
            raise ConnectionUnauthorized()

    def _owned_library(self, user_id, library_id):
        try:
            library = self.libraries.require_manage(user_id, library_id)
        except (SharedKnowledgeUnavailable, SharedKnowledgeForbidden) as exc:
            raise ConnectionUnavailable() from exc
        # Joined/shared libraries can never expand a connection's authorization.
        if library.owner_user_id != user_id or library.deleted_at is not None:
            raise ConnectionUnavailable()
        return library

    def create(self, user_id, *, name, library_ids, expires_at):
        self._active(user_id)
        for library_id in library_ids:
            self._owned_library(user_id, library_id)
        return self.service.create(
            user_id, name=name, library_ids=library_ids, expires_at=expires_at
        )

    def connections(self, user_id):
        self._active(user_id)
        return self.service.list(user_id)

    def revoke(self, user_id, connection_id):
        self._active(user_id)
        return self.service.revoke(user_id, connection_id)

    def authenticate(self, secret):
        connection = self.service.authenticate(secret)
        self._active(connection.owner_user_id)
        return connection

    def _library(self, connection, library_id):
        if library_id not in connection.library_ids:
            raise ConnectionUnavailable()
        return self._owned_library(connection.owner_user_id, library_id)

    def _libraries(self, connection):
        allowed = []
        for library_id in connection.library_ids:
            try:
                allowed.append(self._library(connection, library_id))
            except ConnectionUnavailable:
                # A removed/transferred library disappears rather than retaining historical access.
                continue
        return allowed

    def _documents(self, connection, library_id):
        self._library(connection, library_id)
        try:
            documents = self.libraries.documents(
                connection.owner_user_id, library_id, ready_only=True
            )
        except (SharedKnowledgeUnavailable, SharedKnowledgeForbidden) as exc:
            raise ConnectionUnavailable() from exc
        return tuple(
            doc
            for doc in documents
            if doc.owner_user_id == connection.owner_user_id and doc.status == "ready"
        )

    def list_libraries(self, secret):
        connection = self.authenticate(secret)
        return {
            "libraries": [
                {"library_id": str(kb.id), "name": kb.name, "description": kb.description}
                for kb in self._libraries(connection)
            ]
        }

    def list_documents(self, secret, *, library_id: UUID, offset=0, limit=50):
        _page(offset, limit, 100)
        connection = self.authenticate(secret)
        docs = sorted(self._documents(connection, library_id), key=lambda doc: str(doc.id))
        end = offset + limit
        return {
            "documents": [
                {
                    "library_id": str(library_id),
                    "document_id": str(doc.id),
                    "filename": doc.filename,
                    "media_type": doc.media_type,
                }
                for doc in docs[offset:end]
            ],
            "next_offset": end if end < len(docs) else None,
        }

    def search_documents(self, secret, *, query, library_id=None, limit=20):
        _page(0, limit, 50)
        query = query.strip()
        if not query or len(query) > 200:
            raise ConnectionValidationError("搜索词需要 1–200 个字符。")
        connection = self.authenticate(secret)
        libraries = (
            [self._library(connection, library_id)]
            if library_id is not None
            else self._libraries(connection)
        )
        matches = []
        folded = query.casefold()
        for library in libraries:
            for doc in self._documents(connection, library.id):
                for segment in doc.segments:
                    text = str(segment.get("text", ""))
                    position = text.casefold().find(folded)
                    if position < 0:
                        continue
                    start = max(0, position - 120)
                    matches.append(
                        {
                            "library_id": str(library.id),
                            "document_id": str(doc.id),
                            "filename": doc.filename,
                            "segment_id": segment.get("segment_id"),
                            "locator": segment.get("locator", {}),
                            "excerpt": text[start : start + 700],
                        }
                    )
                    if len(matches) == limit:
                        return {"matches": matches}
        return {"matches": matches}

    def read_document(self, secret, *, library_id, document_id, offset=0, limit=12000):
        _page(offset, limit, 20000)
        connection = self.authenticate(secret)
        document = next(
            (doc for doc in self._documents(connection, library_id) if doc.id == document_id), None
        )
        if document is None:
            raise ConnectionUnavailable()
        # Character pagination lets clients finish even a source with one very large segment.
        full_text = "\n\n".join(str(segment.get("text", "")) for segment in document.segments)
        end = min(offset + limit, len(full_text))
        sources, position = [], 0
        for segment in document.segments:
            text = str(segment.get("text", ""))
            segment_end = position + len(text)
            if segment_end > offset and position < end:
                sources.append(
                    {
                        "segment_id": segment.get("segment_id"),
                        "locator": segment.get("locator", {}),
                        "start": max(position, offset),
                        "end": min(segment_end, end),
                    }
                )
            position = segment_end + 2
        return {
            "library_id": str(library_id),
            "document_id": str(document.id),
            "filename": document.filename,
            "text": full_text[offset:end],
            "offset": offset,
            "next_offset": end if end < len(full_text) else None,
            "total_characters": len(full_text),
            "sources": sources,
        }


def _page(offset, limit, maximum):
    if type(offset) is not int or offset < 0 or type(limit) is not int or not 1 <= limit <= maximum:
        raise ConnectionValidationError("分页参数无效。")
