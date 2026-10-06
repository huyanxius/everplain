# Personal account export contract

The account export uses the existing `2026-09-everplain-export-v1` JSON envelope,
record/table keys, IDs, timestamps and base64 file encoding. The export endpoint,
idempotency keys, download ownership/expiry checks and response headers are
unchanged. Existing stored archives are returned as originally persisted; they
are never reprojected or rewritten by this code. Account deletion is separate and
has not been redesigned by this change.

## Explicit authorization

`adapters/sqlite/account_export_contracts.py` is the reviewed field inventory.
Each exported table declares scalar fields, JSON projections, binary fields,
stable row identity and its owner selector. Every omitted field/table has an
explanation. Adding an ORM column or foreign key never grants export permission.

A direct `user_id`/`owner_user_id` is authoritative. It cannot be overridden by a
reference to another owner's parent. Rows without an owner use only the declared
parent path. Multiple declared parents are combined with AND, not an automatic
OR over all foreign keys. Account audit events have an explicit actor-or-target
exception, which retains relevant actions without traversing into anyone else's
account. Counterparty email and session environment are not included.

The reader uses named columns and a fixed number of per-table queries. It does
not reflect database tables, scan foreign-key constraints or accumulate arbitrary
reachable rows. Each query orders by the declared stable record identity. Current
contracts are capability data, not a generic authorization/CRUD framework.

## JSON and original files

`account_export_json.py` declares nested server-owned structures. Unknown object
keys, including unknown nested keys, are omitted. Malformed object/list values
fail closed. Text is never searched for forbidden words. Empty strings/lists,
zero, false, null and Unicode are preserved for their declared shapes. Uploaded
file bytes are encoded as `{ "encoding": "base64", "base64": "..." }`.

Agent request snapshots retain the visible message and declared request options;
visible context cards are projected to title/description. Tool traces use explicit
per-tool input/output shapes, preserving research-map patches and reviewed-card
metadata, bounded source items, pending plans and completion cards. A pending
plan's raw prompt may contain execution instructions; only the run's original
visible message is used in its exported prompt. Unknown tools receive no payload
permission. Runner instructions,
hidden card sources and billing pointers are not exported. Conversation summaries
first go through the existing owner/source-validated public reader, including its
last-good handling, and then the closed export projection. Neither projection
changes the persisted request or summary cache.

There are narrow, intentional personal-content exceptions:

- Model invocation `input_evidence` and `output` preserve arbitrary historical
  personal research evidence keys and values. `adapters/model/gateway.py` produces
  these from research capability inputs/results, not HTTP credentials, Agent
  execution prompts or procurement envelopes. The four current producer
  capabilities have a regression test. This is a content contract, not a promise
  that arbitrary newly injected secrets can be detected by their spelling.
- Literature `csl_data` is the user's imported bibliographic content, including
  standard CSL fields, extensions and custom user keys. `LiteratureEntry.create`
  retains this document; DOI enrichment adds bibliographic facts. It must not be
  repurposed to hold server execution or billing metadata.
- Research case attributes use user-defined names with scalar values; qualitative
  case profiles also support their documented name/value-pair representation.
- Identifier-indexed maps (for example canvas nodes) still apply a closed value
  shape. Unknown structure keys cannot become content merely by being nested.

New server metadata must use a separately classified field or an explicitly
reviewed versioned structure. Mixing it into a personal-content payload violates
that producer contract. New capabilities and changes to JSON producers need
review of their export shapes in addition to the schema gate.

Raw billing tables contain operator pricing, procurement and dispatch evidence;
they are explicitly excluded. User credit ledger and quota records remain
portable. The existing customer billing receipt API remains the authority for
public reference prices and usage projections. Credentials, pairing codes,
worker leases, replay caches, global catalogs and FTS indexes have explicit
exclusion records. Their authoritative personal source records are exported
where applicable.

## CI and verification

`tests/test_account_export_contracts.py` is included in `tests/product-suite.txt`.
It upgrades a new synthetic database through the full Alembic head and invokes
`validate_export_schema`, including raw-SQL billing and SQLite FTS shadow tables.
Unknown or stale tables/columns, ORM/migration drift, unclassified JSON/binary
columns, missing ownership and ownership cycles fail the gate. Schema inspection
is used only to check completeness; it never determines output permissions.

Run from `backend`:

```
python -m pytest tests/test_account_export_contracts.py
python -m pytest tests/test_account_management_api.py
python -m pytest tests/test_everplain_account_data.py tests/test_writing_account_data.py tests/test_context_card_export.py
python -m pytest tests/test_account_billing_privacy_api.py tests/test_subscription_account_deletion.py tests/test_account_management_migration.py
```

Tests cover new secret columns/tables, direct-owner mismatches, multiple-parent
links, indirect message ownership, JSON unknown keys and malformed structures,
original binary data, repeatable snapshots, export replay, existing archive
immutability, cross-user download denial, billing procurement isolation, audit
subject rules and the absence of schema discovery in the export SQL.

These are synthetic regressions. They do not establish a production data leak,
a complete account-erasure/backup compliance audit, or production verification.
