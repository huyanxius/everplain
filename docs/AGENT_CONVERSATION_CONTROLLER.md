# Conversation state and execution boundary

This change implements the A02 / B7 / B8 frontend slice against main
`4894b15f5f045c7fa33e6e3c572b92b705bf7c09`. It does not close the full architecture
programme or claim live model/browser acceptance.

## Responsibilities

- `frontend/src/app/agent/conversationState.ts` defines the existing view state:
  streaming output and an immutable-by-convention original command snapshot. It
  reuses public Agent DTOs rather than creating a second HTTP contract.
- `conversationRecovery.ts` separates pure JSON encode/decode from scoped browser
  storage. Existing `everplain.agent.*.v2` / `.v1` keys, owner/conversation/task/
  writing-document scope strings, recovery fallbacks and seeded draft limits stay
  compatible. Decoding never submits a command.
- `conversationProjection.ts` contains citation/material tombstones, tool trace
  replay, display localization, recovery projection and saved/unsaved output
  reconciliation. It has no storage, network or React state writes.
- `agentTurnController.ts` owns current/retry attempt identity, run identity,
  writing-preparation ownership and the generation-fenced observation lease.
  `startCommand` explicitly starts/retries a POST with the original key;
  `resumeSubscription` requires a saved run/cursor and performs a read-only
  reconnect. `detach` only disconnects; `stop` alone requests cancellation and
  waits for the server acknowledgment. Repeated pending stop commands coalesce.
- `ResearchAgentConversationPage.tsx` composes routing, UI state and these
  boundaries. Dedicated writing-preview callbacks and the user's confirmation UI
  remain distinct from assistant narration. It does not accept proposed document
  content as part of streaming or recovery.

The existing `modules/research-agent/researchAgentApi.ts` remains the single
transport owner for SSE event IDs, duplicate suppression, sequence cursors,
reconnection and GET versus POST behavior. The controller passes requests and
resume cursors unchanged; it does not implement a second cursor/parser.

## Correctness changes, separately from extraction

1. A hidden automatic writing-action echo may have an empty display question. A
   stored interrupted view with a nonempty run identity can recover that body;
   the separate pending command still retains its original nonempty request.
2. Server recovery can preserve an explicitly unsaved local tail only when both
   run ID and idempotency key match within the already selected storage scope.
   The server owns saved attempts. An older unsaved version is archived separately
   if a newer server attempt exists. Any deletion tombstone dominates current and
   archived text; neither another run nor another command key is merged.
3. An old writing-preparation success, failure or finalizer cannot write into or
   release a replacement document's preparation. Scope change invalidates its
   ticket and allows the new document to begin its own save.
4. A pending stop is coalesced, ignored after scope replacement, and cannot turn
   an already completed turn into a failed pause. Old stream callbacks and
   finalizers cannot consume a newer observation lease.

## Verification

Targeted suites:

- `conversationRecovery.test.ts`: malformed data, exact original request/raw
  output round trips, storage failure, scope isolation, automatic writing echo.
- `conversationProjection.test.ts`: duplicate tool calls, original output,
  citation/confirmation projection, tombstones and same-run/key unsaved recovery.
- `agentTurnController.test.ts`: command versus subscription, unchanged resume
  cursor, detach versus stop, duplicate pause, stop failure/retry, late stop,
  completion races and writing-preparation ownership.
- `ConversationController.integration.test.tsx`: synthetic HTTP/SSE page
  counterexamples for the recovery and replacement-document cases above.
- Existing Agent page, model selection, context card/home submission, readiness,
  transport and writing-preview state suites cover the integrated UI boundary.

These are deterministic synthetic/unit checks. They do not invoke a paid model,
exercise live OAuth, inspect production UI or prove live end-to-end behavior.
No account/identity changes, attachment-picker late-response probes, API contract,
request URLs, storage keys or displayed copy are included in this slice.
