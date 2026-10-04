import asyncio
import logging
import time

import httpx

from .transport import DeliveryAmbiguous, DeliveryPermanent, RetryLater

logger = logging.getLogger(__name__)
SAFE_FAILURE = "这条消息暂时无法处理。请检查 Everplain 绑定、账号和用量；需要时重新发送。"


class Worker:
    def __init__(self, settings, store, transports, *, client=None):
        self.settings, self.store, self.transports = settings, store, transports
        self.client = client or httpx.AsyncClient(
            base_url=settings.backend_url,
            timeout=httpx.Timeout(330, connect=10),
            follow_redirects=False,
            trust_env=False,
        )

    async def close(self):
        await self.client.aclose()
        await self.transports.close()

    async def process_inbox(self):
        row = self.store.claim_inbox()
        if row is None:
            return False
        try:
            self.store.progress(row)
            response = await self.client.post(
                "/api/channel-gateway/dispatch",
                json=row["event"],
                headers=self.settings.backend_headers(row["event"]["platform"]),
            )
            if response.status_code == 200:
                result = response.json()
                if result.get("event_key") != row["key"] or not isinstance(result.get("text"), str):
                    raise ValueError("Invalid backend result")
                self.store.complete_inbox(row, result["text"])
            elif response.status_code in {429, 503} or response.status_code >= 500:
                self._retry_inbox(row, response.headers.get("retry-after"))
            elif response.status_code in {401, 403, 402, 404, 409, 422}:
                # Fixed text only, never pass raw upstream exceptions to a platform.
                self.store.complete_inbox(row, SAFE_FAILURE, require_auth=False)
            else:
                self.store.retry_inbox(row["key"], attempt=row["attempts"], delay=0, dead=True)
        except Exception as exc:
            logger.warning("Inbox attempt failed: %s", type(exc).__name__)
            self._retry_inbox(row)
        return True

    def _retry_inbox(self, row, retry_after=None):
        try:
            delay = (
                max(1, min(float(retry_after), 3600))
                if retry_after
                else min(2 ** row["attempts"], 60)
            )
        except ValueError:
            delay = 60
        dead = row["attempts"] >= self.settings.max_attempts or time.time() - row["created"] > 86400
        if dead:
            self.store.fail_inbox(row)
        else:
            self.store.retry_inbox(row["key"], attempt=row["attempts"], delay=delay)

    async def process_outbox(self):
        row = self.store.claim_outbox()
        if row is None:
            return False
        try:
            if row["require_auth"]:
                try:
                    check = await self.client.get(
                        f"/api/channel-gateway/events/{row['event_key']}/delivery",
                        headers=self.settings.backend_headers(row["platform"]),
                    )
                    if check.status_code != 200:
                        raise RetryLater()
                    if check.json().get("allowed") is not True:
                        self.store.finish_outbox(row["id"], "suppressed", attempt=row["attempts"])
                        return True
                except httpx.HTTPError:
                    raise RetryLater() from None
            remote_id = await self.transports.send(row)
            self.store.finish_outbox(
                row["id"], "sent", attempt=row["attempts"], remote_id=remote_id
            )
        except RetryLater as exc:
            state = "dead" if row["attempts"] >= self.settings.max_attempts else "pending"
            self.store.finish_outbox(
                row["id"], state, attempt=row["attempts"], delay=max(1, min(exc.seconds, 3600))
            )
        except DeliveryPermanent:
            self.store.finish_outbox(row["id"], "dead", attempt=row["attempts"])
        except DeliveryAmbiguous:
            self.store.finish_outbox(row["id"], "ambiguous", attempt=row["attempts"])
        except Exception as exc:
            logger.warning("Outbox attempt failed: %s", type(exc).__name__)
            # Unknown failures may occur after submission; never blindly repeat.
            self.store.finish_outbox(row["id"], "ambiguous", attempt=row["attempts"])
        return True

    async def run_inbox(self):
        while True:
            try:
                if not await self.process_inbox():
                    await asyncio.sleep(0.5)
            except Exception as exc:
                logger.error("Inbox worker unavailable: %s", type(exc).__name__)
                await asyncio.sleep(5)

    async def run_outbox(self):
        while True:
            try:
                if not await self.process_outbox():
                    await asyncio.sleep(0.5)
            except Exception as exc:
                logger.error("Outbox worker unavailable: %s", type(exc).__name__)
                await asyncio.sleep(5)
