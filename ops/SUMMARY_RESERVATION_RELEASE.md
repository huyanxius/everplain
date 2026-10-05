# Reviewed pre-network summary reservation release

`release_summary_reservations.py` is a narrowly scoped, manual compensation tool
for the two confirmed failed summary reservations on **2026-10-05**. It does not
recover other failure categories, reconcile provider cost, or issue credits.

## Preconditions and sequence

1. Deploy the summary funding/preflight fix first. Verify its audit-preserving
   behavior before applying this compensation.
2. Prepare a private JSON manifest from the owner's reviewed evidence: the two
   exact owners, current bounded source fingerprints, schema revision, counters,
   and expired retry timestamps. Evidence must establish missing
   `memory_learning` phase policy, an otherwise configured billing runtime, and
   failure before opening a billing operation or dispatching a provider request.
   The manifest's `evidence_revision` identifies that reviewed evidence; the tool
   cannot independently prove a historical environment configuration.
3. Run a real dry-run against the intended database and review its digest/result.
   Only then authorize an explicit `--apply` using the unchanged private manifest.
   Keep the manifest and database out of version control. Use the existing
   production preflight/backup procedures before a production apply.

The default run executes the same updates in `BEGIN IMMEDIATE` and always rolls
them back. Both users must pass every guard before either is changed. The script
opens only an existing SQLite database (`mode=rw`) and creates no tables,
migrations, credentials, network connections, model calls, or background jobs.

Use the installed backend Python interpreter, for example from the repo root:

```sh
backend/.venv/bin/python ops/release_summary_reservations.py \
  --database /private/everplain.db --plan /private/reviewed-summary-release.json

# Separately authorized, only after review and deployment:
backend/.venv/bin/python ops/release_summary_reservations.py \
  --database /private/everplain.db --plan /private/reviewed-summary-release.json --apply
```

The script can also run with the API container's installed backend interpreter.
It uses the runtime repository's exact source snapshot implementation within the
same transaction, including privacy, project, redaction, and deletion fences.
Running from a repo checkout adds that checkout's `backend/src` to the import
path; a standalone copy uses the independently installed backend package.

## Manifest

This example contains synthetic identifiers and placeholder fingerprints only.
Replace them with privately reviewed evidence; do not commit a production plan.

```json
{
  "version": 1,
  "plan_id": "summary-pre-network-reservations-20261005",
  "evidence_revision": "reviewed-evidence-revision",
  "schema_revisions": ["reviewed_alembic_revision"],
  "users": [
    {
      "user_id": "10000000-0000-0000-0000-000000000001",
      "fingerprint": "<64-character lowercase source SHA256>",
      "day": "2026-10-05",
      "expected": {
        "attempts": 2,
        "calls": 2,
        "budget_tokens": 48000,
        "input_tokens": 0,
        "output_tokens": 0,
        "retry_after": "2026-10-05T00:00:00+00:00",
        "last_error": "summary_failed",
        "lease_token": null,
        "lease_until": null,
        "cache_fingerprint": ""
      }
    },
    {
      "user_id": "10000000-0000-0000-0000-000000000002",
      "fingerprint": "<64-character lowercase source SHA256>",
      "day": "2026-10-05",
      "expected": {
        "attempts": 2,
        "calls": 2,
        "budget_tokens": 48000,
        "input_tokens": 0,
        "output_tokens": 0,
        "retry_after": "2026-10-05T00:00:00+00:00",
        "last_error": "summary_failed",
        "lease_token": null,
        "lease_until": null,
        "cache_fingerprint": ""
      }
    }
  ]
}
```

The plan ID, usage day, two distinct canonical UUIDs, and exact counters are
fixed. `last_error` may be the legacy `summary_failed` or the newer fixed
`billing_open:phase_policy_missing` diagnostic, and must match the reviewed row.
Retry times must match and already be expired. Any summary lease, including an
expired residual lease, or nonempty generated cache refuses the whole plan.

The tool checks the exact operation fingerprint used by
`SqliteBillingOperations.open`: SHA256 of the default JSON encoding of
`{"context_fingerprint": source_fingerprint}` with sorted keys and UTF-8.
It refuses matching billing operations in **every** state, even with zero
attempts. It also checks the attempts join and refuses orphan attempts whose
operation cannot establish attribution. It does not assume that an `unknown`,
failed, or refunded operation had zero provider cost. Unexpected update triggers
on either changed table are refused.

## Mutation and durable replay

Each user receives only `calls: 2 → 0`, `budget_tokens: 48000 → 0`, and
`attempts: 2 → 0`. Input/output usage, expired `retry_after`, `last_error`,
timestamps, fingerprints, leases, ledger, balances, risk records, other-day
quotas, and replay/security fences stay unchanged. The existing summary JSON is
preserved and receives this audit entry:

`_reservation_release_audit.compensations[plan_id]`

The entry records the canonical plan digest, evidence revision, fixed reason,
timestamp, source fingerprint, and exact before/after counters. Existing audit
metadata (including `preflight`) and other summary keys are preserved.

Replaying the same successful plan reports `already_applied`, with zero refunds,
even if subsequent legitimate work has changed source/counters/leases. A changed
manifest, malformed audit, or partial two-user audit refuses without writes.
The fix must preserve the entire audit key during future summary writes so that
this durable protection survives subsequent generation.

Reports contain user indexes, counts and plan identity, never user IDs, source
text, prompts, credentials, or raw SQL exception details. A refusal or runtime
error returns a nonzero exit code. A dry-run is not proof of live-model success.

## Synthetic verification

```sh
backend/.venv/bin/python -m unittest discover -s ops/tests \
  -p 'test_release_summary_reservations.py' -v
backend/.venv/bin/ruff check --config backend/pyproject.toml \
  ops/release_summary_reservations.py ops/tests/test_release_summary_reservations.py
```

All fixtures are synthetic and offline. No real database or user identifiers
are included in the tests or this document.
