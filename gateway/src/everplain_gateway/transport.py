"""Maintained SDK clients own platform API details; the outbox owns delivery policy."""

import json
from uuid import UUID

import lark_oapi as lark
from aiogram import Bot
from aiogram.exceptions import (
    TelegramAPIError,
    TelegramNetworkError,
    TelegramRetryAfter,
    TelegramServerError,
)
from lark_oapi.api.im.v1 import CreateMessageRequest, CreateMessageRequestBody
from lark_oapi.core.log import logger as lark_logger

# The upstream event logger includes raw bodies/headers even at exception level.
# The gateway logs only its own sanitized state/error class counters.
lark_logger.disabled = True


class RetryLater(Exception):
    def __init__(self, seconds=5):
        self.seconds = seconds


class DeliveryAmbiguous(Exception):
    pass


class DeliveryPermanent(Exception):
    pass


class Transports:
    def __init__(self, settings):
        self.telegram = (
            Bot(settings.telegram_token.get_secret_value()) if settings.telegram_token else None
        )
        self.feishu = (
            lark.Client.builder()
            .app_id(settings.feishu_app_id)
            .app_secret(settings.feishu_app_secret.get_secret_value())
            .build()
            if settings.feishu_app_id
            else None
        )

    async def close(self):
        if self.telegram:
            await self.telegram.session.close()

    async def send(self, row):
        if row["platform"] == "telegram":
            try:
                result = await self.telegram.send_message(
                    chat_id=row["chat_id"],
                    message_thread_id=int(row["thread_id"]) if row["thread_id"] else None,
                    text=row["text"],
                    parse_mode=None,
                    link_preview_options={"is_disabled": True},
                    protect_content=True,
                )
                return str(result.message_id)
            except TelegramRetryAfter as exc:
                raise RetryLater(exc.retry_after) from None
            except (TelegramNetworkError, TelegramServerError):
                # sendMessage has no idempotency key. A lost response is not evidence
                # that Telegram failed to accept the message.
                raise DeliveryAmbiguous() from None
            except TelegramAPIError:
                raise DeliveryPermanent() from None
        body = (
            CreateMessageRequestBody.builder()
            .receive_id(row["chat_id"])
            .msg_type("text")
            .content(json.dumps({"text": row["text"]}, ensure_ascii=False))
            .uuid(str(UUID(row["id"][:32])))
            .build()
        )
        request = (
            CreateMessageRequest.builder().receive_id_type("chat_id").request_body(body).build()
        )
        try:
            response = await self.feishu.im.v1.message.acreate(request)
        except Exception:
            # The same stable UUID will be used on the bounded retry.
            raise RetryLater() from None
        if response.success():
            return response.data.message_id
        status = response.raw.status_code if response.raw else 0
        if status == 429 or response.code in {99991400, 230020}:
            headers = response.raw.headers if response.raw else {}
            try:
                delay = float(headers.get("x-ogw-ratelimit-reset", 5))
            except (TypeError, ValueError):
                delay = 5
            raise RetryLater(max(1, delay))
        if status >= 500:
            raise RetryLater()
        raise DeliveryPermanent()
