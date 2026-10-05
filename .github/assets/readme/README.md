# README visual assets / README 视觉素材

Only public website content or explicitly synthetic demonstration data may appear in these files. Do not add personal libraries, conversations, account details, credentials, or production database exports.

## Character banner

- File: `everplain-companions.svg`
- Source revision: `4f2d580f3ac752303dee19d8c4400616069872cf`
- Original sources: `frontend/src/modules/user-avatar/avatar-data.ts`, `avatar-layers.ts`, and `frontend/src/modules/companion/companion.css`
- Selected original character IDs, left to right: `sand`, `mo`, `xiaoping`, `hime`, `cat`
- Method: deterministically compose the original SVG paths and preset colors, resolve the existing styles, and freeze animation into a static pose. The file has no background rectangle and no external image, font, or script dependency. No generative image model was used.
- Layout reference inspected: [huyanxius/Windup character-journey.webp](https://github.com/huyanxius/Windup/blob/main/.github/assets/readme/character-journey.webp). Only the idea of a wide character-led composition was used; no Windup image pixels or character artwork were copied.
- Rebuild from the repository root: `python3 .github/assets/readme/render_companions.py` (Python 3 and Node.js 22.18+).
- Validation: XML parse, unique SVG IDs, local reference resolution, a raster render inspected at 2240 × 572, and transparent corner pixels verified.

This is a brand illustration, not a product screenshot.

## Public website capture

- File: `welcome-20261005.jpg`
- Source URL: <https://e.qunxue.xyz/welcome>
- Captured: 2026-10-05, approximately 18:22 UTC
- Browser: supported cloud Chrome browser; native JPEG viewport screenshot
- Image dimensions: 1165 × 747 pixels; no replacement UI, painted text, or AI-generated pixels
- Content: public landing page only. No private workspace content was saved in this asset.
- Website animations are built-in product demonstrations, not model-run evidence.
- The online deployment SHA was not independently attested during this capture. The source baseline for this README review is `4f2d580f3ac752303dee19d8c4400616069872cf`; this is not a claim that every change at that SHA had already deployed.

## Core application screenshots

Captured in an isolated local instance of the real, unmodified Everplain frontend and backend. No production account, database, environment file, or personal browser profile was used. Original PNG bytes are included unchanged.

- Application revision: `981915939868c73350a49dba6551624f2da467eb`
- Browser: installed macOS Google Chrome, isolated headless context
- Runtime: `mock`, temporary SQLite, background import/graph workers disabled; no model calls or fabricated model replies
- Synthetic source material: [demo-materials/](demo-materials/), four original Markdown files clearly labeled as demonstration material
- Original dimensions: 1440 × 1000 for all three captures
- Page errors: none reported by the capture run
- Temporary browser context, API, and Vite services were closed after capture

| File | Route | Captured at (UTC, 2026-10-05) | SHA-256 |
| --- | --- | --- | --- |
| `everplain-demo-library.png` | `/library` | 19:35:15.937936 | `98db30f09a3cc5682adaa4e29021a284e0d884f48cae8f9c579877b0e25b7b6b` |
| `everplain-demo-document.png` | `/library?kb_id=a781e79f-fce9-4f29-a1da-8f961487caa3&document_id=70df5121-ee4a-4073-a535-60adae4a21cc` | 19:35:18.825407 | `09ffcb636bdb0d6615b315be532c6902de6048da717e68df4e0967993681bda9` |
| `everplain-demo-writing.png` | `/writing/2c00f6a4-679a-4baf-87af-bda2422873bc` | 19:35:21.735424 | `6e727694b9a5d0f6af9aa00ec3939cb5e2db8e4013db8f10effb5399903b1f03` |

The library and source-reader screenshots retain real pending indexing/knowledge-processing states. The writing screenshot shows manually authored synthetic content in the real editor. These images are UI evidence only, not evidence of completed AI processing or a claim that every README feature is visible. The screenshots represent their recorded application revision, independently of the revision used to prepare the README.

[Machine-readable capture record](screenshot-evidence.json).

## Editing policy

Retake screenshots when the visible product changes. Record the route, capture time, application revision when verifiable, and synthetic data provenance. Capturing a UI does not prove model quality, provider connectivity, or full end-to-end behavior. Do not substitute drawn mockups for screenshots.
