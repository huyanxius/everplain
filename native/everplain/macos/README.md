# Everplain for macOS

Native SwiftUI and AppKit implementation of Everplain’s core Web product. This revision starts from the user-validated Library v1 source, including its default HTTPS service origin and recovery diagnostics. **This expanded revision still needs an Apple SDK build and native visual acceptance.** The included v1 Mac build log does not validate the new code.

## Scope

- Two-step login, registration, four-stage companion setup and the seven original animated avatars.
- Home, persistent native composer, model/effort panel, conversation history, ordinary and deep research chat, files, personal-library references, real citations and tool activity. Waiting clarification and plan confirmation require explicit user action.
- Account popup, notifications, classic/split sidebars, all eight account settings sections, Soul and Memory, usage and pagination, redemption, sessions, channel binding, privacy/export and account-state confirmations. Upgrade and Discover open their marked official Web destinations.
- Library cards, scopes, imports, original-material reading, knowledge editing, graph/points, evidence, owner/read-only access, invitation join/leave and public publication with its explicit confirmation.
- Research projects/files/memory and the map, materials, analysis, theory, method, writing and archive workspace tools. Documents and plans use actual versioned data, CAS conflict review and recoverable drafts. Export includes the authoritative Markdown/JSON and project archive plus native PDF/Word formatting and source CSL processing.

The standalone More navigation group and administrator/server callback surfaces are excluded. Shared core actions reachable elsewhere remain included. There is no WebView, React application or web-shell runtime. SwiftUI/AppKit render the interface; Swift Markdown parses rich text, and bundled citation-processing code runs locally in JavaScriptCore. No model keys, production samples or authentication secrets are bundled. Test fixtures are synthetic and belong to the test target.

## Build and run on a Mac

Requires macOS 13+ and Xcode 15+ / Swift 5.9+ Apple developer tools. Preserve the sibling `macos/`, `contracts/`, `tokens/` and `shared-tests/` directories when extracting the package. All parser/resource dependencies are included; no remote Swift package fetch is needed.

```sh
cd macos
./scripts/build-app.sh release
open .build/Everplain.app
```

The script checks source drift/assets, runs tests, builds the executable and copies its resource bundle into an **unsigned local application**. It does not sign, notarize, install, publish or deploy a backend. You can also open `Package.swift` in Xcode and run the Everplain executable. See `MAC-验收步骤.md` for the updated acceptance sequence.

The default service is `https://e.qunxue.xyz`, matching the current Web product. For an explicitly chosen test service, set `EVERPLAIN_API_URL` when launching the process; only its origin is stored. Release rejects HTTP. Debug permits only explicit localhost/127.0.0.1 loopback HTTP; certificates and cross-origin redirects are never bypassed.

## State and transport

URLSession uses the actual HttpOnly `everplain_session` cookie. Session credentials and unresolved stop records use an origin/owner-scoped Keychain store. Completed private conversation, library and research data have no disk cache. Account reset cancels work, clears form/data stores and replaces the cookie jar, so an older response cannot change a later owner’s session.

SSE is incremental and preserves split UTF-8, CRLF, BOM/comments and multiline data. Unexpected EOF remains interrupted; only a real terminal event or canonical server evidence settles completion. Stop cancels transport promptly and retains the original request/key. A 202 or lookup 404 does not mean “stopped.” Unknown outcomes allow navigation/logout and explicit new conversation intent; an unresolved old request is never automatically replayed.

Pre-identity stop reconciliation uses the additional owner-scoped `GET /api/agent/runs/by-idempotency-key` route. Its isolated backend patch is included and **has not been deployed**. A missing route remains a visible, recoverable limitation. Known-run checks also read the canonical conversation to invoke existing stale-lease recovery. Opening an account/settings overlay preserves a background stream; changing conversation context synchronously blocks sending until the new scope is established.

Mutations carry retry identities. Upload batches retain their destination, completed files, body hashes and exact multipart boundaries across uncertain retries. Files are read away from the main thread. CAS failures preserve drafts for review; public sharing, deletion and account-state actions retain their actual source confirmations. No live mutation or paid model call was exercised during cloud development.

## Design and verification

The implementation follows the current deployed Web source and the shared actual-click audit in `contracts/WEB_PARITY.md`. Generated tokens retain all 128 source CSS values. Navigation uses the actual Web stroke geometry; other icons use exact locked Phosphor paths. Import brand assets retain their original colors, converted to native vector PDF where needed. Avatar/liquid geometry and motion timings derive from source; font families follow the Web fallback stack.

`VALIDATION.md` and `validation.json` distinguish executed portable checks from pending Apple SDK, native interaction, accessibility and visual gates. `WEB-VIEW-SOURCE-AUDIT.md` records the source mapping and limitations. No Linux render or generated picture is presented as a macOS screenshot.
