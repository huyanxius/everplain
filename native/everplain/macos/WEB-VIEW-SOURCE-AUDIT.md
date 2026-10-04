# Web/native source and interaction audit

This revision uses the exact deployed Web source archive `welcome-live-ready`, SHA256 `f48e0ee1fb6e05639b9c4f4fe1d879578498cfa564f3e7335decab7ff2132df3`. The shared `contracts/WEB_PARITY.md` separates actual authorized cloud-Web clicks, source findings and unexercised actions. The three user-provided Mac screenshots were downloaded and visually inspected before implementation. The baseline is the user-built Library **v1**, SHA256 `c8e0ee0993a7afd4ee0a663867baa8feb9671b6b44a57f6cbdabb64bd21cd89b`.

The scope is now the core product beyond the initial four pages. The standalone More group and administrator/server callbacks remain excluded. Core-reachable sharing, usage, imports and research actions are retained regardless of route naming. No public sharing, destructive account action, channel authorization or paid model call was executed for this audit.

## Mapping

| Surface | Authoritative Web behavior | Native implementation |
| --- | --- | --- |
| Login/register | Actual click: seven avatars, email then password, visibility/back, creation link; source verification-code registration | Secure native fields and source layout, exact avatars with staggered timing, real cookie transport; no extra server-address field occupying the login page |
| Onboarding | Global setup gate; import, identity, questionnaire, completion; reset revisits setup without immediate backend reset | Four native steps, true import pipeline, persisted step/version handling, reviewed conflicts, completion to graph |
| Sidebar | Actual width240, padding8, rows36, text14/21, gap12, radius10, no right divider; separate64/200 split layout | Original NavIcon stroke paths, fixed sidebar geometry, animated collapse, records panel, real conversation/research rows and raised account capsule with separate notification button |
| Account menu/settings | Actual account/Soul/Memory/Usage/Upgrade/Settings, eight source panels; settings are modal over a preserved background route | Custom native panels, keyboard/VoiceOver background isolation, focus return, real settings/CAS data; background generation continues while settings are open |
| Home | Greeting/Bot/composer plus recent research and material stacks, real empty/error/loading states | Source structure restored within expanded scope; Home and ordinary chat share one continuously mounted AppKit editor |
| Composer/model | Actual model and effort are separate spans without a visible middle dot; popup300/pad8/radius20 with direct model radios and six stops | Borderless native anchored panel, direct options and custom slider, exact icons, native focus/IME guards, keyboard dismissal; file/library controls use actual data |
| Conversation | User bubble,32px assistant avatar column, no invented role-name headings; progress/tool/source panels | Native streamed text, CommonMark/GFM structural parsing, code/list/table/link/image presentation, actual citation markers/source navigation, copy and explicit retry/research confirmation |
| Motion | Source send940ms, settle320ms, dock420ms; Bot idle/think/work/greet and liquid; paced answer color | Native TimelineView/Canvas/AppKit flight effects use source paths, timing curves and state; timestamps belong to source offsets, not view lifetime; Reduce Motion honored |
| Soul/Memory | Source role/speaking style and UTF-8-budgeted memory, overview/detail/history/settings | Source controls and bilingual strings, pinned Save, owner-scoped draft/CAS recovery, actual records and revisions; empty memory never triggers overview generation |
| Library/imports | Card/graph scope, source brands/formats, queues/history, source reader and inline knowledge editor; read-only access and reviewed publication | True library/import/material endpoints, original icons and brand assets, original material locators, stable edit identities, owner gates and native source-style selectors |
| Graph | Core personal concentric and library COSE graphs, zoom/fit/relayout, points, source evidence | Native Canvas rendering; source-derived node/edge data, layout configuration and visible control geometry; original graph processor is isolated from UI rendering |
| Research | Project/files/memory hub and seven map/materials/analysis/theory/method/writing/archive tools | Real navigation, proposals and explicit confirmations; actual selected task/document/section/theory context, dirty-draft guards and versioned source reads |
| Exports | Real versioned Markdown/manifest, source templates and CSL, project archive | Authoritative Markdown/JSON/ZIP plus native Word/PDF output; pinned original citeproc/styles/locales; unresolved citations and unsupported custom CSS are explicit warnings |

## State corrections checked during integration

- Opening a different conversation or project immediately blocks Send, before asynchronous navigation. Old conversation IDs cannot be combined with a new project ID. Workspace send also requires the store’s current project to match the selected project.
- A new Home upload obtains its own material context and does not inherit a previously open research task. Agent-mode sends leave research-only request fields empty; research sends carry the actual selected section and theory plan.
- Unknown stop results retain original request identity and do not immobilize the entire app. Local waiting may end without claiming server cancellation. Retry never acts as a read-only execution probe.
- Owner reset clears sensitive stores, pending UI/rename/delete state, one-time channel data and former authentication work. A replacement cookie jar prevents late responses from changing the next owner’s session.
- CAS conflicts retain edits. Document/method/theory navigation requests confirmation before discarding them. Same-project refresh cannot silently replace a dirty draft.
- Mutation/upload retries retain original semantic intent; actual-byte fingerprints distinguish changed files. Confirmed writes are not reported as failed solely because their subsequent read failed.
- Both classic and split sidebar layouts keep the Home/conversation editor at the same SwiftUI identity. Separate windows/pickers retain platform-specific native behavior.

## Remaining acceptance limits

1. This expanded revision has **not** been typechecked or linked with Apple SDKs, launched on macOS, inspected with VoiceOver, or compared in native screenshots. All native compile/render claims stop at this boundary.
2. Web CSS fonts were not bundled. Installed Inter/CJK fonts, fallback, line metrics, shaping and antialiasing still need matched-window comparison. PDF font substitution is surfaced in export warnings.
3. Source algorithms and timing values do not prove identical browser/native rasterization or frame pacing. COSE randomization also makes individual node arrangements nondeterministic. Native zoom/scroll physics, clipping, popup placement and live resize require real interaction checks.
4. Native file dialogs, secure entry, OS accessibility behavior and confirmation presentation remain platform controls where needed. Product selection panels, model/effort, sidebars and reader controls use the Web structure rather than system-menu substitutes.
5. Account labels use source bilingual pairs and exact fallback strings; user-authored content is never translated automatically. Source pages that themselves contain untranslated labels retain those labels.
6. PDF generation needs Mac TextKit/CoreGraphics execution. Independent LibreOffice rendering validates the produced DOCX format, not the Mac PDF renderer. Browser-only custom CSS rules without a native equivalent are reported instead of silently claimed applied.
7. The optional read-only run-by-key backend patch remains undeployed. Existing live operations come from the exact backend OpenAPI; source package availability does not establish live end-to-end success.

See `VALIDATION.md`, `ACCOUNT_PARITY.md`, the export/graph audit files and `contracts/WEB_PARITY.md` for the evidence boundaries and runnable checks.
