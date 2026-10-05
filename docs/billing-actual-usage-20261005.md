# Future-request actual usage policy, 2026-10-05

New operations snapshot `billing_policy=actual_usage_v1`. Existing snapshots,
including those without a policy field, retain the previous delivery/refund
policy. Historical failures are never recharged. This policy is combined with
the seven-day allowance epoch migration described in `engineering/weekly-quota.md`.
Global budgets, model tariffs and summary funding remain unchanged. This
supersedes the future-request failure waiver described in
the 2026-10-02 implementation notes.

Starting an operation reserves no wallet points. Only an actual bounded outbound
attempt atomically reserves that request's maximum priced consumption, preventing
parallel requests from spending the same balance. No SQLite transaction spans
provider HTTP. Confirmed, correctly priced usage and its actual debit share the
same short receipt transaction. Error, interruption, truncation, refusal and
output-validation retries do not refund already consumed known usage. Wallet
capacity is released immediately when the attempt terminates, and all remaining
capacity is released when the operation closes or stale recovery closes it.

The account-wide exact fractional carry and deterministic ledger identities remain
authoritative. Repeated callbacks, repeated finalization and restart recovery
cannot charge the same confirmed usage again. A paused operation keeps its price
and policy snapshot when resumed; cancelling a later stage does not refund prior
confirmed consumption. Administrator and explicit operator-funded phases remain
exempt from user debits.

Quota-backed operations lock their personal period epoch when started. A delayed
receipt or legacy refund updates only that epoch's balance and exact carry, even
after bank RESET or a seven-day renewal. It cannot consume the current allowance.
Ledger entries identify their quota epoch and its resulting balance. A paused
operation cannot dispatch new paid HTTP against a different period. Operator
scopes never start a personal period; background user-funded phases require an
already-started period, while accepted conversation, research and direct writing
requests may start it.

Missing, contradictory or unpriced usage is not estimated into a user charge.
Unknown failed attempts release wallet capacity but retain NULL cost and provider
receipt evidence for reconciliation, including the existing historical unknown
records. Late receipts on a terminal operation only repair cost evidence and
operator risk; they cannot reopen it or charge the user. Existing reset terminal
fences and precision adjustments remain untouched. Unexpected model substitutions
and provider overruns retain their previous protective guards; they are not newly
authorized user charges.

The global daily reference-cost guard is unchanged. It still counts known costs
today and the maximum reservation for unresolved costs. A confirmed receipt
replaces its unknown maximum with the actual known amount; failure billing does
not remove known spending from this budget or bypass a full global guard.

Verification uses synthetic SQLite/SDK transport only. Production availability,
provider receipts and deployment require separate verified release evidence.
