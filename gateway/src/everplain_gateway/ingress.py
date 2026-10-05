"""Only verified, unforwarded private user text enters the durable inbox."""

import hashlib
import hmac
import json
import time

import lark_oapi as lark
from aiogram.types import Update
from fastapi import HTTPException
from lark_oapi.core.const import (
    LARK_REQUEST_NONCE,
    LARK_REQUEST_SIGNATURE,
    LARK_REQUEST_TIMESTAMP,
)
from lark_oapi.core.log import logger as lark_logger
from lark_oapi.core.model import RawRequest
from lark_oapi.core.utils import AESCipher

# The SDK logs raw payloads on exceptions; keep only our sanitized state telemetry.
lark_logger.disabled = True


def _check_event(event, now):
    if (
        not event["text"].strip()
        or len(event["text"]) > 16000
        or event["occurred_at"] > now + 300
        or event["occurred_at"] < now - 86400
    ):
        raise HTTPException(400, "Unsupported or expired message")
    for field in ("subject_id", "chat_id", "event_id"):
        if not event[field] or len(event[field]) > 200:
            raise HTTPException(400, "Invalid platform identity")
    return event


def telegram_event(body, secret, settings, *, now=None):
    if not settings.telegram_token:
        raise HTTPException(404)
    if not hmac.compare_digest(
        (secret or "").encode(), settings.telegram_webhook_secret.get_secret_value().encode()
    ):
        raise HTTPException(401, "Invalid webhook authentication")
    received_at_ms = int((time.time() if now is None else now) * 1000)
    update = Update.model_validate_json(body)
    message = update.message
    if (
        message is None
        or message.chat.type != "private"
        or message.from_user is None
        or message.from_user.is_bot
        or message.forward_origin is not None
        or message.sender_chat is not None
        or message.text is None
        or message.chat.id != message.from_user.id
        or not settings.permits_subject("telegram", str(message.from_user.id))
    ):
        return None
    return _check_event(
        {
            "platform": "telegram",
            "bot_id": settings.telegram_bot_id,
            "tenant_id": "",
            "event_id": str(update.update_id),
            "subject_id": str(message.from_user.id),
            "chat_id": str(message.chat.id),
            "thread_id": str(message.message_thread_id or ""),
            "chat_type": "private",
            "occurred_at": int(message.date.timestamp()),
            "received_at_ms": received_at_ms,
            "text": message.text,
        },
        int(time.time() if now is None else now),
    )


def feishu_callback(body, headers, settings, enqueue, *, now=None):
    if not settings.feishu_app_id:
        raise HTTPException(404)
    received_at_ms = int((time.time() if now is None else now) * 1000)
    now = received_at_ms // 1000
    key = settings.feishu_encrypt_key.get_secret_value()
    token = settings.feishu_verification_token.get_secret_value()
    timestamp = headers.get(LARK_REQUEST_TIMESTAMP.lower(), "")
    nonce = headers.get(LARK_REQUEST_NONCE.lower(), "")
    signature = headers.get(LARK_REQUEST_SIGNATURE.lower(), "")
    signed = bool(timestamp or nonce or signature)
    if signed:
        if (
            not timestamp.isdigit()
            or abs(now - int(timestamp)) > 300
            or not nonce
            or len(nonce) > 200
        ):
            raise HTTPException(401, "Invalid webhook authentication")
        expected = hashlib.sha256((timestamp + nonce + key).encode() + body).hexdigest()
        if not hmac.compare_digest(signature.encode(), expected.encode()):
            raise HTTPException(401, "Invalid webhook authentication")
    try:
        envelope = json.loads(body)
        plain = (
            json.loads(AESCipher(key).decrypt_str(envelope["encrypt"]))
            if "encrypt" in envelope
            else envelope
        )
        challenge = plain.get("type") == "url_verification"
        header = plain.get("header") or {}
        actual_token = plain.get("token") if challenge else header.get("token")
    except (ValueError, KeyError, TypeError, AttributeError):
        # Uniform failure before authentication also avoids a CBC padding oracle
        # on Feishu's unsigned, token-authenticated URL verification flow.
        raise HTTPException(401, "Invalid webhook authentication") from None
    if not isinstance(actual_token, str) or not hmac.compare_digest(
        actual_token.encode(), token.encode()
    ):
        raise HTTPException(401, "Invalid webhook authentication")
    if challenge:
        value = plain.get("challenge")
        if not isinstance(value, str) or len(value) > 1024:
            raise HTTPException(400, "Invalid challenge")
        return {"challenge": value}
    if not signed:
        raise HTTPException(401, "Invalid webhook authentication")
    if (
        plain.get("schema") != "2.0"
        or header.get("app_id") != settings.feishu_app_id
        or header.get("tenant_key") != settings.feishu_tenant_key
    ):
        raise HTTPException(403, "Wrong application or tenant")
    if header.get("event_type") != "im.message.receive_v1":
        return {"ignored": True}

    def accept(data):
        sender, message = data.event.sender, data.event.message
        if (
            sender.sender_type != "user"
            or sender.tenant_key != settings.feishu_tenant_key
            or message.chat_type != "p2p"
            or message.message_type != "text"
            or bool(message.thread_id)
            or not settings.permits_subject("feishu", sender.sender_id.open_id)
        ):
            return
        event = _check_event(
            {
                "platform": "feishu",
                "bot_id": settings.feishu_app_id,
                "tenant_id": settings.feishu_tenant_key,
                # Message ID is stable even if the provider generates another delivery event ID.
                "event_id": message.message_id,
                "subject_id": sender.sender_id.open_id,
                "chat_id": message.chat_id,
                "thread_id": message.thread_id or "",
                "chat_type": "private",
                "occurred_at": int(message.create_time) // 1000,
                "received_at_ms": received_at_ms,
                "text": json.loads(message.content)["text"],
            },
            now,
        )
        enqueue(event)  # Commit is synchronous and MUST precede the 2xx ACK.

    handler = (
        lark.EventDispatcherHandler.builder(key, token)
        .register_p2_im_message_receive_v1(accept)
        .build()
    )
    raw = RawRequest()
    raw.uri, raw.body = "/webhooks/feishu", body
    raw.headers = {
        name: headers.get(name.lower(), "")
        for name in (LARK_REQUEST_TIMESTAMP, LARK_REQUEST_NONCE, LARK_REQUEST_SIGNATURE)
    }
    response = handler.do(raw)
    if response.status_code != 200:
        # SDK exception messages may contain payload data; never return/log them.
        raise HTTPException(503, "Event could not be durably accepted")
    return {"accepted": True}
