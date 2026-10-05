import asyncio
import logging
from contextlib import asynccontextmanager, suppress

import uvicorn
from fastapi import FastAPI, HTTPException, Request
from pydantic import ValidationError

from .config import Settings
from .ingress import feishu_callback, telegram_event
from .store import EventConflict, QueueFull, Store, SubjectBusy
from .transport import Transports
from .worker import Worker


async def read_body(request):
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > 128 * 1024:
            raise HTTPException(413, "Payload too large")
    return bytes(body)


def create_app(settings=None, *, store=None, worker=None, start_workers=True):
    settings = settings or Settings()
    store = store or Store(settings.database_path, max_pending=settings.max_pending)

    @asynccontextmanager
    async def lifespan(app):
        active = worker or Worker(settings, store, Transports(settings))
        tasks = (
            [asyncio.create_task(active.run_inbox()),
             asyncio.create_task(active.run_inbox(control=True)),
             asyncio.create_task(active.run_outbox())]
            if start_workers
            else []
        )
        try:
            yield
        finally:
            for task in tasks:
                task.cancel()
            for task in tasks:
                with suppress(asyncio.CancelledError):
                    await task
            await active.close()

    app = FastAPI(
        title="Everplain channel gateway", lifespan=lifespan, docs_url=None, redoc_url=None
    )
    app.state.store = store

    @app.post("/webhooks/telegram")
    async def telegram(request: Request):
        body = await read_body(request)
        try:
            event = telegram_event(
                body, request.headers.get("x-telegram-bot-api-secret-token"), settings
            )
            if event:
                store.enqueue(event)
        except (ValidationError, ValueError, KeyError, TypeError):
            raise HTTPException(400, "Invalid platform message") from None
        except EventConflict:
            raise HTTPException(409, "Conflicting delivery") from None
        except SubjectBusy:
            raise HTTPException(429, "Sender limit", headers={"Retry-After": "30"}) from None
        except QueueFull:
            raise HTTPException(503, "Inbox full", headers={"Retry-After": "30"}) from None
        return {"accepted": True}

    @app.post("/webhooks/feishu")
    async def feishu(request: Request):
        body = await read_body(request)
        try:
            return feishu_callback(body, request.headers, settings, store.enqueue)
        except (ValueError, KeyError, TypeError, AttributeError):
            raise HTTPException(400, "Invalid platform message") from None

    @app.get("/health")
    def health():
        # Connectivity is not asserted. Counts make dead/ambiguous work observable
        # without exposing prompt text, platform IDs, secrets or account identity.
        return {"status": "local-ready", "release_revision": settings.release_revision,
                "queues": store.counts()}

    return app


def main():
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    uvicorn.run(create_app(), host="127.0.0.1", port=8298, access_log=False)


if __name__ == "__main__":
    main()
