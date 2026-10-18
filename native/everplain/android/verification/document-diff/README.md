# Exact Web document diff, native presentation

`web-document-diff.ts` is the unmodified project source `src/modules/research-document/model/documentDiff.ts`. It builds the same TipTap Markdown schema and ProseMirror ChangeSet and preserves the source's Latin-word simplification rule. The UI is native Compose text with insert/delete spans.

The bundled IIFE exposes `EverplainDocumentDiff.diffJson(JSON.stringify({base, proposed}))`, returning a JSON string of `{kind,text}`. It creates no editor or browser surface and passes the source Chinese/local-change and English/list-boundary goldens in a Node VM with no window, document or fetch. Markdown is interpreted as document data, never executable code.

Reproduce with Node and the verified Web dependencies:

```
node verification/document-diff/build.mjs /path/to/frontend/node_modules /path/to/frontend/package-lock.json
node verification/document-diff/check.cjs
```

The generator refuses package-version drift against the supplied Web lock and refuses unresolved/external imports. The provenance file records original source, source tests, Web lock, bundle and all 36 exact package license hashes. Keep all package license files beside the bundle. Current bundle: TipTap3.31.3 and ProseMirror ChangeSet2.4.2; the complete version list is generated.

## Android runtime

The WIP native adapter uses official AndroidX JavaScriptEngine1.1.1. Its inspected AAR declares no permission or component. The system implementation must supply the safe-isolate, heap, named-data, promise and large-evaluation features; missing capabilities produce an explicit error, not an approximate diff. Original strings are UTF8 named-buffer data. The fixed runtime envelope never embeds them in executable JavaScript. Connection creation/cancellation is serialized; the isolate and connection close after each bounded computation.

Runtime cancellation and both Web goldens are covered by `NativeDocumentDiffRuntimeTest`; these are new tests awaiting actual Android CI. The six local Node checks do not establish Android runtime success. `ResearchDocumentPaper` is likewise uncompiled and not routed in the current accepted APK. Keep these WIP claims separate from ade's77 passing JVM tests and12 passing pre-existing Android device tests.
