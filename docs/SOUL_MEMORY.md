# Soul and Memory

Baseline: `bd32966b036b2ffa2affffa98744f1f81ec660b2`, tree
`d95b5f6a3e92c4d406febf31cd45bbace02637ac`. Source candidate Library
`libfile_8e921c50736481919a30053cb5d91cdd`, version 1, SHA256
`605a00633c3ff1a578c400be585e1ffeff79a14a7f51fd5b3e54d6b09117787d`.
Reference pixels inspected from `libfile_dc1dd38747a88191b1625d8955a9000c`.

## Existing implementation

`agent_profiles` is a user-owned database row keyed by `user_id`, with name,
avatar, color, four speaking styles, onboarding progress, questionnaire, links
to questionnaire-derived memories, and an optimistic version. The original
runtime persona returned only name and style. Raw questionnaire responses are
excluded, so deleting or disabling the corresponding memory does not resurrect
them through the profile. The profile has CAS protection but no revision history
or audit log; this change does not claim otherwise.

Memory is an existing collection, not a Markdown file. Each entry has key,
content, origin (`manual`, `explicit`, `learned`), owner, optional project,
version, timestamps, source conversation/message/quote, and a deletion flag.
The repository checks owner/project access, uses version fences, soft deletion,
idempotency records and revision snapshots. Personal and project recall and
learning have independent settings. Onboarding writes four structured answers
as explicit entries; the `additional` questionnaire field is not a runtime
persona or an onboarding memory.

Actual runtime assembly is bootstrap `current_persona(user_id)` ->
`DisciplinaryAgentApplication` -> `tools.persona` -> main Agent instructions.
Memory binds authenticated user/project/conversation in `AgentMemoryTools`,
loads enabled personal/project entries into a 1200 UTF-8-byte context, and
provides bounded search and explicit-request writes. Main Agent and research
planner both consume memory; the planner originally had no persona callback.
Background learning is conditional on configured model endpoints and the
learning setting, not guaranteed active merely because entries exist.

## Change and contract

The companion menu and drawer distinguish **Soul** (assistant identity and
behavior preferences) and **Memory** (existing personal memory collection).
Appearance fields remain. Soul provides unrestricted prose/Markdown source
editing, with four styles as optional starting points, not the editing limit.
The account Agent settings use the same editor and controller.

Migration `20261003_0520` follows `20261002_0510` and adds only
`agent_profiles.soul_text TEXT NOT NULL DEFAULT ''`. Existing profiles,
questionnaire links and memory tables remain unchanged. Existing users get an
empty description; no guessed content is copied from questionnaire or memory.

`GET /api/agent-profile` adds `soul_text`. `PATCH` accepts an optional string up
to 8000 characters, including empty string to clear it. Omission preserves it;
null is excluded by the existing PATCH semantics. The authenticated session is
the only owner selector. Existing `expected_version` CAS applies to the whole
profile and a stale write returns 409. Generated OpenAPI and TypeScript types
come from the normal export/generation commands. No new Memory API is added.

Saved Soul is loaded afresh for each non-replayed Agent turn. It is added as
escaped JSON data in the user prompt in synchronous answers, both streaming
branches, and research planning. Freeform Soul is explicitly excluded from
Agent instructions; only the existing name/style fields remain there. Trusted
template text makes preset style a default, current requests take precedence,
and saved preferences cannot change system policy, facts, evidence standards
or tool authorization. This verifies request construction, not immunity from
every model prompt-injection behavior. Server-side permissions are unchanged.

## Draft and conflict behavior

Drafts retain their original profile version. Background refresh never silently
rebases them. A newer version disables save and shows the latest identity,
style and full Soul source alongside the retained local editor. The user may
explicitly keep local changes (only locally edited fields override the reviewed
latest version) or confirm discarding them. Further concurrent writes still
fail CAS. Failed saves keep all fields.

Drawer close/tab switching preserve drafts. Settings route unmount/reopening
also preserves them in QueryClient memory keyed by user, with no localStorage,
sessionStorage or disk persistence. Successful save/explicit discard clears
the retained draft; a full page reload has a native beforeunload warning.
User changes mount a separate controller. Memory retains its own existing
entry editor, scope/source/history and conflict protection.

## Verification and release coordination

Related frontend: 60 tests passed across RoleIdentityPanel, AgentSettingsPanel,
AccountMenu, AccountSettingsPage and ResearchMemoryPanel. Related backend: 26
tests passed with sockets blocked and model credentials removed. New tests
cover profile persistence/CAS/isolation, additive migration, saved persona
loading through the chat API, and FunctionModel request inspection for sync,
stream, streaming fallback and research planner. Existing memory tests remain.
The reused Pydantic AI dependency emits a current-event-loop deprecation warning.

Typecheck, scoped lint, module boundaries, style tokens, Ruff and production
build passed. Isolated headless Chromium checks at 1440px and 390px used the
real drawer, synthetic API responses and native dialog: free editing, save,
close/reopen, conflict review and cancellation passed. No screenshots,
foreground interaction, real provider call, production operation or paid smoke.
These checks do not claim full production acceptance or a subjective visual review.

Deliver as an uncommitted patch from the isolated `feat/soul-profile` worktree.
The sidebar owner has reserved only layout/CSS and does not edit AccountMenu's
Soul/Memory text. The publication thread owns Issue/PR, integration, migration
ordering and exact-head CI. Do not independently merge or deploy.
