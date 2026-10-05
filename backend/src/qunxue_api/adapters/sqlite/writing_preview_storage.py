"""Owner/version/revision proofs for replaying dedicated writing snapshots."""

from sqlalchemy import select

from qunxue_api.adapters.sqlite.writing import WritingDocumentRow, WritingRevisionRow
from qunxue_api.modules.agent_conversation import validated_writing_preview
from qunxue_api.modules.writing import utf16_slice


def safe_writing_preview(session, run, payload, *, strict=False):
    body = validated_writing_preview(payload)
    if body["run_id"] != run.run_id:
        raise ValueError("writing_preview_wrong_run")
    context = (run.request_snapshot or {}).get("writing_context") or {}
    valid = (str(context.get("document_id")) == body["document_id"]
             and context.get("document_version") == body["base_version"])
    document = session.scalar(select(WritingDocumentRow).where(
        WritingDocumentRow.document_id == body["document_id"],
        WritingDocumentRow.user_id == run.user_id,
    ).execution_options(populate_existing=True))
    valid = valid and document is not None and document.version == body["base_version"]
    if body["state"] == "invalidated":
        return body
    if valid:
        try:
            prefix, _, suffix = utf16_slice(document.markdown, body["selection_start"],
                                            body["selection_end"], allow_empty=True)
            scope_start, scope_end = context.get("selection_start"), context.get("selection_end")
            if scope_start is not None:
                utf16_slice(document.markdown, scope_start, scope_end, allow_empty=True)
                valid = scope_start <= body["selection_start"] <= body["selection_end"] <= scope_end
        except (ValueError, UnicodeError):
            valid = False
    if valid and body["state"] == "ready":
        revision = session.scalar(select(WritingRevisionRow).where(
            WritingRevisionRow.revision_id == body["revision_id"],
            WritingRevisionRow.document_id == body["document_id"],
            WritingRevisionRow.user_id == run.user_id,
        ).execution_options(populate_existing=True))
        valid = (revision is not None and revision.status == "pending"
                 and revision.base_version == body["base_version"]
                 and revision.before_markdown == document.markdown
                 and revision.after_markdown == prefix + body["replacement_text"] + suffix)
    if not valid:
        if strict:
            raise ValueError("writing_preview_unproven_binding")
        return {**{key: value for key, value in body.items() if key != "revision_id"},
                "replacement_text": "", "state": "invalidated",
                "error_code": "writing_preview_context_unavailable"}
    return body
