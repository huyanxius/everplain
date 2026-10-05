# Native reasoning runtime handoff

Implementation checkpoint, 2026-10-05, based on production/main `b2e353f`.
The bundle manifest identifies the exact final commit. This is runtime code with
synthetic SDK/HTTP/SSE/tool/SQLite evidence, not live gateway acceptance.

## What is implemented

- Explicit provider protocols `gemini_generate_content` and `anthropic_messages`.
  Existing Chat/Responses routes and every model remain opt-in as configured.
- Server-only effort fields `google_thinking_level`, or `anthropic_effort` plus
  `anthropic_thinking`. Validation rejects mixed protocols, missing modes,
  duplicate wire controls and any advertised level without an exact mapping.
- Native Gemini serializes `generationConfig.thinkingConfig.thinkingLevel` in
  uppercase. Anthropic serializes `thinking.type` and `output_config.effort`.
  Neither sends an OpenAI reasoning enum. Signed thinking/tool blocks survive
  both streaming and buffered tool round trips.
- Native authentication is explicit: provider `native_authentication` is
  `native` (SDK key header) or `bearer` (gateway Authorization). One configured
  credential reference is used; incompatible extra credential headers are removed.
- The existing OperationScope creates one attempt from the canonical wire
  payload and native path before each network call. Model routing is one exact
  endpoint. SDK automatic retries are disabled; hidden resends are rejected.
- Raw HTTP JSON/SSE receipts are observed before SDK coercion, retaining explicit
  counters and terminal evidence. Anthropic inclusive input sums ordinary/read/write
  once; Google output includes candidates plus thoughts once. Missing cache facts,
  malformed counters and incomplete terminals remain pending while body delivery
  continues. Native attempts use the same persisted, idempotent reconciliation.
- Google SDK custom-host price extraction is overridden with native raw facts.
  Anthropic's incompatible unsupported Omit arguments alone are removed; explicit
  unsupported settings fail. The locked SDKs are PydanticAI 1.107.5, Anthropic
  1.11.0 and google-genai 2.28.0; existing OpenAI 3.1.0 stays unchanged.

## Capacity and accounting

The selected Agent does not use the generic Settings input 32000/output 3000 as
wire caps or local admission limits. Exact registered capacities supply the native
maximum. Unknown Google capacity omits `maxOutputTokens`, which is optional.
Anthropic Messages requires `max_tokens`; its route must supply explicit capacity
metadata, rather than inherit the SDK's 4096 default. No QA 512 cap is a product cap.

[Google's model page](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash)
states 1,048,576 input/65,536 output. [Claude's model page](https://platform.claude.com/docs/en/models/sonnet-5-5/overview)
states 1M context/128K output. These are original-model limits, not verified relay
limits. Confirm the exact integer and accepted native limit using the configured
gateway's model metadata or its native Models API; do not guess 128K's integer.

Google cache write stays unknown unless the existing, exact host:model
`billing_usage_policies` explicitly establishes `omitted_cache_subsets_are_zero`.
No tariff or SDK-default zero creates that evidence. Native receipts reuse the
existing known/pending and saved/unsaved status; unknown usage does not start a
second invocation or ledger. Reference tariffs are not procurement prices.

## Current provider evidence and activation boundary

The Mac publisher owns all GitHub/configuration/deployment writes. Merge provider
and model changes by existing model ID; never replace the entire model list. Keep
all other providers, key references, model IDs, prices and Luna defaults intact.

- Gemini: current UniGate Chat route has no documented per-model thinking/native
  passthrough evidence. Keep its present route until that exact account/endpoint
  is verified. Do not move it to Qiniu to fill the gap. A verified native route can
  map minimal/low/medium/high with default medium; no off stop is invented.
- Claude: Qiniu/Modelink native `/bypass/anthropic/v1/messages` documents adaptive
  and low/medium/high/max. The candidate provider base is the existing Qiniu host
  plus `/bypass/anthropic`; add a separate provider reusing the existing approved
  key reference. The actual Sonnet5.5 route/auth/capacity still needs verification.
  xhigh's original-model SDK mock is not proof of Qiniu support; omit it there.
- DeepSeek: keep the Qiniu Chat route and its verified 1M/384000 capacity. The
  generic Chat schema has reasoning_effort low/medium/high/minimal/none and thinking
  enabled/disabled/auto, but that alone does not prove per-model strength support.
  Exact model metadata reviewed on the Mac reports capacities, not a strength enum.
  The model description proves thinking enabled/disabled; multi-strength activation
  remains unverified. Do not label enabled as high. A separately reviewed minimal
  on/off catalog contract can follow this runtime checkpoint.

Sources: [Qiniu Chat](https://developer.qiniu.com/aitokenapi/13390/chat-completions),
[Modelink dated Chat OpenAPI](https://docs.modelink.ai/openapi/chat.openapi.json),
[native API](https://docs.modelink.ai/api/chat-native),
[Claude native thinking](https://platform.claude.com/docs/en/models/sonnet-5-5/whats-new-sonnet-5-5).

The only remaining live evidence is exact account/model native route availability,
auth and capacity acceptance, plus per-model controls and raw receipts. Read current
account procurement rates and obtain any necessary bounded paid-check authorization
before generation probes. No paid probe or production configuration change was made
by this checkpoint. Do not promise a cost ceiling from reference or estimated rates.
