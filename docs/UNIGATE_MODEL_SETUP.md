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
adapter. Unknown Gemini tariffs remain fail-closed: no guessed price, exemption, or
Luna price is used. Verify input, output, cache, long-context and tier/usage semantics
before populating the operator-controlled price entry described below.

Live model validation (normal, streaming, tool calls, error/cancel, and metering) remains
required with operator-provided credentials. Offline tests do not prove live support.


## Versioned operator price configuration

`EVERPLAIN_BILLING_MODEL_TARIFFS` is a JSON object keyed by the exact upstream model ID.
It adds new tariffs and rejects attempts to replace built-in Luna/other existing prices.
A priced model cannot also be redirected by `EVERPLAIN_BILLING_MODEL_ALIASES`.
Every entry requires:

- `version`: exactly `EVERPLAIN_BILLING_PRICE_VERSION`; bump that shared version for
  a reviewed rate change. Pending operations retain their original immutable snapshot.
- `source`: the verified pricing evidence reference, retained with the rate snapshot.
- `currency`: `USD`; `unit`: `usd_micro_per_million_tokens`; `service_tier`: `standard`.
- `input`, `cache_read`, `cache_write`, `output`: all required nonnegative integers in
  that exact unit. Decimal strings, booleans, partial rows and all-zero tariffs fail.
- `long_threshold`: explicit `null` for verified flat pricing, or a positive token
  threshold together with `long_rates` `[input, cache_read, cache_write, output]`.
  A long-context tier does not inherit an OpenAI multiplier. Reservations use the
  component-wise maximum of the base and long rates even when a tier is cheaper.

The existing conversion, FX snapshot, attempt/operation/daily budgets, usage validation,
owner ledger, retries and incomplete-stream reservation behavior remain mandatory.
Cache fields absent from receipts remain unknown unless separately verified and approved
through the existing provider-specific usage policy; zero cache prices do not authorize
assuming zero cache usage. Nonstandard service tiers remain unsupported and fail closed.
This configuration supports flat or one-threshold token pricing. Additional tiers,
per-request/media pricing, and provider-specific prices for the same upstream ID need an
explicitly supported billing design rather than invented aliases or approximate rates.

Use [the disabled template](../ops/config/unigate.env.example). All entries are commented
and unresolved values deliberately fail validation. Merge only the new provider/model/
tariff entries into existing maps/lists; preserve the legacy Luna environment settings.
The production preflight checks additional routes for credentials, registered prices,
matching snapshot versions and mandatory billing configuration without making requests
or printing secret values. A preflight pass still means configuration only.

## Smallest remaining release sequence

1. Merge the reviewed model and tariff commits after exact-head CI passes. Main's CD-only
   release does not contain an unmerged model PR. Verify the deployed API/Web revision
   matches a commit containing this feature; health alone is insufficient.
2. Verify the provider's exact API base path and protocol, exact upstream model ID, and
   complete pricing/receipt semantics. The SDK appends `chat/completions` or `responses`
   to the configured base. For example, a verified base ending `/v1` produces
   `/v1/chat/completions`; configuring the bare origin instead produces `/chat/completions`.
   Neither path is asserted as UniGate-compatible by this example.
3. Through approved secure administration, supply the environment-referenced credential
   and merge the reviewed nonsecret provider, model and tariff configuration. The current
   deployment pipeline preserves existing host configuration; it does not add these
   values from GitHub automatically. No credential belongs in this document or template.
4. Run existing production preflight, then apply the approved configuration with the
   existing release/configuration process. Recheck Luna and owner-scoped catalog access.
5. With separately authorized bounded real-provider checks, verify normal response,
   streaming, tool calls, provider error, cancellation, original-turn resume and billed
   usage/price snapshots. Until then report configuration delivered, not Gemini available.

At the 2026-10-04 public inspection, the model plaza remained authentication-required,
public official search yielded no Gemini price row, and no complete live tariff was
verified. The screenshot amounts alone are not sufficient to fill this configuration.
