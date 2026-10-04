"""Production gateway with official SDK API endpoints pointed at a loopback fixture."""

import asyncio
import os
from contextlib import asynccontextmanager, suppress
from pathlib import Path

import lark_oapi as lark
import uvicorn
from aiogram import Bot
from aiogram.client.session.aiohttp import AiohttpSession
from aiogram.client.telegram import TelegramAPIServer

from everplain_gateway.config import Settings
from everplain_gateway.main import create_app
from everplain_gateway.store import Store
from everplain_gateway.transport import Transports
from everplain_gateway.worker import Worker

if os.environ.get("EVERPLAIN_GATEWAY_CONTRACT_TEST") != "1":
    raise RuntimeError("This synthetic fixture must never be used as a production gateway")

backend_url = f"http://127.0.0.1:{os.environ['FIXTURE_BACKEND_PORT']}"
settings = Settings(
    database_path=Path(os.environ["FIXTURE_GATEWAY_DATABASE"]),
    backend_url=backend_url,
    telegram_token="123:" + "synthetic" * 5,
    telegram_webhook_secret="fixture_" * 6,
    telegram_backend_secret="synthetic-gateway-secret-not-a-real-credential",
    feishu_app_id="cli_test",
    feishu_app_secret="synthetic-app-secret",
    feishu_encrypt_key="encrypt-fixture",
    feishu_verification_token="verify-fixture",
    feishu_tenant_key="tenant_test",
    feishu_backend_secret="synthetic-gateway-secret-not-a-real-credential",
)
store = Store(settings.database_path)
transports = object.__new__(Transports)
transports.telegram = Bot(
    settings.telegram_token.get_secret_value(),
    session=AiohttpSession(
        api=TelegramAPIServer.from_base(backend_url),
        timeout=5,
    ),
)
transports.feishu = (
    lark.Client.builder()
    .app_id(settings.feishu_app_id)
    .app_secret(settings.feishu_app_secret.get_secret_value())
    .domain(backend_url)
    .timeout(5)
    .build()
)
worker = Worker(settings, store, transports)
app = create_app(settings, store=store, worker=worker, start_workers=False)
mode = os.environ.get("FIXTURE_GATEWAY_MODE", "all")


@asynccontextmanager
async def lifespan(_app):
    tasks = []
    if mode in {"all", "inbox_only"}:
        tasks.append(asyncio.create_task(worker.run_inbox()))
    if mode == "all":
        tasks.append(asyncio.create_task(worker.run_outbox()))
    try:
        yield
    finally:
        for task in tasks:
            task.cancel()
        for task in tasks:
            with suppress(asyncio.CancelledError):
                await task
        await worker.close()


app.router.lifespan_context = lifespan
if __name__ == "__main__":
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=int(os.environ["FIXTURE_GATEWAY_PORT"]),
        access_log=False,
        log_level="warning",
    )
