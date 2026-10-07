# D02 query-only retrieval storage compatibility review

This is an exact storage-compatibility review for issue 265 / PR266. It does not
change the deployment gate, migrations, query implementation, or any previous
review. The D02 query candidate remains frozen: sqlite_index.py SHA256
`69163cb24b5f83cc550beebcaaf7516861a61c6d108b6a0965d03481364a5ec9`.

## Exact endpoints and historical identities

The release migration fingerprint includes all Python migration files and the
entire retrieval adapter under `schema/sqlite_index.py`, even when only its
query implementation changes. The old adapter SHA256 is
`d45eafd7c931a47a9c8f6731d563c8030202abf0f135390a978b8c919b36dcc3`
(Git blob `a05f65c89ad62b45f8287f530f4454fc3e51ab50`). Its source and the unchanged
migration files were taken from Git tree
`b144e2228a67b380c1037d327e50e42f91c0cdc9`.

- Previous membership-0640 storage tree:
  `2110b33f141d037084bf093bc663b0f228965cf9f25c91d668a8c8deba103e86`
- D02 storage tree:
  `28146d4e4db089ae8aeaf0cc59462bbf393cbb3ea19a07edfdbb8ea7b5af72d2`

Only this exact forward edge is appended to `reviewed_migration_transitions`.
The broad rollback-compatible-tree list stays empty. Every existing rollback
review and all six historical forward-only edges remain byte-for-byte equal.
The new edge neither allows an earlier migration head to skip boundaries nor
adds a reverse release/deployment edge. The existing rollback controller already
checks the current release's predecessor-to-current compatibility declaration
before running the recorded previous application on the retained database;
that gate and its data-retention behavior are unchanged.

The historical tests previously reconstructed old endpoints using current
retrieval-adapter bytes. That accidentally assigned D02 query code to historical
quota, journal, import, OAuth, federated-account and membership releases. The
historical fixtures now pin the actual pre-D02 adapter digest. All their old
migration, no-skip, no-reverse, mutation and forward-only assertions remain.
A separate current-tree guard computes the real current file bytes and complete
migration fingerprint, checks this receipt and the exact new edge, and proves
that removing the edge or changing any migration/adapter byte is rejected.
There is no global canonicalization or exemption in runtime fingerprinting.

## What was actually verified

`review_vector_storage.py` accepts an explicit previous source root. It rejects
any previous/current adapter or storage endpoint other than those above before
executing the synthetic review. `VECTOR_D02_STORAGE_REVIEW.json` records the
actual deterministic result, every migration-file digest, unchanged source
component digests, schema digest, and row snapshots' digests.

All 70 Python migration files are identical. Exact source segments for
`_initialize_schema`, `_connect`, `rebuild`, `_pack_vector`, `_build_manifest`,
manifest/chunk classes and readers are unchanged. Only `search`,
`_unpack_vector`, `_cosine_similarity` change and `_unit_vector` is added.
Little-endian float32 packing is identical for ordinary values, signed zero,
large finite and subnormal storage values.

Two independently loaded real versions use the same temporary SQLite file:

1. The old version creates a ready release with three points, Unicode and
   embedded-NUL text/source IDs, a zero vector, and explicit content identities.
2. The new version opens that file, reads the exact old manifest/chunks, and
   searches it. Rebuilding the ready identity with jittered vectors preserves
   every existing row and vector byte. The new version adds a second release.
3. The old version is instantiated again on the database already used and
   written by the new version. It reads both releases, preserves the newer
   ready release on repeated rebuild, and adds a third release.
4. The new version opens the rollback-written database and reads all three
   releases. Every previously accepted row and cell type/text/blob byte remains.

The final state has three indexes and nine points. `sqlite_master`, table/index/
foreign-key PRAGMAs, `integrity_check` and `foreign_key_check` are checked across
all stages. Readers and existing-ready rebuilds do not alter the snapshots.
No database migration or downgrade is needed for this adapter-only change.

This proves storage/read-write compatibility, not that old code acquires D02's
new invalid-input defenses. Old code retains its former numeric-query behavior.
The evidence does not expand historical migration rollback permissions, retry
failed DDL, change model/retrieval strategy, or claim real-model/production
acceptance.

## Reproduce offline

With the installed project Python environment, from the repository root:

```sh
python ops/cd/review_vector_storage.py --previous-root /path/to/exact/pre-D02/source
```

Use a clean environment, synthetic/mock settings and the established outbound
network guard. The script imports only standard-library modules and the two
standalone retrieval adapters; it creates and removes its own temporary SQLite
file. It does not load application configuration or access an existing database.

The affected release tests are `ops/tests/test_cd.py` and
`ops/tests/test_existing_release.py`; the actual CI command remains
`python -m unittest discover -s ../ops/tests -v` from `backend`. The current-byte
and exact-edge negative assertions are part of those existing test files.
The prior 90 query regressions and independent 40 query checks are separate
from this storage review and are not reused as evidence of rollback safety.
