# Media import adapters (#10)

`qunxue_api.adapters.media_import` is an independent synchronous adapter package.
It does not change bootstrap, routes, SQLite, SDK, UI, or existing text model requests.
The import batch owner must invoke it, enforce ownership and batch limits, and persist
only the returned UTF-8 text. Do not run blocking providers on the HTTP event loop.

## Public interface

- `BilibiliFavoritesAdapter(...).enumerate_public_favorites(uid: str | int) -> FavoritesReport`
- `VideoImportAdapter(...).import_video(url: str) -> ImportResult`
- `ImageImportAdapter(...).import_image(filename=..., media_type=..., content=bytes,
  source_url=None, relative_path=None) -> ImportResult`

`ImportItem` fields match the batch boundary: `source_key`, `title`, `filename`,
`content: bytes` (UTF-8), `media_type`, `source_url`, `relative_path`, `wiki_links`,
`metadata`. `ImportResult` contains exactly one `item` or `error`; `ImportError`
contains `source_key`, machine-readable `code`, a safe `message`, and `metadata`.
`FavoritesReport` contains `folders`, deduplicated metadata `items`, individual
`errors`, and `notices`. A report can contain successes and failures together.

Favorites items have `metadata.text_source == "metadata"`: they are discovery
records, not transcripts. Root should call `import_video(item.source_url)`, preserve
collection metadata, and replace the metadata text with the successful transcript.
Do not silently mark a failed transcript as successfully imported video content.
`source_key` is `bilibili:<BV/av id>`, with `-p<N>` for explicit parts beyond part 1.
Image keys use a content SHA-256; returned image filenames end in `.txt`.

## Public favorites

The adapter uses anonymous `created/list-all` and `resource/list` requests with
20 items per page, follows `has_more`, and reports the configurable page limit
(default 500) as a partial result. It deduplicates video identifiers and preserves
folder memberships. Deleted entries, unsupported media types, private folders,
API refusals and malformed pages are reported separately. A fresh HTTP client per
request prevents response cookies from being forwarded to subsequent pages.

Private folders may be omitted entirely by the anonymous API; the notice describes
that limitation without claiming their count. Anonymous API behavior and anti-bot
restrictions are not guaranteed. No login fallback or Cookie/SESSDATA config exists.

## Subtitle-first videos and temporary audio

`YtDlpSubtitleProvider` invokes a separately installed, trusted `yt-dlp` executable.
It ignores user config, browser/file cookies, default plugin directories and disk
cache. `--no-simulate --skip-download` allows subtitle writes while excluding media
downloads; `--dump-json` collects metadata. It requests Chinese/English VTT/SRT/JSON
subtitles and takes the first usable Chinese-preferred track. Other language
selection and whole multi-part expansion are not implemented. Pass an explicit
`?p=N` URL to import one part; playlist/multi-video results fail explicitly.

The built-in `BilibiliTemporaryAudioProvider` reads public video/CID and DASH
metadata, picks an audio/mp4 track, streams at most 25 MB from HTTPS Bilibili CDN
hosts into `audio.m4a`, and rejects redirects and non-audio responses. It never
uses yt-dlp for audio or video. Acquisition is explicitly injected into
`VideoImportAdapter`; root can provide another trusted `TemporaryAudioProvider`.
That port must fetch audio only into the supplied temporary directory.

A dedicated injected `TranscriptionProvider` is required when subtitles are absent.
Its structural interface matches the existing transcription port:
`available` and `transcribe(filename=..., media_type=..., content=bytes)` returning
an object with `.segments[*].text`. Audio exists only in a private temporary directory
and memory for the transcription call; the directory is removed on success and
failure. Returned metadata never contains audio bytes, signed CDN URLs or raw
subprocess/provider errors. No transcript means `empty_transcript`, not metadata
substitution. Root owns external processing disclosure and production configuration.

## Vision gateway

`OpenAICompatibleVisionProvider(base_url=..., model=..., api_key=None, ...)` is a
separate opt-in gateway instance using Chat Completions text/image content parts
and a base64 data URL. It requests JSON `text` and `description`, validates those
fields, and returns text plus description to the importer. It accepts PNG/JPEG/WebP/GIF
up to 20 MB through `ImageImportAdapter`. Root must provide a dedicated vision
configuration (e.g. EVERPLAIN_VISION_*); this adapter reads no environment variables
and never borrows text-model or other-product keys. A provider without a key is
only for explicitly configured services supporting anonymous/local access.

No provider gives `vision_not_configured`; missing transcription gives
`transcription_not_configured`; missing audio acquisition gives `audio_not_configured`;
missing yt-dlp gives `yt_dlp_not_configured`. None of these is a successful mock.
The vision capability is deliberately isolated rather than added to the existing
research-specific model port; root can assemble it without changing text requests.

## Evidence and references

Tests use inline fixtures, fake subprocess output and `httpx.MockTransport` only.
No real UID, Bilibili retrieval, transcription service or paid vision model was
called. No credentials were read. Run the isolated tests with Python 3.12+ and httpx:

```sh
PYTHONPATH=backend/src python -m unittest discover -s backend/tests -p test_media_import.py
ruff check --config backend/pyproject.toml backend/src/qunxue_api/adapters/media_import backend/tests/test_media_import.py
```

Implementation references:

- [yt-dlp official README](https://github.com/yt-dlp/yt-dlp/blob/master/README.md),
  subtitle, simulation, config and cookie options.
- [Bilibili API collect favorites folder documentation](https://github.com/BACNext/bilibili-API-collect-backup/blob/master/docs/fav/info.md)
  and [resource pagination documentation](https://github.com/BACNext/bilibili-API-collect-backup/blob/master/docs/fav/list.md),
  community-maintained API documentation rather than a Bilibili service guarantee.
- [OpenAI image input guide](https://developers.openai.com/api/docs/guides/images-vision),
  image content parts and base64 input. Compatibility depends on the configured provider.
