# Local acceptance and first live pilot

This is a controlled technical preview. Local tests use real Everplain account,
authorization, Agent persistence and accounting code, separate backend/gateway
processes, and real aiogram/lark-oapi clients. The model and platform HTTP endpoints
are synthetic loopback services. This does not establish live Telegram/Feishu,
real-model quality, production capacity, container operation or browser acceptance.

## Reproduce on a clean checkout

Prerequisites: Python 3.12, official `uv` (tested 0.11.29), and a loopback-capable
Linux environment. Install each locked project separately; no platform credentials
are needed. Keep `backend/.venv` and `gateway/.venv` independent.

```sh
uv sync --project backend --frozen
uv sync --project gateway --frozen
bash gateway/scripts/verify-local.sh
```

The script checks the backend and gateway serially. The two-process integration suite creates temporary
accounts and databases, starts listeners on dynamically selected loopback ports,
and stops both children on completion. Existing `EVERPLAIN_` configuration is
removed from child environments before test-only settings are installed. Never
point these fixtures at a live database or replace their synthetic token values.
Test databases and logs are not part of the source delivery.

The fixture is deliberately excluded from the gateway wheel/container. The
application refuses to start without at least one fully configured platform.
`/health` means local process readiness only.

## Acceptance inventory

- Backend contracts: consent and authenticated owner management, origin checks,
  scoped/hashed/expiring/one-use binding codes, cancellation/revocation, disabled
  users, depleted balances, scope and tenant isolation, payload tampering,
  concurrent event replay, persisted billing, lease fencing and >30-second runs.
- Gateway contracts: signature/secret checks before durable ACK, stale replay,
  capacity and principal limits, private-message filtering, FIFO/restart recovery,
  Unicode splits, Telegram topics, stable Feishu UUIDs, bounded retries and
  ambiguous-send handling.
- Ten two-process HTTP cases: duplicate delivery and process restarts; SDK 429
  and ambiguous response; revoked multipart output; encrypted Feishu callbacks
  with business rate limiting; committed runtime result replaced by a synthetic
  HTTP 503; committed runtime result with a real truncated HTTP response body; revoked queued
  input and unclaimed code; permanent Telegram 403; >30-second model silence;
  revocation while that long run is active.
- Frontend unit tests cover consent, code lifecycle, owner change, repeated
  actions, late responses, cancellation and generated-client calls. Browser
  acceptance is prepared under `gateway/browser` and remains unexecuted until
  run in an authorized isolated browser environment.
- Migration head is `20261003_0540`, after writing `20261003_0530`. The migration
  regression upgrades, preserves existing writing data, downgrades only the
  gateway tables, then upgrades again.

Frontend tests are separate from `verify-local.sh`. After `npm ci --ignore-scripts`
in `frontend`, run this from that directory:

```sh
npm run test -- --maxWorkers=1 src/modules/channel-gateway src/modules/account/AccountSettingsPage.test.tsx
npm run check:boundaries
npm run typecheck
```

The transport faults are deliberately created by a local fixture after a normal
backend commit. They establish replay behavior for an HTTP 503 and an incomplete
HTTP body; they do not simulate every proxy failure or a production network outage.

## Minimum non-secret pilot decisions

Start with one consenting test owner and one private chat per platform.

1. Target Everplain environment and backend origin. Choose a separate persistent
   gateway volume and a valid public HTTPS webhook origin. The service listens
   on loopback 8298; publish only the two webhook paths through the approved
   reverse proxy. Keep health and backend gateway APIs private.
2. Telegram Bot ID and verified bot username/launch URL, or Feishu app ID and
   allowed tenant key. These identifiers are configuration, never proof of a
   user's Everplain identity. Do not use a personal-account automation session.
3. For Telegram, webhook path `/webhooks/telegram`, allowed updates `message`,
   and no dropping of pending updates. For Feishu, enable the application bot,
   subscribe to `im.message.receive_v1`, and approve only the single-chat receive
   and application-message send capabilities required by the official console.
4. A test Everplain account, an enabled existing model route, adequate normal
   allowance, and a maximum pilot usage budget. Test owners generate their own
   binding commands in Account Settings → 聊天平台 after explicit consent.
5. Optional operator-verified display names and bot URLs in
   `EVERPLAIN_CHANNEL_GATEWAY_DISPLAY`; without these, the interface says that
   the launch link has not been configured.

## Credentials the owner/operator must enter securely

Do not put any values in chat, issues, source files, PRs or acceptance reports.
The owner/operator enters them through the approved secret manager. Creating a
new long-lived service credential or granting new platform access requires the
owner's action-time approval; the test harness does neither.

| Platform | Secret fields |
| --- | --- |
| Telegram | `EVERPLAIN_GATEWAY_TELEGRAM_TOKEN`, `EVERPLAIN_GATEWAY_TELEGRAM_WEBHOOK_SECRET`, `EVERPLAIN_GATEWAY_TELEGRAM_BACKEND_SECRET` |
| Feishu | `EVERPLAIN_GATEWAY_FEISHU_APP_SECRET`, `EVERPLAIN_GATEWAY_FEISHU_ENCRYPT_KEY`, `EVERPLAIN_GATEWAY_FEISHU_VERIFICATION_TOKEN`, `EVERPLAIN_GATEWAY_FEISHU_BACKEND_SECRET` |
| Existing Everplain backend | Matching per-bot service secret entries in `EVERPLAIN_CHANNEL_GATEWAY_CREDENTIALS`; existing model credentials remain in the existing backend secret store |

The backend credential keys are `telegram:<bot-id>` and
`feishu:<app-id>:<tenant-key>`. Use distinct gateway service secrets of at least
32 characters; do not reuse user cookies, model keys or other application tokens.
Telegram's webhook secret must use only ASCII letters/digits, underscore or dash.

## Evidence required for a live pass

For each enabled platform, record only event/run IDs, timestamps and redacted
status information. Confirm: valid platform callback → owner-approved binding →
real model turn → matching platform/web answer → one recorded charge. Then verify
duplicate delivery, a task longer than 30 seconds, platform 429/backoff, process
restart, account revocation before execution and during a run, and no private
answer after revoked delivery authorization. Validate alerting for dead/ambiguous
outbox items before opening access beyond the pilot owner.

Telegram ambiguous sends cannot be claimed exactly-once. Check the platform
before an operator recovery decision. Feishu's stable UUID automatic retries stop
before its one-hour deduplication window. Neither retry path may rerun the model.
Group chat, external-site embedding, QQ, WeChat, attachments and live platform
long connections remain outside this first implementation.
