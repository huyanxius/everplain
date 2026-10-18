# Account, companion and onboarding source parity

This implementation was checked against the actual Web source recorded by
`contracts/WEB_PARITY.md` on 2026-10-04. The app uses native SwiftUI/AppKit controls
and generated `EverplainCore` request/response contracts. This document records
source implementation and offline verification, not a macOS visual acceptance.

## Implemented account behavior

- Two-step login and three-step registration, all seven original avatars, source
  copy, Back, password visibility, ASCII verification codes, UTF-16 field limits,
  and server-provided resend delay. No external registration fallback.
- All eight source account sections: Agent, chat platforms, profile, usage,
  preferences, security, data/privacy, and account status. The account modal uses
  the source 760-by-480 desktop bounds, independently scrolling content, original
  category icons, and custom selects and switches.
- Agent identity/personality drafts remain owner-scoped in memory across panel
  dismissal and section changes. A different saved version requires explicit
  review; users can retain changed fields or adopt the latest profile. Repeat
  setup follows the source navigation behavior and does not silently delete or
  reset an existing profile.
- Companion Soul and Memory stay mounted across tab changes. The Soul save action
  is in a fixed bottom footer outside the body scroll view.
- Profile/preferences writes retain expected versions. Usage uses the settled
  allowance interpretation, opaque server cursors, a ten-entry page size, and
  real redemption requests. Successful redemption remains successful if the
  following ledger read fails; the code is cleared and stale bucket estimates are
  removed. No quota or monetary value is invented.
- The live backend ledger schema has no optional status, charged CNY or refunded
  CNY fields. The Web only displays these if present. Native uses the exact
  deployed generated DTO rather than a guessed shadow type.
- System/light/dark and split/classic sidebar preferences, immediate interface
  language selection, timezone, and explicit server Save. Static bilingual labels
  are extracted from actual Web `text(zh, en)` pairs; unknown strings fall back to
  exact Chinese. User names, email addresses, and editable content remain raw.
- Password update, revoke-other-sessions default, and individual session revoke.
  Privacy includes explicit model-consent confirmation and generated export
  requests; downloads are restricted to the current service origin, the returned
  export's exact route, ready status, and unexpired copies. Native Save As writes
  only after a current-owner recheck.
- Deactivation and permanent deletion show distinct source consequences and
  require source confirmation fields. Protected deployment administrators cannot
  use either action. Successful closure invalidates local owner/session state.
- Chat platforms load actual gateways and bindings, require source data/usage
  consent, create one-time codes, poll binding status while visible, hide codes on
  panel dismissal, prevent copying expired codes, and support explicit cancel and
  unlink. Private code content is never persisted.

## Memory and onboarding

Memory retains source UTF-8 limits, scope/CAS, search including source quotes,
origin and ordering controls, source-conversation links, revisions, explicit
conflict review, and deletion of the record/history with original conversations
preserved. Empty memory never starts an overview request. Nonempty memory follows
source automatic overview behavior; no real overview/model call was executed in
this task. Owner changes cancel operations and clear all content synchronously;
newer reads win over late older reads. Confirmed writes remain represented if the
subsequent refresh fails.

Welcome setup has the four actual stages: import, identity, questionnaire, and
import/graph progress. Back and Skip preserve the source persisted-step semantics;
PATCH updates use expected versions; conflicts preserve drafts for review. All
imports call the shared real KnowledgeStore pipeline. Completion opens the
personal graph and can proceed while import processing continues. The global
profile gate and explicit repeat-setup routing are integrated by AppStore/RootView.

## Conversation recovery integration

The subsequent AppStore/HomeConversationViews integration fix retains unfinished
questions, partial answers, tool steps and research state when another question
starts. Canonical history restores every unfinished run. Row actions select an
explicit original idempotency key; retry dispatches that saved request unchanged.
Waiting research runs only reveal their saved confirmation card until the user
explicitly continues. Unresolved stop records remain viewable and block replay,
including records whose run/conversation identity is still unknown.

Completed requests are removed by known stream request identity and the read-only
lookup's `run_id` / `turn_id` relation. Question text is never used for deduplication.
A failed lookup preserves uncertain content instead of guessing completion.
Owner changes and conversation switches clear retained content; late reads cannot
replace a newer send or restore another owner's data. Selecting an older failed
row does not bypass a retained running request's send lock.

Source evidence: `ResearchAgentConversationPage.tsx:1449–1520` (retention and
recovery), `1925–1929` (retain before new question), and `2592–2673` (canonical,
retained and active thread rows). Exact generated API DTOs are used throughout.
The native implementation also preserves locally known requests whose run identity
was lost before acknowledgement, without automatically dispatching them.

## Verification and remaining gates

Passed on the official Linux Swift 6.4 toolchain:
- 6 focused account-logic tests: protected administrators, explicit owner/closure
  fields, export origin/route/status/expiry validation, expired commands, mutation
  retry keys, and Web-compatible email length.
- 11 additional executions of the actual account/memory stores with offline
  transport/platform shims: owner and queued-action isolation, late responses,
  stable uncertain retries, redemption versus follow-up read failures, opaque
  pagination, consent callbacks, ephemeral channel codes, empty-memory behavior,
  UTF-8 budget, CAS draft review, successful writes with failed reads, and read
  ordering. The harness is in `Tests/AccountStoresPortableHarness`.
- 10 focused welcome logic tests and an isolated real-store lifecycle/CAS smoke.
- 10 real AppStore method regression scenarios with synthetic offline transport
  in `Tests/AppStorePortableHarness`, covering scope/overlay locks, unfinished
  retention, exact retry dispatch, awaiting research selection, unknown stops,
  identity deduplication, and late read isolation.
- All owned native files pass a Swift macOS-target syntax parse. Store semantics
  compile against actual generated contracts using isolated platform shims.

Apple SDK typechecking, a genuine macOS app build, keyboard/focus/VoiceOver checks,
visual comparison, and interactive native acceptance have not run in this Linux
cloud workspace. English layout expansion also needs native visual validation.
The original audit did not exercise account mutations, nonempty channel bindings,
nonempty memory/model summaries, onboarding imports, exports, or account closure.
Those paths are implemented and verified synthetically, not claimed live-tested.
No real account mutation, paid model request, purchase, or user-Mac operation was
performed for this work.
