# 0615 import attachment release review

Candidate runtime reviewed: `671b5c2045759ace0c366281dd834bdd5bba786e` (PR #197).
Previous published 0610 application: `c2cada58ee531859c60bc2c3a0e855dfc8dc98ba`.
All evidence uses synthetic notes, attachments and isolated SQLite. No production
records, credentials, live deletion or paid provider calls were used.

| Storage tree | Exact SHA256 |
| --- | --- |
| 0610 | `5804df17b2d190d615497be9dd027f4747c4320836942c6eeefd9ce0110bbe40` |
| 0615 | `2ddaa00235b10b91873a22cc9e7e761301c957296bb4c719740607b4ed2cd228` |

These fingerprints use the artifact's migration-source/retrieval-adapter paths
and canonical JSON hashing. The sole storage-source addition is
`migrations/versions/20261005_0615_incremental_import_attachments.py`, SHA256
`7d8a556494734be3d0b9d42b9e50eb224c63bd10a9de9c3ca644a3c3909abe41`.
The historical review fixtures exclude this known later revision before
reconstructing 0610, 0600 and prior edges. Unknown future storage changes still
fail their exact policy binding; no historical migration or retrieval adapter is
rewritten by this review.

## DDL and incompatible old erasure

0615 adds nullable request/fingerprint columns to `import_batches`, an exact
owner/request-key unique index, and `import_attachments`. Existing batch rows,
queued content, source identities and original documents remain in place.
`test_import_upgrade_preserves_legacy_batches_items_sources_and_documents`
exercises the real 0610-to-0615 migration, checks complete legacy rows, queued
bytes, nullable defaults and `PRAGMA foreign_key_check`. Candidate tests also
cover owner-only assets, account export, owner erasure and other-owner retention.

Additive DDL alone does not establish behavioral rollback compatibility. This
review also exercised the actual old application source in a separate Python
process against a database created by the complete migration chain to 0610,
then upgraded by the real 0615 migration:

1. The candidate imports one synthetic Markdown note and its referenced 35-byte
   binary image. The document is ready and the attachment is retained.
2. A separate process uses the exact old published `backend/src` from `c2cada58`,
   not the candidate ORM. Its `SqliteSharedKnowledgeRepository.documents()` reads
   the ready document on the new schema.
3. The old repository's `detach()` path clears the original source to zero bytes,
   erases segments and keeps the shared-document idempotency tombstone. It never
   deletes `import_attachments`, which the old application does not know about.
4. The attachment remains 35 bytes after old deletion. The document is not
   deleted, so the new document foreign-key cascade cannot erase this content.
   The old app therefore cannot honor the candidate's complete erasure contract.
   The database still has no foreign-key violations.

The old `shared_knowledge.py` source SHA256 is
`a1ec03837353ebc965ed499822001d5ef45bc35cfcb78570308ad8731dbe6fdd`.
This is an actual two-version erasure result, not a claim that nullable columns
make rollback safe. No rollback-compatible migration tree or transition is added.

## Exact forward-only maintenance edge

The policy adds only the exact 0610-to-0615 edge to
`reviewed_forward_only_migration_transitions`, consumed by `deploy-existing.py`.
The rollback-capable controller and `check_compatible()` continue rejecting it.
The preceding 0600 and 0610 reviews remain unchanged. Tests explicitly reject
skipped predecessor boundaries, reverse direction and altered candidate hashes.
No wildcard, automatic head acceptance or compatibility bridge is introduced.

The existing release retention boundary is unchanged: before candidate API start,
failure restores untouched old data/containers. The durable candidate-start
journal precedes startup, which can already perform background writes. Once
that boundary is crossed, retain candidate writes and repair forward; never run
the old app on the migrated, used database, downgrade 0615 or restore over
accepted writes. Existing updater regressions cover these boundaries, background
and accepted writes, archive verification and the durable start journal.

The repair changes policy, this review and version-correct test reconstruction.
It does not change importer runtime, migrations, release-controller behavior,
model configuration or private live overlays. This evidence does not claim
successful production deployment, real browser acceptance or real model calls.

The exact failed CI run `37333087885` had already passed all 1,333 product
backend tests plus 11 subtests, frontend checks, contract checks and immutable
release packaging. Its only two failures were these storage-policy binding
tests. The repaired candidate passed all 194 offline ops tests and the real
two-version reproduction; the import/upgrade tests were rerun unchanged.

## Reproducing the two-version check

Materialize `backend/src` from the exact old published revision into a new
throwaway directory. Seed a synthetic user/note/attachment using the candidate
against an isolated DB upgraded through 0610 and 0615. Run the old repository
reader and `detach()` in a separate process with `PYTHONPATH` pointing only at
that old source, then inspect source/attachment byte counts and foreign keys.
The release recovery packet retains the executed evidence script and output.
