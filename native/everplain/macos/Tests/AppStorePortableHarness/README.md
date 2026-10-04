# Offline AppStore scope and recovery regression checks

Build EverplainCore with the official Linux Swift toolchain, then run:

    python3 Tests/AppStorePortableHarness/run.py --swiftc /path/to/swiftc --core-products /path/to/Core/products

The products directory contains EverplainCore.swiftmodule and libEverplainCore.a.
The script compiles the current AppStore source with actual generated contracts
and explicit offline platform/child-store facades. No facade calls a service.
It does not simulate Apple rendering and is not an Apple SDK typecheck.

Checks:
1. Switching from a running workspace context synchronously blocks Send. It cannot
   construct an old conversation/new project request before queued navigation runs.
2. Selecting another ordinary conversation synchronously blocks Send before its
   loading Task begins.
3. Opening account settings leaves a synthetic background turn running and keeps
   the original background route. No stop, cancellation, or replacement occurs.
4. Two failed/interrupted turns survive a third send; selecting the oldest retry
   preserves its complete original request and key while keeping newer turns.
   Owner reset clears all retained content and completion identity mappings.
5. Canonical history restores all unfinished runs, including saved research plan
   title/steps. Selecting a waiting plan performs no request and generic retry
   cannot resume it. Reloading history cannot duplicate recovery rows; selecting
   another conversation clears retained content before the load Task starts.
6. An unresolved stop with unknown run/conversation identity remains viewable but
   cannot be replayed, even when another pending turn is selected.
7. Identical question strings do not imply identical runs. Synthetic read-only
   lookup responses map run IDs to actual canonical turn IDs; only the completed
   run is removed. A stale unfinished snapshot cannot revive a proven completion.
8. A completion event removes its own pending run and preserves other failures.
9. The real retry dispatcher receives the selected original request/key. A late
   canonical response cannot replace a new question sent after the read started.
10. A live retained server run blocks new sends and unrelated retries. Its own
    explicit reconnect remains allowed. A late prior-owner read restores nothing.

The transport facade only decodes synthetic fixtures and records explicitly
requested streams in memory. Mutation methods trap; no test reaches a service.
The production refresh/reconciliation path uses only canonical GET and the
existing read-only run lookup. It never posts a turn to discover its status.
The current screen displays canonical turns followed by retained unfinished
turns and the selected pending turn, matching the source thread grouping.

The first race was reproduced before the fix as:
`canSend=true, conversation=old-conversation, project=new-project`.
After the guard fix no request is constructed. All data is synthetic.
