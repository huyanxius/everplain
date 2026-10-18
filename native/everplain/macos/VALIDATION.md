# Validation status

Revision date: 2026-10-04 UTC. Executor: Linux x86_64, official Swift 6.4.0. This revision is based on Library v1, which the user previously compiled and installed on their Mac. **The old Mac log is historical; no Apple SDK build of the expanded revision has run.**

## Executed and passed

- **96 XCTest cases, 0 failures**, built together from the current portable Core using Swift Package Manager and its bundled Markdown/cmark sources. Coverage includes endpoint scope, real wire codecs, SSE, stopped/unknown outcomes, deep-research continuations and tool events, citation parsing, source-offset motion, GFM structure, fractional allowances, account/CAS/onboarding, workspace state, uploads and DOCX/export policies.
- The SSE tests exercise all **21 shared framing fixtures**, including one-byte UTF-8, CRLF, BOM, comments, multiline data, malformed/truncated EOF and event bounds. The semantic fixture supplies **11 actual research wire shapes**, with synthetic content.
- **10 real AppStore offline checks:** scope switching blocks Send synchronously; settings preserve background generation; multiple unfinished rounds survive new sends; retries retain the selected original identity; all canonical recovery records are restored; waiting research does not resume itself; identity-based reconciliation and owner/navigation races stay guarded.
- **11 account/memory offline lifecycle checks**, using the actual stores plus explicit platform/transport facades; owner reset, late responses, queued actions, redemption/readback separation, mutation keys, paging, channel state, empty-memory behavior and conflict review.
- **12 KnowledgeStore offline checks**, including the original owner/read/publication gates and actual multipart/body retry identities, changed content/order/source, quota consumed after an uncertain result, confirmed auto-created destinations and late old-owner responses.
- **4 library edit-draft executions:** stable identity after row deletion, relation updates after rename, ignored stale controls and exact generated DTO output without UI-only identifiers.
- **21 shared Python tests** and exact source verification for **115 paths / 134 operations / 281 schemas**. One operation is the explicitly undeployed run lookup extension; the others derive from the live backend OpenAPI. Token source bytes and generated consumers match.
- Strict generated Swift compile with **Swift 6 mode, warnings-as-errors and complete concurrency**: 18 codec round-trips, exact large Int64 values and token anchors passed.
- Original graph function/resource hash checks and Node executions of the pinned Cytoscape algorithm: actual COSE/concentric/circle parameters, viewport changes, selected/context styles, candidate arrows, empty graph, literal labels and 150-node case. The native bridge was separately checked against platform facades; no native rendering is implied.
- Exact citeproc adapter executions for ASA, GB/T 7714, Chicago, custom style, missing metadata, malformed CSL and inert hostile titles. The processor matches the locked NPM integrity.
- Independent DOCX ZIP CRC/XML checks passed for the Chinese and ASA fixtures. Both were opened/rendered with LibreOffice and the resulting pages visually inspected. The current Chinese fixture matches the rendered bytes; the ASA content/relationships/styles match, with only its modification timestamp changed. These are synthetic document-format tests, **not Mac App screenshots or native PDF validation**.
- All macOS conditional branches passed `swiftc -frontend -parse -target arm64-apple-macosx13.0`. This is syntax parsing only. Property lists and build-script syntax passed. Seven avatar presets, 70 exact source-weight icons and seven PDF/PNG brand assets passed their reproducible checks.

The complete portable build reports an upstream Swift Markdown 0.5.0 Sendability warning under the Swift 6.4 compiler while the package remains in Swift 5 language mode. It did not fail the build/tests. Only the generated contract/token smoke is claimed warnings-as-errors clean.

Logs are in `verification/revision-v2/`. Reproducible store harnesses live in `Tests/*PortableHarness`; they do not perform network or model calls and are not Apple SDK substitutes. `validation.json` records this source snapshot.

## Still required on macOS

- Apple SDK typechecking/linking of SwiftUI, AppKit, Security, JavaScriptCore and native PDF APIs; launch of the actual .app with all resource bundles.
- Real cookie/Keychain/relaunch behavior, native file security scopes, keyboard/IME and accessibility; no production credentials are stored in tests.
- Matched-viewport Web/App visual review of all core surfaces, fonts, clipping, menus, classic/split sidebar, source reader, canvas, modal isolation and complete animation transitions.
- End-to-end live model/SSE/deep research, user-confirmed mutation/permission flows and conflict recovery. No paid/model or production-write test was executed during cloud development.
- Native PDF output, image rendering and print/font behavior. Word fixture rendering does not validate those APIs.
- Signing, notarization, installer and public-download deployment. Nothing in this source archive is represented as a signed installer.

The citeproc dual-license/distribution choice is not designated by this native candidate. Original texts and attribution are retained. The product’s existing license/distribution arrangement must be confirmed before public citation-export binary distribution; that review is separate from client compilation and the rest of the functional/visual checks.

## Mac acceptance order

Follow `MAC-验收步骤.md`: login/setup; original Home/chat/account/Agent visual issues; model and full motion; library/import/reader/graph; all seven research tools; native exports; then failure, cancellation, rapid navigation and owner-switch cases. In particular, verify that selecting a new conversation never dispatches to the old one, and that an unknown stopped request never silently restarts.

For pre-identity recovery, review/apply the isolated read-only lookup patch through the normal backend process. A missing route or provisional 404 is not proof that a request never ran. It remains recoverable and does not lock the whole application.
