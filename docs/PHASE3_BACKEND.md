# Phase-three backend assembly

This change implements local backend primitives for Issues #13–#15. It does not configure live model providers, create user connection keys, create a Stripe account, charge a payment, deploy, or validate a live provider. Tests use isolated databases and fake HTTP transports.

## Sharing and public publication (#13)

The existing shared-knowledge router remains registered. Libraries start private. An owner may explicitly enable invitations; the response exposes the invite only to that owner. Joined users may read and leave, never upload, edit, publish or delete. Disabling sharing invalidates the invite and removes memberships. Re-enabling requires a fresh invitation.

Migration `20261002_0480` deliberately clears ignored legacy sharing flags and memberships. The preceding personal-only implementation rejected sharing in its HTTP path and ignored these flags on reads; activating them during this upgrade would unintentionally grant access. The migration keeps libraries and documents intact and starts with no public publications.

Publication is a separate action. `PUT /api/shared-knowledge-bases/{id}/publication` requires `confirm_public_content: true`, an explicit public title/description/topics, and captures the current ready document IDs. Later uploads are private until another explicit publication. Public listing, details and original-text reads recheck the publication snapshot, current library/document ownership, readiness and active owner status. Unpublishing or deleting a source removes future access. Publication requests are owner-scoped and idempotent: retrying a request preserves its original snapshot, and a revoked/replaced request cannot republish content. Only a request hash and key tombstone is retained after unpublishing. Private invitations and public publication are independent permissions: disable both to close both forms of access. Responses use `Cache-Control: no-store`.

Existing conversation citations are revalidated when restored. Removed or revoked citations lose excerpts and are marked unavailable; affected answers and traces use the existing redaction path. Source-derived memory remains blocked by the current user-text-only memory behavior.

## Read-only external agents (#14)

Import the following in the composition root:

```python
from qunxue_api.adapters.sqlite.external_agents import SqliteExternalAgentRepository
from qunxue_api.application.external_agents import ExternalAgentApplication
from qunxue_api.modules.external_agents import ExternalAgentService
from qunxue_api.modules.shared_knowledge import SharedKnowledgeService
from qunxue_api.api.routes.external_agents import router as external_agents_router
```

Using the existing `database`, identity repository and shared-library repository:

```python
@contextmanager
def external_agents_scope():
    with database.session() as session:
        yield ExternalAgentApplication(
            ExternalAgentService(SqliteExternalAgentRepository(session)),
            identities=SqliteIdentityRepository(session),
            libraries=SharedKnowledgeService(SqliteSharedKnowledgeRepository(session)),
        )

app.state.external_agents_scope = external_agents_scope
app.include_router(external_agents_router)
```

Connection management uses the authenticated owner session. Creation requires an explicit nonempty selection of owned libraries and an expiry within 365 days. The secret is returned once; storage contains only its hash. The endpoint rechecks active account, current ownership, scope, expiry, revocation and document membership on every call. Joining someone else's library never permits delegating it through a connection.

`POST /api/mcp` implements a bounded, stateless MCP 2025-11-25 JSON-RPC subset: initialize, initialized notification, ping, tools/list and tools/call. It offers list_libraries, list_documents, search_documents and read_document. GET returns 405 because streaming is not offered. It requires bearer authorization, JSON content type, the MCP Accept header and a permitted Origin (when present). The existing `cors_allowed_origins` setting supplies the origin allowlist. There is no automatic connection creation, OAuth server, write tool, live web search or external model call.

Primary specification references:
- https://modelcontextprotocol.io/specification/2025-11-25/basic/transports
- https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle
- https://modelcontextprotocol.io/specification/2025-11-25/server/tools

## Model catalogue and subscription primitives (#15)

Configuration lives in `adapters/commerce_config.py` (`CommerceSettings`, `build_model_catalog`). The normal bootstrap is the sole production composition root; use the copyable assembly snippet in `docs/integrations/SUBSCRIPTIONS_AND_MODELS.md`. There is no new top-level component or architecture exception. Assembly does not contact providers. `CommerceSettings` uses only the `EVERPLAIN_` prefix. Use the same environment-file policy as the main settings; tests may pass `_env_file=None`.

The model catalogue derives model names from actual runtime configuration. Optional `EVERPLAIN_MODEL_CATALOG` supplies display names, source mappings and operator-declared capabilities; it cannot invent a configured model. `configured` means configuration is present, not that a live model call passed. Missing credentials or mock chat mode is unavailable.

Stripe remains disabled by default. Dedicated Everplain setup later requires explicit enablement, secret and webhook keys, a configured plan-to-price map, success/cancel URLs, the appropriate live/test mode, and a public signed-webhook endpoint. Neither prices nor merchant details are hardcoded. Checkout is hosted by Stripe; the user completes payment there. A reserved owner-scoped idempotency key preserves the same parameters across provider timeouts and retries.

Webhook signatures cover the unmodified raw body, with timestamp tolerance and durable event-ID deduplication. Current subscription state is retrieved through the injected gateway rather than trusting event arrival order; failed retrieval rolls back the claim for a retry. Local test evidence is not a live billing acceptance result.

`POST /api/subscription/portal` returns a hosted customer-management URL using only the current user's persisted customer identity and `EVERPLAIN_STRIPE_PORTAL_RETURN_URL`. Missing configuration returns unavailable. The account repository blocks erasure while a nonterminal subscription or potentially live checkout remains; the user must finish/cancel the subscription through Stripe first. This code never remotely cancels a subscription merely because a local account is being deleted.

Primary references:
- https://docs.stripe.com/webhooks
- https://docs.stripe.com/api/checkout/sessions/create
- https://docs.stripe.com/billing/subscriptions/webhooks

## Migration and test registration

The migration chain is `0470 → 0480 → 0490 → 0500`. Register the new SQLAlchemy rows in `adapters/sqlite/__init__.py` (included in the integration commit). The architecture test's explicit module map should include the pure modules `external_agents`, `model_catalog` and `subscriptions`, each with no module dependencies. Regenerate OpenAPI and the frontend SDK after router assembly through the normal contract command.

Targeted test files:
- `tests/test_explicit_library_sharing.py`
- `tests/test_personal_knowledge_api.py`
- `tests/test_shared_knowledge_agent.py`
- `tests/test_shared_knowledge_api.py`
- `tests/test_external_agents.py`
- `tests/test_commerce.py`

No frontend, generated contract or main bootstrap changes are part of this backend patch set.
