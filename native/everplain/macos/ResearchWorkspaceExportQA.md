# Native research export QA

## Implemented paths

The workspace export menu reads the exact saved document version from `/api/research-documents/{document_id}/export`. Unsaved content cannot be exported accidentally. It supports the server Markdown and JSON outputs, an editable OOXML DOCX, and a native PDF renderer. Both formal exports use the server's formal document, citation audit, formatting metadata, document ID, revision ID, and version. DOCX embeds the original manifest in a custom XML part.

- Portable renderer and OOXML/ZIP writer: `Sources/EverplainCore/ResearchWorkspaceExport.swift`
- Native PDF pagination: `Sources/EverplainMac/ResearchWorkspaceExportPDF.swift`
- Native CSL bridge: `Sources/EverplainMac/ResearchWorkspaceExportCSL.swift`
- Actual API reads/save panel and owner/project guards: `ResearchWorkspaceStore.swift`
- Pinned processor, source styles/locales, and license notices: `Sources/EverplainMac/Resources/ResearchExport`

The PDF implementation uses TextKit, AppKit and CoreGraphics, with a title page, paginated selectable text, headings, lists, block quotes, code, tables, hyperlinks, references, page numbers and citation-warning sections. It does not use a WebView or HTML-to-PDF browser shell. Word output is a real ZIP/OOXML package with editable paragraphs, emphasis, tables, links, and bibliography formatting. Word preserves Markdown image descriptions/source references; the PDF path can embed decoded raster images.

## Source fidelity

The print templates preserve the source's explicit primitives:

- ASA: Letter (12240 × 15840 twips), one-inch margins, Times New Roman 12pt, double spacing, 16pt title.
- Chinese social science: A4 (11906 × 16838 twips), 25mm top and 24mm other margins, Songti/宋体 12pt, 1.8 line spacing, 20pt title. Native PDF uses Heiti SC for the first-level heading/title as the source CSS specifies.
- Source CSL styles: ASA, GB/T 7714 author-date, Chicago author-date; exact English and Chinese locale XML, plus imported custom CSL.

The unmodified `citeproc` 2.4.63 npm tarball was checked against the live Web `package-lock.json` SHA-512 integrity before vendoring. The runtime bridge evaluates that processor in JavaScriptCore. Custom XML and citation JSON are passed as data arguments, never executable-source interpolation. There is no browser, Node process, DOM or network access in the bibliography processor.

Only actual structured CSL records are used. Present unversioned literature metadata is not silently substituted for a historical source version. Missing metadata downgrades an otherwise verified citation to `needs_verification`, and the citation-warning appendix remains visible. This follows the source's missing-metadata behavior rather than inventing author/title/date fields.

Native print-relevant custom CSS rules are supported for page size/margins, body typography/color/background, paragraph alignment/indent, and heading sizes. Arbitrary browser layout rules have no TextKit equivalent: unsupported rules are recorded in the exported document and completion notice. The full original formatting metadata stays in the JSON/DOCX manifest.

## Image authentication and bounds

Images come only from actual standalone Markdown image references. The loader accepts HTTP(S) references without embedded credentials and base64 image data. It limits an export to 32 images, 20 MB per encoded image, and 64 million decoded pixels in total. Thumbnail decoding is capped at 4096 pixels per dimension.

Authenticated reads use the existing cookie-scoped `APIClient.download(maximumBytes:)` only when the URL matches the configured API origin (scheme, host, effective port), has no userinfo/query/traversal, and matches one of these exact existing GET routes:

- `/api/imports/assets/{document_id}`
- `/api/research-tasks/{task_id}/materials/{material_id}/content`

Other HTTP(S) images use a separate ephemeral session with cookies disabled, no credential authentication, bounded streamed bytes, and redirects restricted to the same complete origin. The owner's cookie is never sent to that session or to another host. A private API 401 propagates to the existing authentication-required flow. Unavailable, denied, undecodable or oversized images retain their description/source and add an explicit export warning. No image network requests were made during the cloud tests; routing and bounds were checked with fixtures/static inspection.

## Completed verification

- Portable Swift workspace/export regression tests cover CAS/retry/evidence state plus OOXML structure, page geometry, bilingual text, Markdown structure, bibliography XHTML, citation metadata provenance, custom CSS, image-reference handling, ZIP safety and authenticated image routing.
- Independent Python `zipfile.testzip()` passed for generated Chinese and ASA DOCX files. Every XML/relationships part parsed with lxml. `python-docx` opened both files and verified table content, warnings and exact page dimensions.
- LibreOffice opened and rendered both DOCX files to PDF. Rendered pages were visually inspected for Chinese/English content, title/section hierarchy, emphasis, nested lists, tables, raw markup shown as text, bibliography and broken-source warnings. The Chinese fixture produced two A4 pages; ASA produced one Letter page. This verifies DOCX interoperability, not the native PDF renderer.
- The exact vendored CSL adapter passed Node-based offline checks for ASA, GB/T 7714, Chicago, imported custom style, absent metadata, invalid CSL and an inert hostile-looking title. The processor correctly escaped title markup and did not execute it.
- All research workspace/export macOS source files passed the Swift parser targeting arm64 macOS 13.

Reproducible source checks (from `macos`):

```sh
swift test -j 2 --scratch-path .build/research-qa --filter ResearchWorkspace
node Tests/EverplainCoreTests/Fixtures/ResearchWorkspaceExportCSLChecks.js
swiftc -frontend -parse -target arm64-apple-macosx13.0 Sources/EverplainMac/ResearchWorkspace*.swift
```

To write the deterministic DOCX fixtures for independent package/render inspection, set `EVERPLAIN_EXPORT_FIXTURE_DIR` to a temporary directory while running the export tests. The cloud test run used an isolated package containing exact copies of the owned Core files/tests and the same vendored Markdown dependency to avoid concurrent edits to unrelated macOS files.

## Native smoke gate still required

This cloud workspace has no Apple SDK or macOS runtime. The AppKit PDF renderer and JavaScriptCore Swift bridge have therefore **not** been executed or visually verified natively. Source parsing and portable serialization tests are not a substitute for that gate.

On an authorized macOS executor, build the actual app with the Apple SDK, then check:

1. Export a saved bilingual document with all three CSL styles to PDF and DOCX; verify selectable text, page dimensions, heading flow, tables and a separate reference section.
2. Check a document with more than one page, a long paragraph/table, and real image references; verify no truncation, correct orientation, sensible image scaling and working link annotations.
3. Check same-origin private import/material images, an external public image, an unavailable/denied image, redirect to another origin, and an oversized response. Confirm warning/auth behavior and no cross-origin cookie forwarding.
4. Cancel the save panel, change document/project during an in-flight read, and sign out; verify that stale bytes are not saved into a later owner's operation.
5. Try imported CSL and supported/unsupported CSS. Verify output metadata and visible warnings; malformed CSL must produce a clear error.

## Packaging

SwiftPM generates the resource bundle **`Everplain_EverplainMac.bundle`**. The generated accessor searches `Bundle.main.resourceURL`, the target's bundle resource URL, and the main bundle URL. Copy the complete resource bundle into `Everplain.app/Contents/Resources`; copying only its `ResearchExport` directory is insufficient. Keep the processor/style/license files together. Missing resources must fail clearly rather than silently substituting bibliography punctuation.
