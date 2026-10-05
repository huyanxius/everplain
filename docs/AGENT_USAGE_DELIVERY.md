# Agent output, receipts and settled credits

New Agent `agent_turn` and `user_research` operations snapshot
`billing_policy=actual_usage_v2`. Standalone/operator funding and existing
`actual_usage_v1`/historical delivery snapshots retain their existing policy.
This change requires the existing 0600 quota-epoch dependency, and adds no
migration, tariff, new payment route, credential or tool permission.

`OperationScope.delivery_state` exposes independent facts:

- `output_finish_reason`: `complete`, `truncated`, `rejected`, `upstream_error`
- `usage_status`: `known` or `pending`
- `settlement_status`: `settled` or `pending`
- `pending_credit_numerator`: unfunded confirmed retail numerator, exact string
- `quota_exhausted`: confirmed quota has been consumed or a known cost cannot fit

Missing/contradictory terminal usage does not interrupt Chat/Responses content
or stop the next tool/model step. All received content remains available for the
runtime's independently committed output journal. Unknown counters and reference
cost remain NULL in the ledger, never a guessed zero. SDK `RequestUsage()` is an
internal loop placeholder, accompanied by provider `usage_status=pending`; it is
not an actual receipt or a user charge. A `length` / `max_output_tokens` terminal
is delivered as truncated output with its exact known receipt, once.

v2 does not reserve the provider's entire native maximum output against a wallet.
An absent output cap is recorded as `-1` metadata, without changing the upstream
request. Financial per-attempt, operation, attempt-count and global-daily estimate
guards do not block v2 Agent dispatch. Unknown prices are reconciliation facts,
not a reason to stop received content. Ordinary ownership, lease, epoch, API,
SDK-retry and supported-tool restrictions still apply.

On a confirmed receipt, real input/output and procurement/reference cost are
preserved. Only the current quota's available part is applied. The full retail
numerator is `original_credit_pico`, the applied numerator is `credit_pico`, and
the difference remains explicitly pending. This does not waive the remainder,
create negative credits, add cash billing, or authorize automatic later recovery.
Repeated callbacks/finish do not re-debit it. Once confirmed quota is exhausted,
the next wire request fails with `BillingBudgetExceeded(reason=credits_depleted)`
and the public message is: `额度已用尽，请等待 receipt`.

Providers that only reveal usage at their terminal event cannot provide exact
per-token quota stopping. The application can stop subsequent dispatch at that
first confirmed boundary and preserve output already received. This is not a
promise that remote generation stops at the exact wallet token boundary.

This document describes the new local interface. Verification uses synthetic
SDK HTTP/SSE and isolated SQLite only. Real provider, browser, remote CI and
production deployment must be verified separately after Mac publication.
