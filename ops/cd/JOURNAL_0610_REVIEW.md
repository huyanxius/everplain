# 0610 output journal release review

Candidate runtime reviewed: `c45317ad4e7108c081dc0b1b9499156ba64967cd`.
Previous 0600 application: `1d4943b3eea76619b90f68a5a15bb530d3b16979`.
All evidence uses synthetic rows, mock usage and isolated SQLite. No production
data, credentials or paid provider calls were used.

| Storage tree | Exact SHA256 |
| --- | --- |
| 0600 | `3203ce3aa7e4e38c2ec9d55ddccc48d830b0707261a2abb1b564df6d9f79f40e` |
| 0610 | `5804df17b2d190d615497be9dd027f4747c4320836942c6eeefd9ce0110bbe40` |

These fingerprints use the artifact's migration-source/retrieval-adapter paths
and canonical JSON hashing. Historical review trees exclude both 0610 and 0600
before reconstructing the earlier exact review edges.

## DDL and old writers

0610 adds `agent_runs.last_event_sequence INTEGER NOT NULL DEFAULT 0`, output
attempts and output events. Existing fields remain. The real old 0600 ORM can
read/update existing runs and acquire a new lease on this schema; the default
allows old inserts. This additive SQL compatibility does not prove compatible
application behavior or retention of accepted writes after rollback.

Two versions were exercised against one database built by the complete migration
chain to 0600, seeded with a synthetic user/account, then upgraded by the actual
0610 migration:

1. The candidate billing runtime opens `actual_usage_v2`, receives known 600-token
   usage with an explicit synthetic tariff, and pauses after charging six points.
   Balance is 24. The exact old 0600 `DurableBilling.finish(cancelled)` reads that
   same operation, recognizes only `actual_usage_v1`, follows the legacy delivery
   refund path, changes the operation to refunded, and restores balance to 30.
   Shared precision becomes zero. Known v2 consumption is incorrectly refunded.
2. The candidate repository saves `candidate original body` in an output attempt,
   then marks the run interrupted. A separate process imports the real old 0600
   repository and ORM, claims a new lease and checkpoints
   `body accepted during old0600 rollback`. That body is initially present in
   `agent_runs.partial_answer`, but the old app does not update the existing
   journal. Returning to the candidate, starting another continuation and saving
   `new continuation body` leaves only the candidate's original and continuation
   attempts. The body accepted by the old app is no longer in the run or journal.
   Candidate legacy backfill only runs when the run has no output attempts.

The old runtime sources used have these SHA256 identities:

- `durable_billing.py`: `466a3d63fce9f67138a44d6cc589219a91a6cced6bc016b9c3b2b492c0280b0f`
- `agent_conversation_repository.py`: `bb8fff939b433eae7b75b60a73be7cac1e36025a36c9e09b3f8696ebfa4653a8`

Pricing is byte-identical between the two source revisions. The synthetic
financial result comes from the previous implementation's policy branch, not a
changed tariff or an estimated provider cost. The old repository process uses its
own `backend/src` and old mapped model, not the candidate ORM.

## Exact forward-only authorization

This transition therefore remains outside `reviewed_migration_transitions` and
the rollback-controller allowlist. It is approved only as the exact second edge
in `reviewed_forward_only_migration_transitions`, consumed by `deploy-existing.py`.
It cannot skip the separately reviewed 0600 edge, reverse direction, bless a
changed migration file or use a wildcard.

The existing release retention boundary is unchanged: before candidate API start,
failure restores untouched old data/containers. After candidate API start, retain
candidate writes and repair forward; never start the old app on the used candidate
database. An unhealthy candidate is stopped; a candidate that passed local
acceptance remains running if only the public edge fails. Existing updater tests
cover these boundaries, accepted/background writes and the durable start journal.
0600 financial and 0610 output archive downgrade prohibitions remain unchanged.

No compatibility bridge or lifecycle/billing behavior was added for this review.
CI verification is performed from `backend` using its configured Ruff paths and
all ops tests. This evidence does not claim a production deploy, real model run
or browser acceptance.
