# Current-run deployment on the existing Everplain host

This route reuses the established Actions SSH identity, `ubuntu` account, pinned
host fingerprint, existing containers and `/srv/everplain-updates`. It creates no
account, SSH key, installed controller, sudo grant or network. `transport.sh` and
its separate `/srv/everplain` controller are not prerequisites for this route.

## Normal release

A main push runs CI and the immutable build in parallel. Deployment requires both.
The deploy job downloads only its own run/attempt artifact and compares its SHA256
with the build output. The manifest must identify this repository, commit, main
workflow, run and attempt. The client and host both check it. Images retain their
archive/config/store identity checks. No arbitrary artifact URL/ref is accepted.

The existing SSH host fingerprint is verified before authentication. The same
key is used without generating or widening access. One Actions concurrency group
and `/run/lock/everplain-release.lock` serialize updates and repairs. Old fixed
artifact references are removed, including the upload helpers. Resumption only
uses matching prefixes and matching multipart plans; a different artifact's
abandoned files are left in place and skipped.

## First deployment only: bind the reviewed live source

The existing production-inspection workflow now streams `release_identity.py
inspect` over the already authorized, pinned SSH path. It installs no helper on
the host. Its output between `EVERPLAIN_RUNTIME_FINGERPRINT_BEGIN` and
`EVERPLAIN_RUNTIME_FINGERPRINT_END` is the initial-baseline JSON. The inspector
shares the production concurrency group so it does not race normal releases.
Run this inspection before binding the first release baseline. It emits
only image IDs and hashes of source, installed dependency bytes (including added
files), migration source, packaged ops files, tokenizer cache and Web files. It
does not import the application, read environment values, open a database or
make provider calls. The helper must be present in that existing temporary
review/upload directory; no permanent installation is needed.

Review the result against the preserved current production source and build
receipts, then save that exact JSON as `ops/cd/live-baseline.json` in the source PR.
Do not generate guessed values or automatically bless an unknown live overlay.
The packaging step embeds it into the checksum-bound manifest. Without a genuine
initial baseline the first deploy fails before image loading or service stop.

The reconstructed pre-writing/pre-search-billing application package is 286
regular files with source-tree fingerprint
`a8f7bf11f6ab1f041085fa96cbcefb2574ca0e65ba9143294c1cb2a3c1f02092`.
This is a comparison aid, not a substitute for actual live inspection. Subsequent
writing/search code changes naturally have a different candidate fingerprint.

After a successful release, the host atomically records a private root-owned
`pipeline-state.json` with the actual runtime fingerprints, source SHA, archive
SHA and run ID. Later releases use that state automatically. Stale runs, changed
replays, source/dependency/tokenizer/Web overlays and unknown image changes are
rejected before stopping services. Fingerprints are rechecked just before cutover.
A later manual production hotfix must be reconciled explicitly; do not remove the
guard or delete state to force a release.

## Data, configuration and failure behavior

All current API environment values are preserved. Only release revision and the
existing managed-migration marker change. Private values stay on the host and
never enter job output. The existing stopped-writer snapshot, owner/mode
preservation, new-data-target migration, exact container/port/network limits,
local/public health and entrypoint-byte checks are retained. A schema/storage-tree
change requires the existing reviewed compatibility allowlist; unchanged schema
passes without an extra migration authorization shortcut.

An exact `reviewed_forward_only_migration_transitions` entry may authorize this
route's maintenance transition when old application writes are incompatible.
Only this updater consumes it; the rollback-capable controller rejects it. Its
candidate-start retention boundary remains mandatory. The quota 0600 transition
and synthetic two-version evidence are reviewed in [QUOTA_0600_REVIEW.md](QUOTA_0600_REVIEW.md).
This is not permission to restart the old application on a used candidate DB.
The exact 0600-to-0610 transition uses the same forward-only boundary; its
old-writer and pricing-policy evidence is in [JOURNAL_0610_REVIEW.md](JOURNAL_0610_REVIEW.md).

Failures before candidate API start restore the untouched old containers/data.
After candidate API start, accepted/background writes are retained; the existing
conservative forward-stop behavior remains. This is not a claim of completed
post-start automatic rollback. The incompatible controller `rollback-previous`
workflow entrypoint is removed rather than advertised as working on this layout.
Any recovery must use the recorded existing-container transaction and retain
accepted data, with its own applicable authorization and verification.

## Verification boundary

The local implementation is offline-tested. A Linux Docker CI build and one
controlled real deployment with current-source/environment/data checks remain
required before calling automatic deployment operational. No actual baseline,
production request, environment mutation, service restart or paid call is supplied
by the implementation package. Build/check parallelism removes the observed
serial build delay; an under-ten-minute ordinary release is a target, not a
performance guarantee. This route still transfers immutable API/Web image
artifacts; component-only transfer is a separate optimization.
