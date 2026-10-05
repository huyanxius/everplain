# 0615 to 0620 OAuth forward-only release review

Reviewed 0615 predecessor: `671b5c2045759ace0c366281dd834bdd5bba786e`.
Reviewed OAuth source: `a36bdc9dce8b752d18c100a27b5a6503890c1dab`.
All verification uses synthetic local SQLite rows, local mock runtime and explicit
DDL interruptions. No production data, credentials, real provider request or
production deployment was used.

## Exact storage identities

Release packaging hashes the Python migration sources and retrieval schema
adapter, with its canonical relative paths, sorted JSON and SHA256. The actual
0615 predecessor was also read directly from Git; its fingerprint matches the
candidate with only the new 0620 migration excluded.

| Storage tree | SHA256 |
| --- | --- |
| Existing import receipts/attachments 0615 | `2ddaa00235b10b91873a22cc9e7e761301c957296bb4c719740607b4ed2cd228` |
| Candidate OAuth 0620 | `1f4abbe6fa943bb3b94bc7b57f189c40028b19e416a15c4f83e389dd29faf8d8` |

OAuth adapter/application code is outside this storage fingerprint. Any later
change to a migration source or retrieval schema adapter requires recalculation
and a new review. Removing both 0615 and 0620 before reconstructing the older
0600/0610 review trees reproduces the existing historical fingerprints; do not
add contaminated fixture hashes to policy.

## Forward preservation and constraints

`backend/tests/test_oauth_forward_migration.py` creates a file database through
the complete real migration chain to 0615, then registers one synthetic user,
imports a completed note with two binary attachments, leaves another note and
attachment queued, and activates/settles/resets quota to epoch 2. It upgrades a
separate consistent SQLite backup with the actual 0620 migration.

The comparison preserves all 125 existing tables and 224 named schema entries;
only `alembic_version` advances. Password hash, active session, original 30-point
signup grant, epoch history, precision/reset audit, request receipts, import
items/sources/documents and three binary attachments remain unchanged. Only the
empty `federated_identities` and `oauth_transactions` tables and their indexes
are added. The existing password verifies, the old session authenticates and
completed binary assets remain readable. The queued item remains queued.

The graph has one 0620 head directly after 0615. Repeated successful upgrade is a
no-op. Downgrade to 0615 raises before modifying data or schema. Identity tests
verify provider/subject uniqueness, one identity per owner/provider, provider
allowlist and owner foreign keys.

These are forward schema/data and existing-auth results. They do not prove that
an old application can retain usable OAuth-only accounts or OAuth state after
candidate writes. This transition is deliberately not approved for the generic
rollback-capable controller or `reviewed_migration_transitions`.

## Interrupted migration and release retention

SQLite currently uses non-transactional DDL. Tests interrupt before the first
table, before each subsequent table/index and before the version stamp. All old
rows and old schema entries survive, and the untouched 0615 source backup stays
unchanged. After an interruption past the first CREATE, partial OAuth DDL remains
while `alembic_version` is still 0615. Repeating upgrade on that same candidate
fails with `federated_identities already exists`; it is not an atomic rollback or
safe in-place retry. Creating another fresh copy of the untouched 0615 backup and
running upgrade succeeds at every tested interruption boundary.

The existing `deploy-existing.py` route already migrates a fresh copied data
path, records candidate start before starting its API and retains candidate data
from that boundary. Before candidate API start, failed migration returns to the
untouched old containers/data. After start, an unhealthy candidate is stopped
and requires forward repair; the old application is never run on the used
candidate database and accepted/background writes are retained. A locally
accepted candidate remains running when only public edge acceptance fails.
Existing offline updater tests cover these retention boundaries. No controller
behavior or retry/rollback permission is expanded by this review.

Policy therefore registers only the exact 0615-to-0620 pair in
`reviewed_forward_only_migration_transitions`. The existing-account updater may
consume that edge; the generic rollback controller continues rejecting it. The
reverse direction, changed migration bytes, unknown endpoints and a direct
0610-to-0620 release remain blocked. This review does not approve 0610-to-0615;
that predecessor transition needs its own separate evidence and policy review.

## Repeat the offline verification

From `backend`:

```sh
PYTHONPATH=src uv run pytest tests/test_oauth_forward_migration.py tests/test_oauth_migration.py tests/test_incremental_import_migration.py tests/test_oauth_login.py::test_account_identity_and_grant_roll_back_together_on_failure
uv run ruff check tests/test_oauth_forward_migration.py
```

From the repository root:

```sh
python -m pytest ops/tests
```

The companion gate tests bind the shipped review to the exact current storage
bytes, retain the existing historical assertions and reject bypass/rollback
paths. This evidence is offline source/test verification, not live provider,
browser or production acceptance.
