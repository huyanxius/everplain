# UniGate selectable models

Additional providers are opt-in and do not change the legacy model or Luna default.
`EVERPLAIN_AGENT_PROVIDERS` is a JSON object keyed by provider ID. Each provider has
`base_url`, explicit `protocol` (`chat_completions` or `responses`), and `api_key_env`.
Only `EVERPLAIN_*_API_KEY` references are accepted; keys never enter the catalog or turn.
`EVERPLAIN_AGENT_SELECTABLE_MODELS` is a JSON array of model registrations.

Registration example (not a verified live-provider configuration):

```json
[{"model_id":"gemini-3.5-flash","model":"gemini-3.5-flash","label":"Gemini 3.5 Flash","provider":"unigate","capabilities":["chat"],"reasoning_efforts":[],"default_reasoning_effort":null}]
```

The provider references `EVERPLAIN_UNIGATE_API_KEY`, populated only via the existing
secure deployment secret flow. Do not put actual credentials in checked-in files.
The operator must explicitly supply the verified base URL and protocol. The resolver
preserves the exact configured path; it never appends or guesses `/v1`.

Public checks on 2026-10-04:
- `https://unigate.top/api/v1/settings/public` publishes `api_base_url=https://unigate.top`.
- `https://unigate.top/v1/models` returns 401 `API_KEY_REQUIRED`; this proves an auth
  boundary exists, not Gemini availability or Chat Completions/tool/stream compatibility.
- The public website's model plaza requires authentication. Its JavaScript multiplies
  token prices by 1,000,000 for display, but the screenshot's precise row/pricing fields
  are not available in the unauthenticated catalog. No tariff is inferred from this.

Models without verified reasoning controls use an empty effort list and null default.
The same picker hides its effort control, persists the owner's selection, and restores
an interrupted turn's original model. Unknown effort input fails before the turn starts.
Every selected model gets a strict one-endpoint route and the existing required billing
adapter. Unknown Gemini tariffs remain fail-closed: this patch does not add a guessed
price, exempt the model, or use Luna's tariff. Verify input, output, cache, long-context
and tier/usage semantics and add an approved versioned price before activation.

Live model validation (normal, streaming, tool calls, error/cancel, and metering) remains
required with operator-provided credentials. Offline tests do not prove live support.
