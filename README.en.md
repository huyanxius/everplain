<div align="center">
  <img src="frontend/src/assets/qunxue-brand-mark.svg" alt="Everplain logo" width="64" />
  <h1>Everplain</h1>
  <p><strong>Turn scattered material into knowledge you can keep thinking with.</strong></p>
  <p>A personal knowledge library · Source-grounded AI conversations · Research and writing</p>
  <p><a href="README.md">简体中文</a> · <strong>English</strong></p>
  <p>
    <a href="https://e.qunxue.xyz"><strong>Try it online: https://e.qunxue.xyz</strong></a>
    · <a href="https://github.com/huyanxius/everplain/issues">Issues and ideas</a>
    · <a href="docs/README.md">Documentation</a>
  </p>
  <p>
    <a href="https://github.com/huyanxius/everplain/actions/workflows/ci.yml"><img src="https://github.com/huyanxius/everplain/actions/workflows/ci.yml/badge.svg" alt="Live GitHub Actions CI status" /></a>
    <a href="backend/pyproject.toml"><img src="https://img.shields.io/badge/Python-3.12%2B-3776AB?logo=python&amp;logoColor=white" alt="Python 3.12 or newer" /></a>
    <a href="frontend/package.json"><img src="https://img.shields.io/badge/React-19-149ECA?logo=react&amp;logoColor=white" alt="React 19" /></a>
    <a href="docs/DISTRIBUTION.md"><img src="https://img.shields.io/badge/deployment-self--hosted-66728A" alt="Self-hosting available" /></a>
  </p>
  <img src=".github/assets/readme/everplain-companions.svg" width="100%" alt="Five original Everplain characters, sand, mo, xiaoping, hime and cat, together on a transparent background" />
</div>

Everplain brings collecting, reading, retrieval, research, and writing into one workspace. Start with a PDF, a collection of bookmarks, or your own notes. Ask questions about your material, follow citations back to the source, and develop your ideas into editable, exportable documents.

Your material belongs to your account by default. Customize your AI's name, appearance, speaking style, and memory, with a separate appearance for yourself. The workspace is designed for long-term learning and revisiting ideas across subjects.

[Features](#what-you-can-do) · [Imports](#bring-your-material) · [Screenshots](#see-the-interface) · [Quick start](#local-quick-start) · [Deployment](#self-hosting) · [Contributing](#contributing)

## What you can do

| Workflow | Capabilities implemented in the current code |
| --- | --- |
| **Collect and read** | Private libraries; PDF, DOCX, PPTX, Markdown, and TXT uploads; bookmarks, exported notes, and images; item-level processing status, failure reasons, and retries; source reading |
| **Organize and connect** | Knowledge entries and relationships; a personal knowledge graph; exploration by document, topic, and knowledge item; navigation from graph nodes and citations to sources; visibility into unfinished processing |
| **Ask about your material** | Choose your knowledge libraries for multi-turn conversations; retrieval, web research, and tools according to deployment capabilities; persistent conversations, execution progress, and clickable citations |
| **Continue research** | Build research projects around a question; organize material, plans, a research canvas, and chapter-based documents; reopen saved work |
| **Write and revise** | Official documents, reports, formal writing, fiction, and essays; writing samples and style references; rich-text/Markdown editing; streamed AI proposals, diff review, and explicit acceptance; saved versions and exports |
| **Make the AI yours** | Seven AI companion presets, names, and colors; free-form speaking preferences (Soul); inspect, adjust, and delete memories; six separate user appearances with hair, skin, and clothing colors |
| **Manage accounts and operations** | Email-code registration and password sign-in; optional Google/GitHub sign-in and account linking; account data export/deletion; administrator controls for users, usage, and quotas; backup and restore tools |

These descriptions reflect the implementation on `main`. Hosted availability also depends on the deployed revision, account permissions, and service configuration. Merged code, a visible interface, a real model call, and an end-to-end verified workflow are distinct milestones.

The writing workspace currently exports Markdown. Research documents have a separate DOCX and print/PDF export workflow. These formats are not interchangeable across the two entry points. Always review generated content, citations, and inferences.

## Bring your material

| Source | Available route and limits |
| --- | --- |
| Files | Upload PDF, DOCX, PPTX, Markdown, or TXT; scanned PDFs need extractable text first |
| Chrome / Edge | The [clipper](extensions/clipper/README.md) saves the current page or selected bookmarks/folders; bookmark HTML imports are also available. The extension is currently sideloaded from a ZIP, not listed in a browser store |
| Obsidian / Markdown | Select a notes directory or upload files/a ZIP; preserve folders, wiki links, and supported attachments, with change-aware reimports. This is not continuous background sync |
| Notion | Upload an HTML or Markdown export; this is not direct Notion account access or a promise of complete database and attachment fidelity |
| Apple Notes | Upload an existing Markdown, TXT, or ZIP export; no direct access to an Apple account or the native Notes database |
| Evernote / flomo / Google Keep | ENEX, flomo HTML, and Google Takeout ZIP/JSON/HTML respectively; see the [parser documentation](docs/IMPORT_PARSERS.md) for conversion limits |
| Images and screenshots | PNG, JPEG, WebP, and GIF; text extraction needs a dedicated vision model and reports a reason when unavailable |
| Public Bilibili favorites | Read anonymously accessible titles, descriptions, and source links by public UID; no login cookies, and metadata is not represented as a video transcript |

External sites may restrict article retrieval. An accepted import does not mean every item has finished parsing, indexing, or knowledge extraction. Audio/video transcription requires configured services and accessible audio or subtitles; arbitrary platforms and private videos are not guaranteed.

## See the interface

These three are **actual Chrome screenshots of the application**, using an isolated local instance and original synthetic demo material. They contain no private account, conversation, or library content. The application revision is [`9819159`](https://github.com/huyanxius/everplain/commit/981915939868c73350a49dba6551624f2da467eb), captured on 2026-10-05 at 19:35 UTC. Each original image is 1440 × 1000.

### 1. Collect material in your library

Three demo Markdown notes have been saved, with their type, size, and individual processing status visible. The pending knowledge-extraction and semantic-indexing states are preserved rather than shown as completed.

![Actual local library with three clearly marked demo notes and pending processing states](.github/assets/readme/everplain-demo-library.png)

### 2. Return to the source with context

Open the stored text, headings, and segment locations. The knowledge panel also accurately reports that processing is unfinished.

![Actual source reader displaying a synthetic city-walk note with headings and segment locations](.github/assets/readme/everplain-demo-document.png)

### 3. Develop observations into a document

The native writing editor shows headings, paragraphs, lists, genre, saved state, and the Markdown export control. The text was written for this demonstration, not presented as a verified model-generated result.

![Actual writing workspace with a saved demo document, native toolbar, and Markdown export](.github/assets/readme/everplain-demo-writing.png)

These captures demonstrate the displayed interfaces, not every capability described in this README. The demo instance made no model calls, so these images do not constitute real-model verification of semantic organization, research, or AI revisions. See the [original demo material, provenance, and checksums](.github/assets/readme/README.md).

<details>
<summary>Public website entry point</summary>

This actual browser capture of the public website was taken on 2026-10-05 and contains no private material. The website's library and conversation animations are product demonstrations.

![Everplain public homepage with its brand, conversation entry point, and original characters](.github/assets/readme/welcome-20261005.jpg)

</details>

The transparent character banner at the top reuses the repository's original SVG layers. It is brand artwork, not a product screenshot.

## Local quick start

Requires Git, GNU Make, Python 3.12+, [uv](https://docs.astral.sh/uv/), Node.js 22.18+, and npm.

```bash
git clone https://github.com/huyanxius/everplain.git
cd everplain
make bootstrap
cp backend/.env.example backend/.env
```

Configure `backend/.env` in a private editor. For local HTTP development, set `EVERPLAIN_SESSION_COOKIE_SECURE=false` and `EVERPLAIN_CORS_ALLOWED_ORIGINS=["http://localhost:5196"]`. Configure a separate initial administrator when controlled first access is needed. Do not reuse another product's accounts, database, or credentials.

Run these commands in separate terminals:

```bash
make dev-api
```

```bash
make dev-web
```

- Web: <http://localhost:5196>
- API: <http://127.0.0.1:8297>
- Health check: <http://127.0.0.1:8297/api/health>
- Default local database: `backend/var/everplain.db`

Real AI research requires a chat model, embeddings, a reranker, and web search. Registration email, transcription, image recognition, and third-party sign-in each need their own configuration. A running page or healthy process does not verify those services. [Development guide](docs/onboarding.md) · [Environment template](backend/.env.example) · [OAuth configuration](docs/OAUTH_LOGIN.md). Most detailed engineering documents are currently in Chinese.

## Self-hosting

The repository includes a FastAPI API, Nginx-served Web application, an isolated Docker Compose project, production preflight checks, consistent SQLite backups, and restore-to-new-target tools. Follow the [deployment, backup, and recovery guide](docs/DISTRIBUTION.md). The hosted service is **[https://e.qunxue.xyz](https://e.qunxue.xyz)**; use your own domain and isolated data for a self-hosted instance.

The current deployment architecture is a single instance with one API worker. Production startup must pass `ops/preflight.py`; HTTPS, provider connectivity, account isolation, email delivery, and recovery must also be verified in the target environment. Deployment tooling is not evidence that a new environment has passed those checks.

### Current limits

- Model and retrieval availability depends on configuration and available quota; model names shown on the website do not mean every model is callable.
- Membership purchases, online top-ups, and automatic subscription charges are not established live capabilities.
- A native Android test build is available, with the research workspace still being developed. See [installation and releases](https://github.com/huyanxius/everplain/releases).
- Upcoming integrations such as WeChat favorites are not listed as delivered features in this README.
- Cross-instance high availability, large-scale capacity guarantees, and third-party security certification are not claimed.

### Privacy and security

Private material, conversations, research, and documents are ownership-scoped. A private knowledge library does not mean content never leaves the server: configured AI, retrieval, email, and speech providers receive the data needed for the requested operation. Operators are responsible for credentials, database and backup access, encryption, and retention.

Read the [security and privacy boundaries](docs/SECURITY.md). Do not put source documents, databases, cookies, tokens, or complete environment files in public issues. Confirm a private reporting channel with the maintainer before sharing vulnerability details.

## Technical structure

- **Web:** React 19, TypeScript, Vite 8, TanStack Query, Tiptap, Cytoscape
- **API / AI:** Python 3.12+, FastAPI, PydanticAI, SQLAlchemy, Alembic
- **Data and deployment:** SQLite, Docker Compose, Nginx, GitHub Actions
- **Other clients:** a Manifest V3 browser extension, an Android test client, and an optionally configured channel gateway

```text
frontend/src/app/       Pages, routes, and interaction
frontend/src/modules/   Product capabilities and public module interfaces
backend/src/qunxue_api/
  modules/             Business rules
  application/         Cross-module orchestration
  api/                 HTTP contracts and authentication
  adapters/            Storage, models, and external services
extensions/clipper/    Browser clipper
ops/                   Deployment, preflight, backup, and recovery
```

`qunxue_api` is an internal package name retained for compatibility. Everplain's product, configuration, data, and deployment remain independent. [Architecture](docs/ARCHITECTURE.md).

## Contributing

Start with an [issue](https://github.com/huyanxius/everplain/issues), read [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md), and follow `Issue → branch → atomic commit → PR → main`.

```bash
# Regenerate only when the API contract changes
make contract

# Choose checks according to the impact of your changes
make check-backend
make check-frontend

# Deterministic deployment-script checks
backend/.venv/bin/python -m unittest discover -s ops/tests -v
```

Use `make check` when shared-boundary changes cannot be verified more narrowly; documentation edits do not need a repeated full build. Record checks actually run and distinguish static checks, tests, real model calls, browser checks, and production verification. The CI badge points to a real workflow, not a guarantee of end-to-end coverage for every path.

### Licensing and third-party assets

This repository currently has **no declared project-level open-source license**. Public visibility is not a grant of unrestricted use, modification, or redistribution. Ask the maintainer about authorization before adopting or redistributing it. Third-party dependencies and assets retain their own licenses; see [third-party notices](docs/third-party-notices.md).
