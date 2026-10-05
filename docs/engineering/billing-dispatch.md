# Model dispatch and unresolved cost evidence

The existing attempt row now records dispatch_state and provider_request_id. Historical attempts default to legacy_unknown; no historical cost, account or receipt is rewritten.

New SDK attempts start prepared. Supported HTTPX 0.28.1 / HTTPcore 1.0.9 traces durably mark dispatch_started before HTTP headers are sent. A response hook records a bounded Http_x_reqid or x-request-id and response_received. Known usage replaces the reservation through the existing locked price snapshot.

Only a positive terminal connection.connect_tcp.failed event on the selected stock transport, with no later connection success, HTTP send, response or callback failure, may become not_sent and release operator risk. Missing trace, unsupported/custom transport, cancellation, crash, proxy uncertainty and legacy rows remain unknown. Redirect/auth resends are rejected before a second reservation rather than mixing attempt identities.

DurableBilling.risk_breakdown separates known UTC-day cost, active reservations and pending unknown cost without weakening the total risk gate. pending_reconciliation accepts a bounded 1–100 row batch. reconcile_usage accepts exact attempt, provider host, saved provider request ID and model plus explicit numeric token/cache usage. Ambiguous, missing and active receipts are rejected; receipt checks and cost-only settlement share one BEGIN IMMEDIATE transaction. Terminal delivery outcome, user charge, balance, ledger and reset fence remain unchanged. Repeated reconciliation is idempotent.

There is no automatic fuzzy time matching or provider credential expansion. Provider logs may be supplied through an authorized, verified same-service adapter; this change does not make a real management API call. Legacy requests without authoritative request IDs require operator/provider evidence and cannot be declared zero-cost from billable=0 or a generic connection error.

The additive 0560 migration keeps audit columns during application rollback and can be safely upgraded again. The deployment policy allows only the independently verified exact 0550→0560 fingerprint transition; older application INSERT contracts retain conservative defaults.
