# Everplain production releases

Scope: `huyanxius/everplain` only. Issue [#31](https://github.com/huyanxius/everplain/issues/31).

This is a versioned release mechanism, not evidence that production is configured.
The earlier static-only handoff is historical and must not be used to describe current
production. Verify the current host revision, database schema, deployment layout and
runtime mode independently before a release. A reachable site or mock-mode API does not
prove a configured production deployment channel or working real model calls. These
scripts do not provision credentials or claim a real model/browser acceptance test.

## Normal release

1. PR: existing backend/frontend/contract checks plus offline release-safety tests and
   a real Linux Docker build of the immutable API/web artifact (including the clipper).
   No production environment, secrets, transport, deployment or `pull_request_target`
   execution. The validation artifact is not promoted; main builds its checked commit.
2. Merge to `main`: the same commit's reusable CI must pass. Build on a hosted Linux
   runner with the existing Dockerfiles, frozen application dependencies and official
   base-image digests resolved once per build. Save API/web images; activate by immutable
   image IDs, never by a mutable tag.
3. Upload one immutable artifact named by source SHA and attempt. It contains image
   archives, migration sources, reviewed migration policy and a manifest. The manifest
   records all file checksums, commit, image IDs, base digests, backend/frontend/clipper
   lockfile checksums and
   workflow run identity. This is traceable provenance over the trusted GitHub artifact
   and pinned SSH channel, not a claim of a cryptographically signed attestation or a
   bit-for-bit reproducible build. No paid registry or additional service is needed.
4. The `everplain-production` environment deploy job downloads only this run's artifact,
   checks its exact SHA-256 against the build job output, uploads it to the dedicated
   incoming directory and invokes a fixed, operator-installed controller. The workflow
   cannot supply a script, arbitrary ref, service name, directory or shell command.
   Missing deployment variables or secrets fail explicitly before any SSH connection;
   a successful build alone is never a successful deployment. There is no silent
   "deployment ready" switch that turns missing setup into a green release.
5. On the host, an independent filesystem lock serializes deploy and recovery. Older run
   IDs are rejected. Validate configured host identity, actual private environment,
   immutable artifact/image identity, migration policy, nginx configuration, available
   release-disk space and the existing local API/web revision before stopping anything.
6. Stop only `everplain-web` and `everplain-api`; SQLite has one writer. Use the existing
   `ops/database.py` Online Backup API for the primary database and a narrowly scoped
   SQLite Online Backup helper for the retrieval DB, then copy both snapshots to a NEW
   candidate data directory. Preserve committed WAL and each database’s UID/GID/mode.
   Unknown durable sibling files block deployment before downtime. Never copy a live `.db` file with `cp`/`copy2`.
7. Forward-migrate the candidate database in an isolated container. Atomically replace
   the release symlink, start API, verify its revision, then start web and verify both
   local and public API/web revisions plus exact index/entrypoint JS/CSS hashes from the
   built image. Checks reject redirects and use revision cache-busting. Persist the previous release and result.
   The expected model mode comes only from the protected, host-generated `runtime.env`:
   default `base`; `mock` only when the real business backend is configured with
   `EVERPLAIN_ALLOW_MODEL_FALLBACK=true` and no model API key. Missing, insecure, or
   full-mock backend configuration is rejected. An unexpected base-to-mock change still
   fails. Deployment/recovery results explicitly include `runtime_mode` and
   `providers: not_exercised`; model fallback does not become a real-model success.
   This check never changes the production environment to make a release pass.

Main protection/review rules are optional repository policy; the workflow does not alter
or require native GitHub branch protection. Follow the repository's PR/merge process.
GitHub concurrency has at most one pending run, so intermediate queued commits may be
superseded. This deploys the checked main snapshot, not every intermediate commit.

## Rollback and migration safety

- Every release is `/srv/everplain/releases/<full SHA>`. `current` is an atomic symlink;
  runtime environment is private host-generated metadata, never part of the artifact.
- Before any candidate API process starts, failed migration switches back to the untouched old DB,
  original app/config and metadata. Partial migrations affect only the candidate copy.
- Before starting the candidate API, record the retention boundary: its background jobs
  can already write or call providers while web is closed. From that point, including
  failed API health, automatic/manual rollback keeps the candidate/current DB
  and its accepted writes. Only app/config change; there is no `alembic downgrade` or
  restore over an active database. A checked backup remains available for an explicitly
  approved recovery into another new path.
- Changed migration files (including historical edits) or retrieval SQLite schema adapter
  change the storage tree fingerprint and
  block deployment before downtime by default. `policy.json` can explicitly list the
  previous migration-tree SHA-256 after code review proves the previous application can
  read/write the migrated schema. Empty list means unchanged schema only. An approved
  expansion must be transaction-safe and preserve old readers/writers, and should be
  tested with both app revisions. Destructive/contract migrations need a separate
  maintenance and backup/recovery plan; adding a hash does not make them safe.
- `EVERPLAIN_MIGRATIONS_MANAGED=1` is set only by this controller. API startup then skips
  implicit migration. That permits the old compatible app to run against a newer schema
  it cannot name in its old Alembic history. Existing Compose/manual startup retains its
  original preflight → migration behavior when this flag is absent.
- State separately records the database schema tree when code is rolled back. A later
  deployment must match that retained schema, or use an explicit maintenance plan.
- A durable private transaction journal precedes downtime. SIGINT/SIGTERM/SIGHUP attempts
  rollback, with subsequent catchable signals ignored during bounded recovery. Machine/power/process loss leaves the journal for bounded recovery; it is
  not reported as success. `workflow_dispatch` on main offers only `rollback-previous`,
  which first recovers any interrupted transaction, otherwise selects the recorded
  previous release. It cannot choose arbitrary SHA/DB/archive/host inputs. If rollback
  fails, ingress is stopped and evidence/data remain for the operator.
- Re-running only a failed deployment job can reuse its identical immutable artifact.
  Rebuilding a commit with different bytes is rejected if that SHA already exists on
  the host. Do not edit an existing release in place. A corrective source commit makes
  a new release. No automatic garbage collection or database deletion is included.

## One-time operator setup (not performed by this change)

Do these once through a separately authorized secure setup. Keep routine releases
unattended after setup; a manual GitHub environment approval for every release is not
required. New SSH/OAuth access, credentials, permissions and initial secret delivery
still require the user's secure approval. Nothing below authorizes copying local keys.

1. Resolve the separately controlled DNS/tunnel bootstrap and API/provider readiness.
   Ordinary release code never reads/writes/restarts cloudflared, Cloudflare, DNS,
   shared nginx, PM2, another application, or root-domain routing. Preserve the existing
   source/container until the first full baseline has been proven and recorded. Do not
   rerun historical bootstrap scripts to adopt an existing live instance.
2. Host prerequisites: Linux x86_64, Docker Engine at `/usr/bin/docker`, Python >=3.11,
   enough disk for two images/releases plus independent DB/backup snapshots. The host
   does not need npm, uv, application dependencies, host nginx or a new systemd app.
   Docker cache disk must also have adequate space; image loading fails before downtime
   if it does not. Confirm ports 5196/8297 are dedicated to Everplain.
3. Prepare root-owned, non-group/other-writable parents `/srv/everplain`, `releases`,
   `data`, and `backups`; keep backups mode 0700. Prepare a dedicated `incoming` directory
   writable only by the approved deployment account (e.g. `everplain-deploy`). Do not
   give that account general root, Docker group access or access to application secrets.
   Provision bridge network `everplain-production` with label
   `org.everplain.managed=release-v1`. No network creation occurs during deployment.
4. Install the reviewed files `ops/cd/deploy.py`, `ops/cd/artifact.py` under
   `/usr/local/lib/everplain/cd/` and `ops/database.py` under
   `/usr/local/lib/everplain/`, owned by root and not writable by the deployment/runtime
   accounts. The launcher is executable; its other modules are read-only. Controller
   upgrades are separately reviewed operator actions; artifacts cannot replace it.
5. Securely provision `/etc/everplain/production.env` in Docker env-file format, root
   owned mode 0600 or 0640 with an intentionally chosen group. All actual mandatory
   fields must pass `ops/preflight.py`; the deploy controller never invents credentials.
   Add `/etc/everplain/deploy.json` with the exact nonsecret assertions below, root owned
   mode 0600. Only set them after verifying single-writer behavior and that all public
   ingress goes through web5196. No direct public API port is allowed.

   ```json
   {"format":1,"application":"everplain","public_url":"https://e.qunxue.xyz","single_writer":true,"ingress_only_web":true,"layout_ready":true}
   ```

6. Establish the FIRST healthy full release in a separately reviewed bootstrap window;
   the static-only predecessor is deliberately not silently adopted as a full API:
   - Use the checked artifact built by this workflow. Verify its manifest/digest and
     load its exact image IDs. Choose `/srv/everplain/releases/<SHA>` and a fresh
     `/srv/everplain/data/<baseline-id>/everplain.db`, never another product's data.
   - Generate the private release `runtime.env` from the approved production env, with
     revision set to full SHA, database URL `sqlite:////data/everplain.db`, retrieval path
     `/data/everplain-retrieval.db`, and `EVERPLAIN_MIGRATIONS_MANAGED=1`. Preserve the
     original environment file's UID/GID/mode explicitly. Do not simply use `copy2`.
   - The API image uses UID/GID 10001:10001; its dedicated data directory must be readable
     and writable by that identity (directory 0750, new database 0600). Take a consistent
     backup before any adoption of existing Everplain data, and migrate only a new copy.
   - Run the new image's preflight and forward migration on that new data path. Create
     only `everplain-api` and `everplain-web`, both labeled
     `org.everplain.managed=release-v1` and `org.everplain.revision=<SHA>`. API network alias
     is `api` on `everplain-production`, mounts only its data parent at `/data`, and binds
     `127.0.0.1:8297:8297`; web binds `127.0.0.1:5196:8080` on the same network. Use the
     matching exact image IDs and release runtime env, as in `Controller.service`.
   - Atomically set `current`, prove local/public web and API revisions, then write
     root-owned 0600 `state.json`: `current` SHA, `previous: null`, absolute `database`
     path, `database_migration_tree` from manifest, and numeric `last_run_id: 0`.
     Until this baseline exists, automated deploy fails before downtime. Retain the old
     static release outside this pipeline for bootstrap recovery.
7. Securely approve a least-privilege, repository/environment-scoped SSH identity and
   pinned host key. The account should have no port/agent/X11 forwarding; an operator
   should restrict its writable path to incoming and its sudo command to this exact
   controller, never a shell/general python/docker wildcard. A forced-command gateway
   may constrain SFTP plus the two controller verbs further. The controller itself
   validates all bounded arguments and fixed paths. Set only these environment items:
   - Variables: `EVERPLAIN_DEPLOY_HOST`, `EVERPLAIN_DEPLOY_USER` (must start `everplain`),
     `EVERPLAIN_DEPLOY_PORT` (normally 22).
   - Secrets: `EVERPLAIN_SSH_PRIVATE_KEY`, `EVERPLAIN_SSH_KNOWN_HOSTS` (verified exact host
     key line; nonstandard port uses `[host]:port`). Never `ssh-keyscan` and trust blindly.
   - The environment is named `everplain-production`. Restrict it to main; optional
     branch/reviewer protections should fit the repository's chosen merge policy.
8. Run one authorized end-to-end deployment and one recovery rehearsal. Until those
   complete, claim only offline tests/source delivery. Configuration and health checks
   do not exercise real model tool calling, research/citations, email or user browser
   flows. Use the selected provider/model's actual protocol and an explicitly authorized
   minimal smoke test before claiming compatibility; an adapter or passing unit test
   alone does not establish live credentials, billing, or tool-call behavior.

## Integrating the current main schema

The 2026-10-03 integration includes the durable-billing migration `20261002_0510`
and Soul preferences migration `20261003_0520` from main. Their presence in the artifact
is not an approval to migrate an unknown live database. The compatibility allowlist
remains empty: if the actual recorded schema tree differs, deployment stops before
services are stopped. Compare the confirmed old application/schema with the proposed
migration, and verify old readers/writers against the new schema before allowing that
specific previous fingerprint. Never substitute a guessed revision or a frontend asset
hash for the recorded database schema. Keep ordinary deploy, first baseline adoption,
and real-model activation as separate, explicitly verified outcomes.

## Metadata, audit, and operations

`atomic_bytes` applies original UID/GID first, then original mode, fsyncs and replaces.
It is used for runtime/config snapshots and state. Symlink ownership is retained.
Both candidate SQLite files retain their own source UID/GID/mode. Rollback verifies
public and local health/revision/static bytes before clearing its recovery journal. Artifacts contain no secrets;
private environment snapshots and consistent DB backups never leave the host. Do not
upload host journals, env files, raw application logs or backups as CI artifacts.

The existing production API starts its normal background model health probe on startup;
that behavior may call a billable provider. This change does not disable or multiply it
for rehearsal: offline tests never start an application container or use production env.
Do not run staging/rehearsal APIs with production secrets. Actual authorized production
activation, and rollback if needed, retain the existing startup behavior; HTTP readiness
checks themselves are read-only.

Job summaries contain only source/run identity, bounded result, artifact hash and
validation status. On failure, consult private host logs; exception bodies are not
forwarded because provider/settings errors can contain credentials. Check health and
revision explicitly before reporting production live. Restrict backup access, perform
operator-approved encrypted off-host backups, and monitor retention/disk separately.
No `down -v`, automatic prune, chmod 777, SSH host-key bypass or automatic secret setup
is part of this release path.

## Focused offline verification

```sh
python3 -m unittest discover -s ops/tests -p test_cd.py -v
python3 -m unittest discover -s ops/tests -p test_packaging.py -v
bash -n ops/cd/build.sh ops/cd/transport.sh ops/start-api.sh
```

These tests use synthetic artifacts/databases and fake runtime actions, one test worker.
They cover corrupt/archive traversal input, metadata, stop/backup/migrate ordering,
failed migration/API/public health, retained post-ingress writes, manual and interrupted
recovery, stale-run rejection, and workflow secret/trigger boundaries. They are not a
Docker build, SSH integration test, live rollout or full application regression.
