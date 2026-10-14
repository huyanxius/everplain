# Native research tools checkpoint

This source increment adds native Method, Analysis, Theory and Archive components and a native WYSIWYG document-editor component. They use exact generated backend contracts; the instrumented test transports are isolated to the test APK and have no real model/account/production writes.

These components are not yet connected to the full existing-project workspace route. The seven-tool project shell, full research manuscript workbench, exact proposal-diff rendering, CSL/DOCX/PDF integration and full material-annotation workflow remain in progress. Compiling or rendering these isolated tools does not establish complete migration.

## Implementation and protection

- Method plans retain original idempotent writes, CAS conflicts and later edits across retries.
- Analysis memos and case comparisons retain owner/project drafts; candidate decisions use actual server versions and require a reason. Read failures do not automatically repeat a write.
- Theory submission durably checkpoints partial-candidate acknowledgement before sending the original full decision request at the acknowledged version. No page load starts a match.
- Archive export requires the user-selected document destination, streams in bounded buffers, checks the server SHA256 when supplied and reports partial-file failure. Interrupted export retains the original key; it is not auto-replayed.
- Document edits use source900ms autosave with immutable CAS requests; subsequent typing is not overwritten by an older save result. Definite validation errors do not create automatic retry loops. Each section obeys the schema1..100000-codepoint bound.
- NativeDocumentEditor uses BasicRichTextEditor, an actual native Compose BasicTextField from pinned Maven Central version1.0.0-rc11. Source/Apache2 license are included. Images are not fetched by its pinned null default loader; only explicit HTTP(S) links can launch externally. Incoming saved versions do not reset an active IME composition.

## Verification

Before this increment's cloud build,26 exact supplemental controller/transport JVM checks passed. New theory/editor tests and the full Android compilation/device run must be judged by the CI result for this commit, not the earlier checkpoint. The local host killed the last larger supplemental compiler process; no successful result is inferred from it.

NativeResearchToolsTest captures isolated native Method/Analysis/Theory/Archive/editor screens and exercises method editing, memo submission, theory selection, read-only archive access and rich text input using explicitly synthetic data. The test's header labels the fixture scene. It does not assert full production navigation or authenticated production-service success.

The previous accepted source c14f69b separately passed58 JVM and12 real Android instrumented tests, including original Bot/Liquid/stream motion, real native composer IME, retained Agent drafts, and persistent3-card pile expansion/collapse. Its APK and evidence remain distinct from this increment.

Primary editor reference: https://github.com/MohamedRejeb/compose-rich-editor/tree/v1.0.0-rc11
Source parity reference: the project's Web MethodPlanWorkspace, ResearchAnalysisPanel/Workspace, ResearchCaseComparison, ResearchArchivePanel, ResearchDocumentWorkbench and Pile components.
