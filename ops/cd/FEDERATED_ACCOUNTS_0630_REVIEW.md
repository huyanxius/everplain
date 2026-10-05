# 0620 to 0630 federated account forward-only review

Public source baseline: `4f2d580f3ac752303dee19d8c4400616069872cf`.
The complete 0620 migration sources and retrieval schema adapter were read from
that immutable Git object and match the candidate with only 0630 excluded.
Verification uses synthetic file-backed SQLite databases, local mock runtime and
explicit failures/process exit. No real account, secret, provider or production
system was accessed.

## Exact storage identity and release scope

| Storage tree | SHA256 |
| --- | --- |
| Existing federated login 0620 | `1f4abbe6fa943bb3b94bc7b57f189c40028b19e416a15c4f83e389dd29faf8d8` |
| Federated account identity 0630 | `677d1908068c46c5d23aa2bd2018fc906c133e7b16a3f1878b5a967350703b65` |

Fingerprints use the release manifest's canonical relative migration/retrieval
paths, sorted JSON and SHA256. Historical review tests exclude 0630 before
reconstructing their earlier exact endpoints. No previous authorization is
rewritten and no contaminated historical fingerprint is approved.

Only this exact 0620-to-0630 pair is added to
`reviewed_forward_only_migration_transitions`. Changed migration bytes, reverse
migration, unknown endpoints and skipped earlier edges remain blocked. The
generic rollback controller and `reviewed_migration_transitions` do not approve
this edge. No controller, retention boundary or retry/rollback authority changes.

## Schema and migration rules

`users.email` becomes nullable and retains uniqueness. `users.login_mode` is a
non-null string defaulting to `email_password`, with explicit mode/credential
checks. `federated_identities.verified_email` is nullable contact information.
Provider/subject identity and user ownership never derive from that email.

An old account converts to `federated`, with `email=NULL`, only if its hash is
exactly `!oauth-only` and it has an existing real subject-bound identity. User ID,
password hash and all other existing user values remain unchanged. Only the
original signup identity, whose `created_at` equals the old user's `created_at`,
receives the old contact email. Later explicit provider bindings do not inherit
another provider's verified contact email. Existing password accounts and their
explicit bindings remain untouched, apart from the new default login mode.

An orphan sentinel account with no real identity is not inferred to be a
provider account. Its old email/hash/ownership and default mode are retained;
no identity, verified contact or fake email is invented. The sentinel still
cannot authenticate by email/password or be enabled by password reset; the
application must keep that safety fence until an operator verifies ownership.
The migration does not merge accounts, enable local login or alter reset tokens.

## Users reconstruction without cascades

SQLite's normal Alembic DDL is non-transactional, and rebuilding `users` with
foreign keys enabled can delete cascading child data. This migration requires an
online SQLite connection so it can reflect the real old columns, indexes and
constraints, including historical named role/status/version checks when present.
Offline SQL generation is deliberately rejected before unverified rebuilding SQL
is emitted. No fixed incomplete table definition is used.

The online migration:

1. Enters Alembic's autocommit boundary and verifies foreign keys are ON, the old
   database passes foreign-key/integrity checks and there are no unreviewed
   `users` triggers that a table copy would discard.
2. Disables foreign keys and confirms OFF before opening an explicit
   `BEGIN IMMEDIATE` SQLite transaction.
3. Adds/backfills provider contact email, rebuilds users with reflected old
   schema plus the required new login fields/checks, and converts only qualifying
   subject-bound sentinel accounts.
4. Confirms identical user IDs and validates foreign keys/integrity before an
   explicit COMMIT. Any pre-commit exception rolls back that DDL transaction.
5. Restores foreign keys ON in `finally` and verifies restoration.

## Real data and interrupted-operation evidence

`backend/tests/test_federated_account_migration.py` builds the complete real chain
to 0620, then writes rows through the public baseline's historical SQL contracts.
It covers password, linked-password, multi-provider OAuth-only and orphan
sentinel users; four active sessions; original 30-point grants; accepted and
queued imports; twelve binary attachments; owned conversations/messages; and
activated/settled/reset quota history. All unrelated table rows and schema
entries remain exactly equal. The old source database stays untouched. Current
identity services authenticate the inherited sessions after the real 0630
upgrade. Named old user checks are also exercised on an actual SQLite variant
and survive reflection/reconstruction.

The tests interrupt nine real SQL stages inside the explicit reconstruction
transaction, including after the old users table has been dropped but before it
is renamed. Each restores the exact old schema/data and verifies foreign keys
ON. A separate process exits immediately after DROP users; opening the file
again recovers the SQLite transaction with all users and cascading data intact.
Unreviewed users triggers fail before any schema change.

The separate Alembic version stamp occurs after the reconstruction transaction.
A failure there leaves committed 0630 schema/data with version still 0620.
Retrying that same candidate fails on the existing `verified_email` column.
This is not an authorized in-place retry, atomic whole-Alembic rollback or old
application rollback. Failed candidates are discarded before API start and a
fresh untouched-source copy is used for another attempt.

The existing updater already migrates a fresh candidate copy before API start.
Pre-start failure restores untouched old data/services. After the durable
candidate-start boundary, accepted/background writes are retained and an
unhealthy candidate is stopped for forward repair; the old app is never started
on the used candidate database. A locally accepted candidate remains running if
only public edge acceptance fails. Existing offline updater tests retain these
boundaries. New nullable account emails and separate login modes require this
forward-only release path; old-writer compatibility is not claimed.

## Verification

From `backend`:

```sh
PYTHONPATH=src uv run pytest tests/test_oauth_migration.py tests/test_oauth_forward_migration.py tests/test_federated_account_migration.py tests/test_account_management_migration.py tests/billing/test_billing_migration.py
uv run ruff check migrations/versions/20261005_0630_federated_accounts.py tests/oauth_legacy_migration_support.py tests/test_oauth_migration.py tests/test_oauth_forward_migration.py tests/test_federated_account_migration.py
```

From the repository root:

```sh
python -m pytest ops/tests
```

The old full-head offline-rendering test already fails at the historical 0440
migration because its document batch operation requires live reflection. That
pre-existing limitation is not repaired or hidden by this change. The focused
0630 offline-range test proves the new migration explicitly fails closed.

These checks establish source/schema/retention behavior with synthetic data.
They do not claim real provider, browser, production deployment or payment
acceptance.
