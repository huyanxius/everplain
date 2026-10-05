# 0630 to 0640 membership voucher forward-only review

Immutable source baseline: `f6747a67eaf6d7f3d117e929332b89eb897d1ae7`.
All historical Python migration files and the retrieval schema adapter were
read from that Git object and match the candidate with only 0640 excluded.
Review and tests use synthetic, file-backed SQLite databases in the cloud
workspace. No production server, real account, payment provider, secret or user
database was accessed.

## Exact release storage identity

| Storage tree | SHA256 |
| --- | --- |
| Federated account identity 0630 | `677d1908068c46c5d23aa2bd2018fc906c133e7b16a3f1878b5a967350703b65` |
| Membership vouchers 0640 | `2110b33f141d037084bf093bc663b0f228965cf9f25c91d668a8c8deba103e86` |

These use the release manifest's canonical relative migration/retrieval paths,
per-file SHA256, sorted JSON and final SHA256. Only this exact 0630-to-0640
edge is added to `reviewed_forward_only_migration_transitions`. Historical
fingerprint tests exclude 0640 when reconstructing their previous endpoints;
all previously reviewed edges and their safety assertions remain in place.

The new review does not permit skipping 0630, reversing this transition,
unknown endpoints, or changed bytes in any migration or the retrieval adapter.
It does not approve an earlier transition on its own. The generic rollback
controller, `reviewed_migration_transitions` and empty rollback-compatible tree
list remain unchanged. This is not authorization to upgrade an arbitrary older
live tree directly to 0640.

## Schema and compatibility contract

0640 performs exactly three SQLite `ADD COLUMN` operations:

- `credit_redemption_codes.plan_id`: nullable `VARCHAR(64)`, no default.
- `credit_redemption_codes.action`: non-null `VARCHAR(24)`, server default
  `bank_reset`.
- `subscriptions.current_period_start`: nullable `DATETIME`, no default.

Every existing code, including unused, expired and redeemed codes, keeps its
original ID, hash, batch, owner, expiry and redemption evidence. All existing
codes read as `plan_id=NULL, action='bank_reset'`; no old code is converted to a
paid membership or made redeemable again. Every existing subscription retains
its provider/customer IDs, owner, plan, status, period end, cancellation flag
and creation time, with `current_period_start=NULL`. The migration does not
invent a subscription start, normalize old plan IDs, change an existing window,
activate a quota epoch or grant points.

Existing columns, checks, foreign keys, indexes and triggers are retained.
There is no table reconstruction, data rewrite or old-row deletion. Application
redemption, 28-day window selection and paid quota rules require separate
business tests. Additive storage alone does not establish old-writer safety:
old code cannot be assumed to interpret new voucher actions or queued
subscription windows, so this release remains forward-only.

## Transactions and failure boundaries

The migration accepts only an online SQLite connection. It enters Alembic's
autocommit boundary, opens an explicit `BEGIN IMMEDIATE`, adds all three columns,
then requires empty `PRAGMA foreign_key_check` and `PRAGMA integrity_check='ok'`
before explicit COMMIT. A pre-commit failure rolls back the complete DDL
transaction. Foreign keys remain enabled throughout the normal release path.
Offline range rendering fails before any unverified DDL is emitted.

The Alembic version update happens after this explicit transaction. Failure to
stamp therefore can leave all 0640 columns committed while `alembic_version`
still says 0630. A blind retry then fails on the existing `plan_id` column;
the migration intentionally has no guessed-column/idempotency repair path.
Do not stamp manually, retry the same failed candidate, downgrade it, or start
an old application against it. Preserve diagnostics, discard the unused failed
candidate and create another candidate from the untouched, verified source
backup. Restoration writes to a new database target only.

The existing updater's boundaries are unchanged:

1. Before candidate API start, a failed candidate migration returns to the
   untouched old database and original services. Partial/committed failed DDL
   affects only the separate candidate copy.
2. After the durable candidate-start boundary, accepted/background writes are
   retained. An unhealthy candidate is stopped for forward repair; the updater
   never runs the old application on the used candidate database.
3. If only public-edge acceptance fails after local acceptance, the candidate
   stays running and its data stays retained.

The release controller's existing synthetic tests continue to cover these
boundaries, unknown edges failing before service stop, and accepted writes
surviving post-start failure. No controller or retry authority was broadened.

## Synthetic retention and interruption evidence

`backend/tests/test_membership_voucher_migration.py` runs the complete real
migration chain to 0630 and writes fixtures through historical SQL, never
current-head model inserts. It covers:

- Local-password and federated identities, live session credentials and owned
  conversations, including Unicode and embedded-NUL text.
- Accepted and queued imports and six binary attachments with exact original
  bytes, ownership and document links.
- Unused, redeemed and expired old codes, plus their original redemption and
  signup ledger, activated/settled/reset quota epochs, precision carry and reset
  adjustments, and a settled billing operation's original price/evidence.
- Active, trialing and canceled subscriptions; nullable and explicit old period
  ends; checkout reservations; webhook replay IDs; custom index and trigger.

Snapshots compare every old table row and all unrelated schema entries. A
second comparison uses each old column's SQLite storage type and complete
`hex(CAST(value AS BLOB))`, retaining text/blob bytes including NULs. This is
cell-byte preservation, not a claim that the whole SQLite file is unchanged:
new schema/version pages necessarily change. The source database is separately
checked unchanged, and inherited sessions authenticate through the current
identity service after the upgrade. Existing code-pair, hash/batch uniqueness,
owner foreign keys and new non-null action constraints are enforced on the
upgraded database. A post-upgrade historical-form insert receives the intended
server default.

Seven exception injection stages cover before/after ADD COLUMN, both validation
queries and pre-COMMIT. Each restores the full old schema and data. Three
separate subprocesses exit immediately after each ADD COLUMN; reopening their
files recovers the complete old transaction. An invalid existing foreign key
and an injected non-ok integrity result each reject and roll back all added
columns. Stamp failure is separately checked to retain committed new columns
with the old version, reject in-place retry, and recover using a fresh source
copy. A fresh empty database reaches exactly one head, 0640.

Historical OAuth and federated-account tests still run all their existing
preservation, interruption and retention assertions. Their quota fixtures now
use fixed historical SQL (`seed_quota_history`) rather than invoking the current
runtime against a schema missing its newly required columns. This does not add
runtime column guessing or relax any old release gate.

## Verification

From `backend` (using the project's installed test environment):

```sh
PYTHONPATH=src python -m pytest tests/test_membership_voucher_migration.py tests/test_oauth_forward_migration.py tests/test_federated_account_migration.py tests/test_oauth_migration.py tests/test_account_management_migration.py tests/billing/test_billing_migration.py
python -m ruff check migrations/versions/20261005_0640_membership_vouchers.py tests/test_membership_voucher_migration.py tests/oauth_legacy_migration_support.py tests/test_oauth_forward_migration.py tests/test_federated_account_migration.py
```

From the repository root, with the same environment:

```sh
python -m pytest ops/tests
```

Results on this reviewed candidate: 44 backend migration checks passed (including
17 membership checks), all 202 ops checks passed, and the focused Ruff check
passed. Existing account-management coverage emitted eight Python 3.12 SQLite
datetime-adapter deprecation warnings.

These are source, schema, preservation and release-controller checks with
synthetic data. They do not claim production deployment, real payment/provider
acceptance or end-to-end browser verification. The pre-existing full-head
offline-rendering limitation at historical migration 0440 is unchanged; the
focused 0640 offline-range test fails closed deliberately.
