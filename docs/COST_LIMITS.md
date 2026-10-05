# Model cost limits

Real calls are not part of automated tests. Tests replace provider transport; no
credentials are needed. Do not copy existing model credentials into a server.

## Single calls

`EVERPLAIN_MODEL_MAX_INPUT_TOKENS` (default 32000) checks a conservative UTF-8
payload bound before structured business Chat Completions calls. It
includes serialized messages, contracts/schema and a framing allowance; it is
not an exact tokenizer count. Oversized requests are rejected before transport.
`EVERPLAIN_MODEL_MAX_OUTPUT_TOKENS` (default 3000) caps the outgoing `max_tokens`
parameter for those structured business calls. Neither setting limits research
Agent input or answer output. The Agent's old fixed 2400-token output setting,
shared 3000-token minimum and conservative 32k admission veto are removed.
Actual provider context limits still apply. See
[Agent model capacity](engineering/agent-model-capacity.md) for verified native
output parameters, route-specific configuration and the required billing rollout.
`EVERPLAIN_MODEL_MAX_RETRIES` (default 0) limits automatic endpoint fallback in
both synchronous and asynchronous shared routing. SDK retries remain disabled.

## Knowledge organization batches

The real knowledge organization worker is disabled until a positive budget,
both positive rates and an explicit currency are configured:

| Environment variable | Default | Meaning |
| --- | --- | --- |
| `EVERPLAIN_ORGANIZATION_MAX_INPUT_TOKENS` | 32000 | Conservative input bound per attempt |
| `EVERPLAIN_ORGANIZATION_MAX_OUTPUT_TOKENS` | 3000 | Output cap per attempt |
| `EVERPLAIN_ORGANIZATION_BATCH_CHARS` | 5000 | Source characters per batch |
| `EVERPLAIN_ORGANIZATION_MAX_BATCHES` | 24 | Maximum batches per document |
| `EVERPLAIN_ORGANIZATION_MAX_CONCURRENCY` | 1 | Parallel batches (1–8) |
| `EVERPLAIN_ORGANIZATION_MAX_RETRIES` | 0 | Additional attempts per batch, across restarts |
| `EVERPLAIN_ORGANIZATION_BUDGET` | unset | Maximum reserved cost per document |
| `EVERPLAIN_ORGANIZATION_INPUT_RATE_PER_MILLION` | unset | Conservative input rate in configured currency |
| `EVERPLAIN_ORGANIZATION_OUTPUT_RATE_PER_MILLION` | unset | Conservative output rate in configured currency |
| `EVERPLAIN_ORGANIZATION_COST_CURRENCY` | unset | Provider billing unit, e.g. USD or credits |

Use verified rates that cover every configured endpoint/model, including any
reasoning-token charges. There are no built-in provider prices, exchange-rate
conversions or assumed RMB amounts. Unknown rates disable this real batch path.

Before each attempt the worker reserves the full configured input/output maxima
at these rates and persists the reservation and attempt count in the document's
existing checkpoint. Failures, cancellations and unknown usage retain the
reservation. Successful calls also retain it: this is a conservative admission
budget, not an invoice estimate. Actual successful usage flows into the existing
model attempt recorder. Parallel batches share the same reservation state.
A restart or user retry loads that state. A lowered budget cannot erase prior
reservations. A currency change or legacy completed batches without cost state
fail closed. Increasing the per-batch retry setting can intentionally authorize
more attempts, but cannot replenish the document's reserved budget.

Organization fallback is also subject to the shared `MODEL_MAX_RETRIES` limit;
configure both retry limits if fallback is intentionally desired.

## Coverage boundary

The money budget applies to knowledge organization for each stored document.
It is not an account-wide, daily, process-wide or total deployment budget.
Re-uploading new content creates a new document budget. Existing billing credits
for research conversation are a separate user ledger and are not actual vendor
costs. No database migration or public API change is required.

Independent memory extraction/overview, topic naming, health probes, embeddings,
reranking, vision and transcription transports are not covered by this budget.
Shared routing limits fallback for transports that use it, but the single-call
token checks above cover structured business Chat Completions calls only.
Disabling unknown-price bulk organization does not disable those
independent transports. Keep them disabled or separately bounded when using an
unverified paid provider.
