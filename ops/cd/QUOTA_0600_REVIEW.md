# 0600 quota migration release review

Reviewed baseline: `7f1d89a79caf487c5730a1e760b6b760c6a8f6b1`.
Candidate reviewed: `402a03c3038f37fef75d797826ab8c5d87767338`.
All experiments use synthetic SQLite rows and tokens. No production database,
user record, credential, network request or model call is used.

## Exact storage identities

The manifest hashes Python migration sources plus the retrieval schema adapter,
using the same relative paths, JSON serialization and SHA256 as release packaging.

| Storage tree | SHA256 |
| --- | --- |
| Published 7f / writing scope 0580 | `1727232ab89e84ccbd00aaad2c7aa600e818bdc4d9f3b19d74c9326601f02a54` |
| Candidate with quota 0600 | `3203ce3aa7e4e38c2ec9d55ddccc48d830b0707261a2abb1b564df6d9f79f40e` |

Removing 0600 before reconstructing the historical predecessors reproduces the
five existing exact review edges. The failing `cab1ecd… -> 7b9813…` pair was a
fixture artifact: both historical trees accidentally contained the new 0600 file.
It is not a real released transition and must not be added to policy.

## Old application writes are incompatible

The baseline's exact `durable_billing.py` and candidate runtime were exercised
against the same synthetic database. The old billing schema was created first;
the real 0600 `upgrade()` then added its columns, quota history and audit table.
The unchanged pricing module priced 600 synthetic input tokens at six points.

1. Activate the candidate's Free30 period. Run a baseline operation with six
   confirmed points. Account balance becomes 24 and account precision becomes
   `6000000000000`; the current period still says 30 and `0`. Run another six-point
   candidate operation. The account remains 24 instead of the required 18, and
   precision remains `6000000000000` instead of `12000000000000`. The candidate
   settles from the stale period and overwrites the old application's debit.
2. Pause a baseline operation after six points, then use the candidate's bank
   RESET. The closed legacy epoch keeps balance 24 and precision `6000000000000`;
   the new epoch has 30 and `0`. Cancel the paused operation through the baseline
   runtime. Its refund changes the current account to 36 and precision to
   `-6000000000000`, leaving both period rows untouched. The refund crosses the
   reset boundary and cannot be repaired by merely synchronizing a balance mirror.

This is semantic incompatibility despite additive DDL. Do not put the 7f-to-0600
edge in `reviewed_migration_transitions` or `rollback_compatible_migration_trees`.
The 0600 downgrade prohibition and existing reset fences remain necessary.

To repeat the two-version experiment in this candidate checkout:

```sh
git show 7f1d89a79caf487c5730a1e760b6b760c6a8f6b1:backend/src/qunxue_api/adapters/sqlite/durable_billing.py > /tmp/everplain-durable-7f.py
cd backend
PYTHONPATH=src uv run python ../ops/cd/review_quota_rollback.py --previous-durable /tmp/everplain-durable-7f.py
```

The script verifies the baseline source SHA256
`8760b4a3bb3dd199480e451ae105050ca1e12d1614e0893491c2dc50d7da5b4c`
before loading it, creates isolated temporary synthetic databases, applies the
real migration, and prints the before/after evidence with `compatible: false`.
The pricing module is byte-identical between the reviewed app revisions.

## Existing release route and maintenance boundary

`deploy-existing.py` already restores the untouched old containers and old data
when a failure occurs before candidate API start. Once candidate API start has
been recorded, it never starts the old application on the candidate database.
It preserves candidate writes, stops an unhealthy candidate, and requires a
forward repair. A candidate that passed local acceptance stays running when only
public edge acceptance fails. These boundaries have existing offline tests.

The current gate calls the separate controller's rollback-compatibility check,
which cannot approve this transition truthfully. A safe maintenance release must
bind this exact old/new storage pair specifically to the existing route's
forward-stop semantics. The separate rollback-capable controller must continue
rejecting it. If a candidate fails after start, keep its data and financial audit
evidence; repair with an epoch-aware candidate on a fresh copy. Never run 7f on
the migrated, used database, downgrade 0600, or restore over accepted writes.

Such a forward-only maintenance authorization needs an explicit operator/user
decision before policy enables it. Alternatively, first publish a genuinely
epoch-aware compatibility bridge on the old storage tree and prove both versions
against the migration, including closed-epoch refunds. Neither choice can be
replaced by adding a hash to the rollback allowlist.
