# Import parser integration (Issue #7)

```python
from qunxue_api.adapters.import_sources import ImportParseError, parse_import

try:
    items = parse_import("notion", [("export.zip", uploaded_bytes)])
except ImportParseError as exc:
    # No successful items (or unsupported source). exc.items retains diagnostics.
    raise
for item in items:
    if "error" in item:
        record_failure(item["input_path"], item["error"])
        continue
    # Hand content bytes to the existing Markdown material parser / import service.
    # Bookmarks have empty content; source_url is available for separately authorized fetch.
```

This package performs only in-memory parsing. It neither reads files nor invokes HTTP,
models, storage, routes, or DTOs. No dependency was added: Markdown headings use the
existing `markdown-it-py`; Markdown source bytes remain unchanged except UTF-8 BOM removal.

## Contract

Every item has `source_key` (SHA-256 hex), `title`, `filename`, `content` (UTF-8 bytes),
`media_type` (`text/markdown`), nullable `source_url`, `relative_path`, `wiki_links`,
and `metadata`. Failed items additionally have `error` and `input_path`; their output
path is a safe placeholder. Never persist failed items as notes.

Keys use the canonical source namespace and original relative input path; bookmarks
use their URL. ENEX/flomo use source path plus note title/date/body or date/body because
exports lack reliable native IDs. Reordering input files does not change keys. Moving
or renaming files, changing ENEX/flomo body/date, or renaming the outer ZIP changes keys.
Repeated identical notes may share a key; the integrating service chooses deduplication.
ZIP output paths retain an outer-archive stem and all internal directory names. Conversion
collisions append a stable hash to **both** names. Original local links are retained;
resolving rewritten collision paths belongs to the integration layer.

## Formats and limits

| Source | Accepted input | Preserved information / limitations |
| --- | --- | --- |
| `chrome` (`chrome_bookmarks`, `bookmarks`) | Netscape bookmark HTML | HTTP(S) URL, anchor title, add/modified dates and tags; no fetch; folder hierarchy is not reconstructed |
| `markdown` (`obsidian`, `apple_notes`) | .md/.markdown/.txt or ZIP of folder | original Markdown, first level-one heading, wiki targets including embeds; raw frontmatter and simple one-line tags/date fields; no YAML dependency |
| `enex` (`evernote`) | .enex | note title, ENML text/links/checklists, tags, dates, source URL, resource descriptors; embedded resources are represented by `enex-resource:<hash>` links, not decoded |
| `notion` | ZIP, .html/.md/.txt | headings, relative links/images, HTML property table, multi-select tags and exported creation/edit times; two ZIP levels; CSV databases and attachments are not converted |
| `flomo` | export HTML | each `.memo` / `.content` / `.time`, hashtag tags and timestamps |
| `keep` (`google_keep`) | Takeout ZIP, .json/.html | text/checklists, labels, raw microsecond dates, flags and attachment paths; valid JSON supersedes same-path HTML; invalid JSON emits an error and HTML can still succeed |

HTML conversion is deliberately small: paragraphs, headings, links/images, emphasis,
code and lists. It is not a full fidelity layout/table converter. Keep HTML alone preserves
content/title/label nodes; raw timestamps are available from JSON, not inferred from
localized HTML. Apple Notes requires an existing Markdown export; no native database access.
Non-note assets are skipped, their links remain in content; callers retain uploaded assets
if they want later attachment handling. Nested ZIP attachment files may be interpreted as
exports within the depth limit. UTF-8 text is required. Empty Markdown and empty HTML fail.

Per file: 16 MiB; aggregate compressed inputs plus expanded members: 64 MiB; count:
2,000 inputs/members; ZIP depth: two levels; HTML nesting: 128. ZIPs are preflighted before
reading members and never extracted to disk. Absolute/drive/parent-traversal paths,
symlinks, encrypted ZIPs and excessive expansion are rejected. An unsafe archive produces
one failure and no notes from that archive; independent safe files can still succeed.
Internal XML DTD/entity declarations are rejected; external ENEX DTDs are not fetched.
Malformed XML fails the ENEX file; valid XML notes with invalid/missing content fail
individually. Parsing does not authorize/render/sanitize original Markdown or fetch links.

## Verification

```sh
PYTHONPATH=backend/src python3 -m unittest discover -s backend/tests -p test_import_sources.py
ruff check backend/src/qunxue_api/adapters/import_sources backend/tests/test_import_sources.py
```

17 focused tests cover structural fixtures for all six sources, Chinese, attachment and
wiki links, stable identities, collision ordering, partial errors, Keep fallback, nested
ZIPs, traversal, symlinks, oversized members and HTML nesting. Fixtures are synthetic,
modeled on export structures, with no private user data. No full-repository tests, real
models, browser, database, or deployment were run.

## License / research record

Reviewed upstream format handling in [obsidianmd/obsidian-importer](https://github.com/obsidianmd/obsidian-importer)
(MIT, copyright Obsidian): [license](https://github.com/obsidianmd/obsidian-importer/blob/master/LICENSE),
[Notion ZIP handling](https://github.com/obsidianmd/obsidian-importer/blob/master/src/formats/notion.ts),
[Notion metadata](https://github.com/obsidianmd/obsidian-importer/blob/master/src/formats/notion/parse-info.ts).
Useful observations: keep full directory paths, treat HTML/Markdown separately, preserve
property timestamps, and distinguish notes from attachments. The upstream Notion importer
supports HTML exports and rejects Markdown exports; this implementation also passes through
Markdown. No upstream code or fixture was copied or vendored; no third-party license text
needs bundling for these independently implemented parsers. No AGPL implementation was used.
Existing `markdown-it-py` is MIT licensed and remains an unchanged project dependency.
