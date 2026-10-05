# Isolated acceptance services

These files are test-only and are not packaged into the gateway container or Python wheel.
The two real application processes use different locked Python environments and communicate over loopback HTTP. Platform callbacks are synthetic; the actual aiogram and lark-oapi SDKs send to local protocol endpoints. The model edge is synthetic, while account/session checks, Agent conversation execution, SQLite and usage accounting are real application code.

Run from the repository root after syncing both projects:

    gateway/.venv/bin/pytest gateway/integration/test_http_contract.py

The fixture creates temporary databases and fake accounts. It never borrows production configuration or user sessions. Run its browser companion only in an authorized isolated test environment. The browser suite disables screenshots, traces and video and blocks external browser requests.

Covered: webhook commit before ACK, concurrent duplicates, restart before execution, backend persistence across restart, platform answer matching saved conversation, one usage charge, rate-limit retries without model reruns, Telegram ambiguous sends, revoked multipart output, encrypted Feishu callbacks and stable UUID retry.
