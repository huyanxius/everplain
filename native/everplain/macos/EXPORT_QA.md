# Native research export check

The workbench reads the actual versioned export response. Markdown/JSON and archive ZIP use the authoritative backend output. Native DOCX stores editable OOXML paragraphs, emphasis, lists, tables, safe hyperlinks, page geometry, references and citation-audit data. Native PDF uses AppKit/TextKit/CoreGraphics, source print templates and bounded raster image loading.

The exact source citeproc processor and three style/two locale resources are pinned and verified. Bibliographic metadata is never inferred from a title or substituted for an unverifiable historical source. Missing/deleted references remain explicit warnings. Arbitrary browser CSS has no full native equivalent; supported print properties are applied and unsupported/custom HTML rules are reported.

Executed on Linux: 10 Core export tests; original CSL adapter checks; independent DOCX CRC/XML checks; LibreOffice open/render for synthetic Chinese and ASA fixtures, with rendered-page inspection. Native PDF has not run without Apple SDKs. The output fixtures are tests, not user research or product screenshots.

Image credentials are restricted to same-origin, exact documented import-asset and research-material-content routes. Other HTTP(S) images use a separate cookie-free session. Downloads enforce byte, count and decoded-pixel bounds and safe redirects; failures retain alt/source information and warnings.

Original citeproc license texts, unchanged source and attribution are bundled. The native revision does not designate a new option between its upstream dual licenses; public distribution review remains a separate product decision.
