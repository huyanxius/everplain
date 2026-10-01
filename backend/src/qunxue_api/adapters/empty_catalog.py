"""Keep the shared catalog interface without publishing or loading domain data."""
from qunxue_api.adapters.sqlite.knowledge_catalog import SqliteKnowledgeCatalog


class EmptyKnowledgeCatalog(SqliteKnowledgeCatalog):
    def current_release(self, *, purpose):
        # An empty personal library is valid. Inherited Markdown and historic
        # release rows must never become the personal product's default evidence.
        raise LookupError("Everplain has no public discipline release")
