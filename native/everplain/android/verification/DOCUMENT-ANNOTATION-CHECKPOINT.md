# Document / source-annotation increment

Base accepted Android:9607b1c,77 JVM tests and13 instrumented tests. The analysis screenshot in that run exposed an unhandled synthetic research-cycle path; the fixture and explicit cycleError assertions are corrected here. That earlier image is not a clean visual acceptance result.

New Kotlin/UI/runtime tests in this increment need the CI result for this exact revision. Do not reuse the base's results:

- Original Web documentDiff.ts bundled with the exact36 versions from its lock file, full licenses/provenance and reproducible generator.8 local Node checks cover the two source goldens, identity, bounds, no DOM, named UTF8 data, empty-proposal source error and exact split-surrogate output. These are not Android runtime tests.
- AndroidX JavaScriptEngine1.1.1 has no WebView instance or HTML UI. The official AAR was inspected: no permissions/components, API26+, minCompileSdk34. One process-wide connection lock, cancellable20second calculations,64MiB isolate bound, fixed code and named input bytes; unsupported runtime reports an error. Final merged manifest and actual device execution need CI.
- Four new instrumented diff checks cover original Chinese/English results, injection-looking UTF8 as data, cancellation followed by a fresh calculation, and actual native display with whole emoji. Four JVM tests preserve the raw parts and validate display-only surrogate re-pairing, matching macOS's display helper.
- The existing material reader gains an actual native text-selection action and source-aligned annotation form, same source field order and two kinds. Source text is plain, as Web renders it, so UTF16/codepoint anchors stay exact. Immutable original parse/segment and request key are persisted in owner/project-scoped private storage. Five new JVM tests plus one real selection/IME/device test are included. No real server write is performed by these tests.
- ResearchDocumentPaper is native paper/outline/proposal/version/formatting presentation with required export/diff/discussion services supplied by its eventual project owner. It is not yet mounted in the complete seven-tool project route. Full project routing, formal exports, and the full source-reader/PDF workspace still remain in progress.

The CI class list should add NativeDocumentDiffRuntimeTest and NativeMaterialAnnotationTest before the final NativeMotionPlaybackTest, retaining all existing timeouts and evidence collection.
