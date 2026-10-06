# Agent execution boundaries

This slice starts from main `9ccab4c92cafd2a6528c24aaaf446b6103918f01`
(tree `74922f53bec25d68b54581e851f1b513bc4903ad`). It separates SDK adaptation
from Agent policy and closes two reproducible execution-boundary gaps. It does
not replace the Agent, prompts, research strategy, model-routing policy,
application output journal or billing system.

## Responsibilities and callers

| Component | Responsibility | Caller / dependencies |
| --- | --- | --- |
| `pydantic_runner.py` | Model selection, unchanged instructions and planning/retrieval policy, run orchestration | Application invokes the existing runner interface; runner composes the boundaries below |
| `model_protocol.py` | SDK request/stream settings, endpoint invocation, safe route errors and nullable raw usage | Runner model construction and planning; existing metered models and route executor remain authoritative |
| `stream_events.py` | SDK response-part deltas into visible body and guarded writing-preview events | Runner's SDK event handler; no model invocation, persistence or tool execution |
| `tool_runtime.py` | Run-scoped callbacks/cancellation/preview context, command failure cleanup, candidate call identity and tool-result delivery | Explicit bindings and pre-retrieval; it cannot select prompts/models or import the runner |
| `tool_support.py` | Tool availability, bounded trace/evidence projection and existing successful-write replay checks | Runtime, bindings and runner pre-retrieval; no storage or model access |
| `tool_bindings/__init__.py` | Ten explicit registration calls in the original model-visible order | Runner construction; no scanning, implicit registry or service locator |
| `tool_bindings/evidence.py` | Knowledge/material/web read schemas and their existing error/trace mappings | Explicit composition; Session-backed reads use runtime invocation, web calls retain independent parallel dispatch |
| `tool_bindings/research.py` | Task-scoped analysis candidates, workflow/document proposals and map schemas | Explicit composition; proposals remain pending and trusted resource ownership stays in their existing application ports |
| `tool_bindings/memory.py` | History/memory schemas and availability | Explicit composition; these retain their independent service scopes and original serial policy |
| `tool_bindings/writing.py` | The two writing schemas with strict version/offset parameter constraints | Explicit composition and runtime's writing-delivery contract; existing writing operation commit/compensation remains separate from research candidates |

The writing binding is deliberately small: its schema is independently
version/selection constrained, and its existing persisted-operation and preview
cancellation contract differs from research proposals. It does not add a new
business service. The other groups are by capability and execution ownership,
not one module per tool. Compatibility imports/methods remain at the runner for
existing embedded callers; they delegate to the owning boundary.

## Execution invariants

- All 27 tool names, order, parameter schemas and retry limits are preserved.
  Availability is compared against the old runner across 512 capability sets.
  Trusted instruction bytes and normal/deep-research request/tool limits are
  frozen. The explicit safety exception is the formerly unsafe formal-theory
  tool description and behavior described below.
- The 25 non-web tools are serial in SDK dispatch. In a mixed batch this prevents
  a material/analysis/document call sharing a SQLAlchemy Session with another
  call. Web-only batches retain concurrent execution. This is a scheduling
  invariant, not a claim that a Session has become thread-safe.
- The runtime invokes Session-backed registry methods through one failure
  boundary. Both an exception and an ordinary error object roll back the run's
  current Session before a terminal tool event may checkpoint it. Prior successful business commands are durable before another command starts,
  independently of a streaming subscriber.
- Agent analysis candidates flush within the owned run Session, then the
  registry's explicit command-completion port commits after result serialization
  succeeds and before a finished result is acknowledged. This applies to five
  shared-Session business commands: analysis memo/comparison, document
  creation/revision proposals, and theory matching. Read tools add no commit.
  Nonstream runs use the same command boundary. Other application entry points
  retain their existing commit policy. Writing,
  memory and billing's existing receipt/compensation ownership is preserved.
- The application binds command completion to an atomic owner/run/lease and
  not-cancelled checkpoint followed by commit on the same Session. Cleanup is
  supplied by `disciplinary_agent_scope`. Neither callback receives the independent append-only output-journal connection or financial
  transaction. The SDK runtime acknowledges a successful command only after this explicit
  owner returns. Direct registry helpers remain part of the caller's Session
  scope; an unconfigured test registry has no production transaction promise.
- Event part indexes reset per SDK response step. Body tails survive EOF,
  exceptions and explicit cancellation. Hidden reasoning remains suppressed.
  Writing-preview identities and final validation remain guarded.
- The application continues to own request/run/lease, safe checkpoints,
  append-only output, transport subscriptions and explicit stop. A detached
  subscriber does not start another provider request. No durable-workflow engine
  or automatic cross-process replay is introduced.
- Route-level unknown provider usage stays `None`; metering, attempt IDs and
  retry policy are unchanged. A synthetic or missing-usage test is not proof of
  real-model billing settlement or a production provider acceptance test.

## Formal theory authorization correction

`save_confirmed_theory_plan` previously accepted model-generated
`user_confirmed=true` and could call both decision creation and plan confirmation.
That boolean is no longer an authorization source. The compatibility tool can
read an already-confirmed plan through its current owned conversation/task;
otherwise it returns `user_confirmation_required` without a formal write.
A historical tool-summary result cannot bypass this current-state check.

Current personal-product bootstrap hides the formal tool with `EmptyKnowledgeCatalog`
and does **not mount** the old matching routes. Retained source handlers alone
are not an available user workflow. The error offers no nonexistent approval
path, and this patch does not restore the catalog or routes. A test explicitly
mounts the retained authenticated `decisions`/`confirm` handlers only in an
isolated legacy fixture to verify their version checks, cross-owner denial and
subsequent Agent readback; a separate test verifies they remain absent from
default product bootstrap. This is compatibility hardening, not evidence of
a currently exposed production formal-theory exploit.
No new model-controlled approval token, actor, owner or version override is added.

## Evidence and limits

Frozen synthetic fixtures were generated from the original tree, not from the
candidate. They cover tool schemas/availability, all tool result/trace samples,
and SDK event deltas. The same original-runner counterexample invokes the real
`DisciplinaryAgentApplication` checkpoint callback with SQLite and the SDK's
`FunctionModel`: a tool writes once and then either returns an error or raises;
a later simulated network failure must not preserve that half-write or erase
already delivered body. Both old paths fail; the candidate passes. A separate
real SDK batch proves the old shared-Session overlap and the new serial policy.

These are synthetic behavioral and transaction tests. They are not live model,
production load, real browser, complete provider quality, all historical tool or
arbitrary workflow-resumption acceptance. Existing owner/lease, output recovery,
writing cancellation and billing regressions remain required. The narrow AST
boundary tests prohibit a dependency back into the runner or SQLite from the
new protocol/runtime/binding components. They complement the existing whole
repository architecture guard; they do not claim to complete the broader
architecture audit.

## Independent review correction

The first candidate (`f93d7a5`) incorrectly coupled completed analysis persistence
to stream-event checkpoints. Independent tests showed that a second failed tool
could remove the first successful candidate on the no-`on_delta` path. The
correction makes durable business command completion explicit before event
publication, without committing every read. An unacknowledged command commit aborts the run
before another model step; it is not downgraded to an ordinary retryable tool
error. The write and lease fence share one transaction. Stream and nonstream fault injection
cover returned errors, repository/serialization failures and command-commit
failures; terminal journal failure must never imply an absent business result
was successfully saved. The old candidate and its reports remain frozen for
comparison. The first equivalent-only intermediate also had an unbound invoke
call; corrected split artifacts must be tested independently, not inferred from
the final candidate.
