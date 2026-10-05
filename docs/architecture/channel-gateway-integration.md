# Channel gateway integration checkpoint

This change restores the missing independent Telegram/Feishu transport beside
the channel control plane already present in Everplain. It does not deploy a
gateway, register a webhook, create credentials, or establish a live-platform pass.
Issue: [#74](https://github.com/huyanxius/everplain/issues/74).

## Source and dependency provenance

- Integration base: `214ff0b6826c3a0f36a868688561240a95b312f5`.
- Original Everplain source: `896f6187dd22a32955ac048df1e553f405f50ae4`,
  tree `63d58a3dd7dc963a1e677e655823a68a7b8ad8a8`.
- Verified source archive SHA-256:
  `379a259f256d75e1110996b6669fe906846a7079f9c9dfd17868f0057d2346f4`.
- All 24 imported `gateway/` files match that source archive byte for byte.
  The previous full tree is not substituted for current main: current backend,
  billing, migration 0540, frontend, release logic, and configuration are retained.
- Gateway lock SHA-256:
  `294f2783be8128c227075b54642855aa391ad44e89450226bc8fd57af084923a`.
  Registry dependencies come from PyPI and their distribution files are hash-pinned.
  Gateway and backend retain independent lock files and virtual environments.
- The gateway source is the project's own prior delivery, not a vendored bot
  framework. This integration does not apply a new license to Everplain.
  `aiogram==3.31.0` and `lark-oapi==1.7.3` are MIT-licensed installed dependencies;
  their distributions retain the upstream license/copyright texts. No third-party
  SDK source or credentials are copied into this repository.

Dependency notices verified in the locked wheel distributions:

- `aiogram-3.31.0.dist-info/licenses/LICENSE`: MIT;
  Copyright (c) 2017 - present Alex Root Junior.
- `lark_oapi-1.7.3.dist-info/licenses/LICENSE`: MIT;
  Copyright (c) 2023 Lark Technologies Pte. Ltd.

Keep these upstream license texts with installed/distributed dependencies.

The restored [selection record](bot-gateway-research.md) is dated 2026-10-03 and
records the original implementation decision. It is not a claim that later
platform features, permissions, or live availability have been tested here.

## Credential-free validation

The additive `Channel gateway contracts` workflow installs both frozen projects
and runs `gateway/scripts/verify-local.sh`: focused backend authorization,
persistence, billing, migration and architecture tests; gateway unit contracts;
and the two-process HTTP suite using actual aiogram/lark SDK clients against
synthetic loopback endpoints. The script fails when either Python environment is
missing, instead of accepting skipped integration tests as a pass.

The CI test step removes inherited `EVERPLAIN_` settings and proxy variables.
It does not receive platform or deployment secrets. Fixtures create temporary
synthetic accounts/databases, bind only loopback, and terminate their own child
processes. Their model edge is synthetic; a passing run does not verify provider
quality, live charges, platform permissions, or real delivery.

The existing main CI still runs independently and may select its broader suites
for this new top-level directory. No change is made to the existing CI path logic
or to CD, Compose, Nginx, or release artifacts.

Revalidation on 2026-10-04 against the unchanged integration base backend and
the imported gateway passed: Ruff; 27 focused backend/migration/architecture
tests; 21 gateway unit tests; all 10 two-process HTTP/SDK cases, including both
response-loss variants and both long-run/revocation variants. The wheel and
source distribution built successfully, and wheel inspection confirmed that
integration/browser/test fixtures are excluded. Browser, Docker, live provider,
live platform and deployment checks were not run in this integration pass.

## Minimum later deployment configuration

Use the existing owner-approved Everplain environment and one consenting pilot
account. Keep an independent gateway persistent volume. Publish only
`/webhooks/telegram` and `/webhooks/feishu` through the approved HTTPS ingress;
keep gateway health and service-authenticated backend calls restricted.

`EVERPLAIN_GATEWAY_BACKEND_URL` accepts a bare HTTPS origin, without credentials,
path, query, or fragment. The already approved Everplain TLS origin can satisfy
this policy if the deployment owner verifies that it reaches the same API, has a
valid certificate, permits the service-authenticated dispatch/delivery requests,
and preserves the long-request timeout. The gateway does not follow redirects.
No domain is guessed here and HTTP is not enabled for a Docker service hostname.
If deployed beside the host API, the existing loopback
`http://127.0.0.1:8297` option is also allowed; container loopback must not be
mistaken for the API container.

The exact credential field names and platform setup checklist are in
[`gateway/ACCEPTANCE.md`](../../gateway/ACCEPTANCE.md). Actual credentials must be
entered through the approved secure configuration route by an authorized
operator. Existing website/model credentials must not be repurposed as gateway
service credentials.

The first supported scope is private text for one Telegram Bot and/or one Feishu
application in one tenant. The user generates their own one-use binding command
after consenting to private data transmission and ordinary Everplain usage.
Replies are a safe progress notice followed by final text chunks, not token
streaming. Groups, attachments, QQ/WeChat, multi-instance operation, and automatic
dead-letter recovery remain outside this checkpoint.

Deployment wiring and real-platform acceptance are separate remaining work.
After controlled deployment, verify owner binding, a real model turn, matching
platform/web answers and one charge, then replay, long runs, restart, throttling,
and revocation. Never interpret this integration PR or synthetic tests as proof
that either bot is online.
