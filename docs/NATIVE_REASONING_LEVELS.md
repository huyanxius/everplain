# Native reasoning controls

This change adds server-only `effort_settings` to each additional model registration.
The frontend continues to use the authenticated server catalog. It does not add a
Gemini/DeepSeek/Claude catalog, infer support from a model name, invent an off setting,
or carry an invalid old effort to a new model. `minimal` is now representable, but
Luna's existing six levels and its configured default are unchanged.

## Configuration contract

Every advertised additional-model level must have exactly one distinct registered
wire mapping. The default must belong to that level list. Empty lists still require
null defaults and have no slider. Unsupported or incomplete mappings fail startup.
Only reasoning settings are accepted: `openai_reasoning_effort` and reasoning fields
inside SDK `extra_body`. Credentials, output-token limits, providers, model IDs,
timeouts, and tariffs cannot be overridden through these per-level settings.

Example for a verified native adaptive passthrough, not evidence for any existing
Chat gateway:

```json
{
  "reasoning_efforts": ["low", "medium", "high", "xhigh", "max"],
  "default_reasoning_effort": "high",
  "effort_settings": {
    "low": {"extra_body": {"thinking": {"type": "adaptive"}, "output_config": {"effort": "low"}}},
    "medium": {"extra_body": {"thinking": {"type": "adaptive"}, "output_config": {"effort": "medium"}}},
    "high": {"extra_body": {"thinking": {"type": "adaptive"}, "output_config": {"effort": "high"}}},
    "xhigh": {"extra_body": {"thinking": {"type": "adaptive"}, "output_config": {"effort": "xhigh"}}},
    "max": {"extra_body": {"thinking": {"type": "adaptive"}, "output_config": {"effort": "max"}}}
  }
}
```

Selected mappings take precedence over generic SDK reasoning. They are copied for
each selected run, cannot leak to a cross-model fallback, and remain server-only.
Existing non-selected/legacy requests keep their previous settings. The legacy
DeepSeek-off special case only matches the older official DeepSeek route; it never
matched the production Qiniu V4.1 registration.

## Evidence checked 2026-10-05

Native capabilities and current gateway compatibility are separate facts:

- [Gemini 3.5 Flash](https://ai.google.dev/gemini-api/docs/whats-new-gemini-3.5?hl=en):
  `minimal`, `low`, `medium` (default), `high`. No actual off mode. Google's own
  [OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai) documents
  both `reasoning_effort` and a native Google thinking-config envelope. These are
  mutually exclusive. This does not establish UniGate's current Chat passthrough.
- [DeepSeek API](https://api-docs.deepseek.com/guides/thinking_mode/):
  `none`, `low`, `high` (default), `max`, with explicit thinking disabled/enabled.
  `minimal`/`medium`/`xhigh` are aliases, so they must not become extra native stops.
  The local inference model's numeric effort is not the hosted API contract.
- [Claude Sonnet 5.5](https://platform.claude.com/docs/en/models/sonnet-5-5/whats-new-sonnet-5-5):
  native adaptive `low`, `medium`, `high` (default), `xhigh`, `max`.
  `thinking.type=disabled` and manual thinking budgets are rejected. `between_tools`
  is a separate mode, not a sixth "none" effort.
- [Qiniu Chat parameters](https://developer.qiniu.com/aitokenapi/13390/chat-completions)
  document thinking and reasoning-effort fields generally. The detailed
  [Modelink Chat schema](https://docs.modelink.ai/api/chat-openai) currently lists
  `reasoning_effort` as `low/medium/high/minimal/none`, lists `reasoning.effort` as
  `low/medium/high`, and does not list Chat `output_config`. It documents native
  output-config separately on [Anthropic bypass](https://docs.modelink.ai/api/chat-native).
  These pages do not prove V4.1 `max` or Sonnet 5.5 adaptive effort on the current
  Qiniu Chat route. The existing adapter supports Chat and Responses, not native
  Gemini/Anthropic transport; do not simply change the configured protocol.

UniGate public settings report version 0.2.8 and no documentation URL. Its public
frontend identifies the Sub2API family. The public upstream
[v0.2.8 Gemini Chat adapter](https://github.com/Wei-Shaw/sub2api/blob/fd80b08c90b55edcad5b00171b53f08721d30da1/backend/internal/service/gemini_chat_completions_compat_service.go)
converts through Responses and Claude messages; the
[Gemini generation-config conversion](https://github.com/Wei-Shaw/sub2api/blob/fd80b08c90b55edcad5b00171b53f08721d30da1/backend/internal/service/gemini_messages_compat_service.go)
does not include thinking config. Its separate
[Antigravity variant selection](https://github.com/Wei-Shaw/sub2api/blob/fd80b08c90b55edcad5b00171b53f08721d30da1/backend/internal/service/antigravity_gemini_thinking_variant.go)
also applies its own low/medium/high model-suffix rules. This establishes a
passthrough risk in the public upstream, not the behavior of UniGate's customized
running deployment or a particular account route. Verify that route before
advertising Gemini native levels. Raw Google envelope serialization alone is not
proof that UniGate forwards it.

## Narrow production configuration update

The current three additional-model registrations have no advertised efforts.
Update only the reasoning fields in an existing entry matched by its product
`model_id`, after verifying that entry's exact host/path/protocol/upstream model.
Preserve every other entry, all existing field values, provider/key references,
Luna defaults, model-capacity metadata, pricing, and the user's independent Qiniu
model configuration. Do not replace `EVERPLAIN_AGENT_SELECTABLE_MODELS` with a
three-item sample or install a key from these examples.

For Qiniu V4.1 the smallest documented candidate subset is `none/low/high`,
default `high`, with the following per-level mappings. Its gateway acceptance
and actual forwarding still need a bounded authorized check:

```json
{
  "none": {"extra_body": {"thinking": {"type": "disabled"}}},
  "low": {"openai_reasoning_effort": "low", "extra_body": {"thinking": {"type": "enabled"}}},
  "high": {"openai_reasoning_effort": "high", "extra_body": {"thinking": {"type": "enabled"}}}
}
```

Do not add `max` until the Qiniu route verifies it. Do not advertise Gemini's four
or Claude's five native stops by sending a generic enum or undocumented Chat
fields. Prefer an already supported, verified native passthrough if available;
otherwise first add a transport adapter with complete tools/stream/receipt billing
coverage. Preserve the same existing key, model and reviewed price throughout.

After merging approved fields into the full current list, run Settings validation
and existing production preflight before the normal Everplain deployment. Re-read
the owner-scoped catalog, then verify each advertised level's final wire and
upstream forwarding. A successful generic response is insufficient to show that
a gateway used the requested level.

## Verification in this checkpoint

- Synthetic HTTP exercises 19 native field mappings across all four models.
- Registry validation rejects missing/default/duplicate/unmapped settings.
- Actual serialization is checked, including exclusive native fields and strict
  per-model routing. These tests never call or bill a real provider.
- Frontend tests retain model/effort validation, owner storage revalidation,
  supported old-level preservation, default fallback, and empty-slider hiding.
- `make contract` equivalent export and API generation produces the public
  `minimal` extension only; server wire maps and credentials remain private.
- Local browser QA was attempted in the cloud browser, which returned
  `ERR_BLOCKED_BY_CLIENT` for the local preview. No browser bypass or screenshot
  was attempted. Actual browser and real-provider acceptance are outstanding.
