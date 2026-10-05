# Native reasoning adapter plan and verified boundaries

Status: design plus isolated SDK contracts, 2026-10-05. The production provider
registry and routes remain unchanged. This is not a live gateway acceptance report.
Implementation prerequisite: `03792fed306f61a8963cec6cd501afb5cf2dd26c` on capacity
base `b2fcba0b777e372fdc71fa23969ad6a384e596d9`.

## What the present evidence supports

The server-only effort-map infrastructure and `minimal` public contract are ready.
The operator must still register only controls verified for the exact route.
Current production Gemini/DeepSeek/Claude registrations have empty effort lists.
No new slider is automatically advertised by this checkpoint.

- Gemini 3.5 native levels: minimal, low, medium, high; default medium. UniGate's
  current Chat passthrough and its account's native Gemini route are unverified.
- DeepSeek V4.1: its native hosted API supports none, low, high, max. The Qiniu Chat
  contract supports a conservative none/low/high candidate subset; max is unverified.
- Claude Sonnet 5.5 native model: low, medium, high, xhigh, max; default high.
  Qiniu's documented native Anthropic endpoint supports adaptive plus
  output_config.effort low/medium/high/max. It does not name Sonnet 5.5 or xhigh.
  Therefore that endpoint's four documented fields remain a candidate, not proof
  of current account/model availability. xhigh must remain unadvertised there.

The Mac read-only review found no logged-in provider console and performed no
credential read, configuration change, or paid model probe. The current execution
channel subsequently became unavailable, and actual account price projections are
missing. Do not expand or execute a paid validation plan until the main task obtains
current prices and the required bounded authorization through a supported channel.

Sources: [Google native thinking](https://ai.google.dev/gemini-api/docs/whats-new-gemini-3.5?hl=en),
[DeepSeek hosted API](https://api-docs.deepseek.com/guides/thinking_mode/),
[Claude Sonnet 5.5 changes](https://platform.claude.com/docs/en/models/sonnet-5-5/whats-new-sonnet-5-5),
[Modelink Chat](https://docs.modelink.ai/api/chat-openai),
[Modelink native protocols](https://docs.modelink.ai/api/chat-native).

## Smallest transport implementation after route confirmation

Keep the existing OpenAI Chat/Responses path and dependencies stable. Do not feed
native Google/Anthropic controls to that path unless the gateway specifically
verifies its translation. Introduce explicitly registered native protocols only
when needed and confirmed:

- `gemini_generate_content`: GoogleModel/GoogleProvider; native request path
  `/v1beta/models/<same-model>:streamGenerateContent`, with canonical
  generationConfig.thinkingConfig.thinkingLevel MINIMAL/LOW/MEDIUM/HIGH.
- `anthropic_messages`: AnthropicModel/AnthropicProvider; documented Qiniu path
  `/bypass/anthropic/v1/messages`, with thinking.type adaptive and
  output_config.effort using only the verified subset.

These are prospective adapter protocols, not values the present Settings registry
accepts. A separate provider registration should reuse the existing approved key
reference and preserve the old provider entry, so adding a native route cannot
change other models sharing that provider. Preserve model IDs, tariffs, capacities,
Luna defaults and every unrelated registration. Do not copy or expose key values.

Add native SDK fields to the server-only effort map with protocol-specific
validation. Do not accept native provider settings from a turn request. Build a
fresh model/client for each selected run, use the strict single-endpoint
ModelRouteExecutor, and retain the originally selected effort on resume. Do not
fall back to another model, protocol or provider when native parameters fail.

The model-capacity registry must describe the exact native path/protocol too.
Translate the verified upstream maximum to max_tokens for Anthropic and
maxOutputTokens for Google. The 4096 cap in the offline harness is a QA-only
limit, not a proposed product output cap. Keep existing Qiniu native limits.

Native thinking signatures and tool-call blocks stay inside SDK ModelMessages
unchanged throughout a tool round trip. Forward only user-visible text into the
existing output lifecycle. Never force a tool choice that Sonnet 5.5 rejects.
Streaming, refusal, truncation, cancellation, original-turn recovery and tool
results must retain the existing output-attempt/cursor semantics.

## Observed SDK compatibility, not an untested upgrade proposal

Isolated test versions: PydanticAI 1.107.5, anthropic 1.11.0, google-genai 2.28.0,
httpx 0.28.1, httpx2 2.13.1, genai-prices 0.1.9. No project lockfile or another
worker's environment was modified.

Plain PydanticAI native use had two demonstrated compatibility problems:

1. Anthropic's current create method no longer accepts temperature/top_p/top_k,
   while this PydanticAI version still passes their Omit placeholders. The isolated
   prototype removes only unsupported Omit values. An explicitly supplied
   unsupported setting fails; it is never silently discarded.
2. Google SDK serialization produced thinking_level inside thinkingConfig.
   The isolated native transport canonicalizes just that alias to thinkingLevel
   before final capture, request hashing and transmission. Competing aliases with
   different values fail. Headers, model, limits and unrelated payload fields are
   preserved. This canonical form matters for gateways whose native routing reads
   the documented camel-case field. It is not evidence that Google itself rejects
   protobuf snake-case aliases.

One attempt to install PydanticAI's minimum optional dependencies, anthropic
0.108.0 and google-genai 1.70.0, timed out retrieving the official wheel metadata.
They were not installed or tested. No further version search was performed.
Pin a tested native dependency combination and isolate these adapters; do not
blindly upgrade the existing OpenAI runtime or present the untested minimum pair
as compatible.

`ops/qa_native_protocol_contracts.py` is an isolated design harness. Every request
uses a synthetic host, synthetic credential and MockTransport. Its eight native
SDK cases verify the actual serialized fields for four Google and four Anthropic
levels. Seven additional cases verify raw receipt totals and fail-closed unknowns.
It does not enable or bill a production native adapter.

## Billing and receipt invariants

Retain the same OperationScope and persisted attempt/receipt lifecycle. Capture
the final native wire body after compatibility normalization, including the actual
explicit native effort. Do not record native selections as absent merely because
there is no OpenAI reasoning_effort field.

Normalize raw provider receipts directly, not SDK price-extraction totals. In the
isolated custom-host Google case, the generic SDK extractor returned zero totals
although the raw native response contained valid prompt/candidate/thought counts.
This is a demonstrated reason to preserve the existing raw-counter policy, not a
claim about live UniGate receipts.

- Anthropic input_tokens excludes cache-read and cache-creation input. Inclusive
  input is input_tokens + cache_read_input_tokens + cache_creation_input_tokens.
  Its output total already includes thinking. Do not bill thinking a second time.
- Google promptTokenCount already includes cachedContentTokenCount. Inclusive
  output is candidatesTokenCount + thoughtsTokenCount. Validate totalTokenCount
  against prompt + candidates + thoughts and validate cache subsets.
- Absent cache counters remain unknown. A Google cache-write value requires an
  explicitly verified route policy; a zero tariff does not establish a zero
  counter. Invalid or contradictory counters never become a zero-cost receipt.
- Raw partial/terminal usage, model/version, request ID, finish reason and explicit
  effort must remain associated with one persisted attempt. Require native
  terminal evidence; EOF or SDK-default zero counters do not make usage known.
- Unknown usage or receipt-persistence failure follows the existing known/pending
  and saved/unsaved contract, retains visible body, and does not trigger a second
  model request or a separate ledger. Settlement may remain pending.
- Disable provider SDK automatic retries for bounded acceptance checks. Charge and
  count every actual attempt; do not switch to a paid builtin tool or premium tier.

Reference schemas: [Google UsageMetadata](https://ai.google.dev/api/generate-content#UsageMetadata)
and the native Anthropic response contract. Full native streaming/tool/billing
wrapper integration remains to be implemented and tested after route confirmation.

## Acceptance decision held by the main task

Read current account/model metadata and actual price snapshots first through the
restored authorized execution channel. A successful response or timing difference
alone does not establish that a Chat gateway honored native effort. Prefer
contractual native passthrough plus a verifiable forwarded/requested field or
provider confirmation. Keep unsupported controls absent from the catalog.

Only after the necessary bounded authorization, run the smallest staged real
acceptance check against the same providers, models and existing secure credential
configuration. Do not place credentials in chat, logs, files, Library or cloud QA.
Do not change production provider/model/price settings merely to run probes.
The main task owns that decision; this checkpoint starts no paid requests and
makes no promise about a gateway cost ceiling.
