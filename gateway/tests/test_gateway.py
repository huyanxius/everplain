"""Synthetic provider events and offline transport contracts. No real send or credential."""

import asyncio
import base64
import hashlib
import json
import time
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace

import httpx
import pytest
from Crypto.Cipher import AES
from fastapi import HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError

from everplain_gateway.config import Settings
from everplain_gateway.ingress import feishu_callback, telegram_event
from everplain_gateway.main import create_app
from everplain_gateway.store import (
    EventConflict,
    LeaseLost,
    QueueFull,
    Store,
    event_key,
    split_text,
)
from everplain_gateway.transport import RetryLater, Transports
from everplain_gateway.worker import Worker

NOW = int(time.time())


@pytest.fixture
def settings(tmp_path):
    return Settings(
        database_path=tmp_path / "gateway.db",
        telegram_token="123:" + "synthetic" * 5,
        telegram_webhook_secret="fixture_" * 6,
        telegram_backend_secret="backend-fixture" * 3,
        feishu_app_id="cli_test",
        feishu_app_secret="synthetic-only",
        feishu_encrypt_key="encrypt-fixture",
        feishu_verification_token="verify-fixture",
        feishu_tenant_key="tenant_test",
        feishu_backend_secret="backend-fixture" * 3,
    )


def event(**changes):
    return {
        "platform": "telegram",
        "bot_id": "123",
        "tenant_id": "",
        "event_id": "100",
        "subject_id": "77",
        "chat_id": "77",
        "thread_id": "",
        "chat_type": "private",
        "occurred_at": NOW,
        "received_at_ms": NOW * 1000,
        "text": "private input",
        **changes,
    }


def telegram(**changes):
    message = {
        "message_id": 5,
        "date": NOW,
        "from": {"id": 77, "is_bot": False, "first_name": "Test"},
        "chat": {"id": 77, "type": "private"},
        "text": "hello",
        **changes,
    }
    return json.dumps({"update_id": 100, "message": message}).encode()


def feishu(settings, *, encrypted=False, timestamp=NOW, **changes):
    plain = {
        "schema": "2.0",
        "header": {
            "event_id": "event-a",
            "event_type": "im.message.receive_v1",
            "app_id": "cli_test",
            "tenant_key": "tenant_test",
            "token": "verify-fixture",
        },
        "event": {
            "sender": {
                "sender_id": {"open_id": "ou_test"},
                "sender_type": "user",
                "tenant_key": "tenant_test",
            },
            "message": {
                "message_id": "om_test",
                "chat_id": "oc_test",
                "chat_type": "p2p",
                "message_type": "text",
                "create_time": str(NOW * 1000),
                "content": '{"text":"hello"}',
            },
        },
        **changes,
    }
    body = json.dumps(plain).encode()
    key = settings.feishu_encrypt_key.get_secret_value()
    if encrypted:
        iv = b"0" * 16
        padding = 16 - len(body) % 16
        ciphertext = AES.new(hashlib.sha256(key.encode()).digest(), AES.MODE_CBC, iv).encrypt(
            body + bytes([padding]) * padding
        )
        body = json.dumps({"encrypt": base64.b64encode(iv + ciphertext).decode()}).encode()
    nonce = "fixture-nonce"
    return body, {
        "x-lark-request-timestamp": str(timestamp),
        "x-lark-request-nonce": nonce,
        "x-lark-signature": hashlib.sha256(
            (str(timestamp) + nonce + key).encode() + body
        ).hexdigest(),
    }


def test_configuration_fails_closed_and_redacts_secrets():
    with pytest.raises(ValidationError):
        Settings()
    with pytest.raises(ValidationError) as error:
        Settings(telegram_token="super-private-token")
    assert "super-private-token" not in str(error.value)


def test_telegram_secret_checked_before_parse_and_private_user_only(settings):
    with pytest.raises(HTTPException) as error:
        telegram_event(b"bad-json", "wrong", settings, now=NOW)
    assert error.value.status_code == 401
    secret = settings.telegram_webhook_secret.get_secret_value()
    assert telegram_event(telegram(), secret, settings, now=NOW)["subject_id"] == "77"
    assert (
        telegram_event(
            telegram(chat={"id": -100, "type": "group", "title": "group"}),
            secret,
            settings,
            now=NOW,
        )
        is None
    )
    assert (
        telegram_event(
            telegram(
                forward_origin={"type": "hidden_user", "date": NOW, "sender_user_name": "Someone"}
            ),
            secret,
            settings,
            now=NOW,
        )
        is None
    )
    assert (
        telegram_event(
            telegram(**{"from": {"id": 77, "is_bot": True, "first_name": "Bot"}}),
            secret,
            settings,
            now=NOW,
        )
        is None
    )
    assert (
        telegram_event(telegram(chat={"id": 99, "type": "private"}), secret, settings, now=NOW)
        is None
    )


@pytest.mark.parametrize("encrypted", [False, True])
def test_feishu_sdk_auth_and_durable_callback(settings, encrypted):
    body, headers = feishu(settings, encrypted=encrypted)
    store = Store(settings.database_path)
    result = feishu_callback(body, headers, settings, store.enqueue, now=NOW)
    assert result == {"accepted": True}
    assert store.counts()["inbox"] == {"pending": 1}
    row = store.claim_inbox()
    assert row["event"]["subject_id"] == "ou_test"
    assert row["event"]["received_at_ms"] == NOW * 1000


def test_feishu_tamper_expiry_wrong_app_tenant_and_missing_token(settings):
    body, headers = feishu(settings)
    with pytest.raises(HTTPException) as error:
        feishu_callback(body + b" ", headers, settings, lambda _: pytest.fail(), now=NOW)
    assert error.value.status_code == 401
    body, headers = feishu(settings, timestamp=NOW - 301)
    with pytest.raises(HTTPException):
        feishu_callback(body, headers, settings, lambda _: pytest.fail(), now=NOW)
    for field in ("app_id", "tenant_key", "token"):
        header = json.loads(feishu(settings)[0])["header"]
        header[field] = "wrong"
        body, headers = feishu(settings, header=header)
        with pytest.raises(HTTPException):
            feishu_callback(body, headers, settings, lambda _: pytest.fail(), now=NOW)
    with pytest.raises(HTTPException):
        feishu_callback(feishu(settings)[0], {}, settings, lambda _: pytest.fail(), now=NOW)


def test_feishu_challenge_requires_token_and_safe_json(settings):
    body = json.dumps(
        {"type": "url_verification", "token": "verify-fixture", "challenge": 'quote"value'}
    ).encode()
    assert (
        feishu_callback(body, {}, settings, lambda _: pytest.fail(), now=NOW)["challenge"]
        == 'quote"value'
    )
    with pytest.raises(HTTPException):
        feishu_callback(
            b'{"type":"url_verification","challenge":"stolen"}',
            {},
            settings,
            lambda _: pytest.fail(),
            now=NOW,
        )


def test_webhook_commits_before_ack_and_rejects_full_queue(settings):
    store = Store(settings.database_path, max_pending=1)
    client = TestClient(create_app(settings, store=store, start_workers=False))
    headers = {
        "x-telegram-bot-api-secret-token": settings.telegram_webhook_secret.get_secret_value()
    }
    assert client.post("/webhooks/telegram", content=telegram(), headers=headers).status_code == 200
    reopened = Store(settings.database_path, max_pending=1)
    assert reopened.counts()["inbox"] == {"pending": 1}
    other = json.loads(telegram())
    other["update_id"] = 101
    assert client.post("/webhooks/telegram", json=other, headers=headers).status_code == 503
    assert client.post("/webhooks/telegram", content=telegram(), headers=headers).status_code == 200
    assert (
        client.post(
            "/webhooks/telegram", content=b"a" * (128 * 1024 + 1), headers=headers
        ).status_code
        == 413
    )


def test_feishu_callback_failure_is_not_acked(settings):
    body, headers = feishu(settings)

    def full(_):
        raise QueueFull()

    with pytest.raises(HTTPException) as error:
        feishu_callback(body, headers, settings, full, now=NOW)
    assert error.value.status_code == 503


def test_duplicate_concurrency_conflict_and_first_receipt(settings):
    store = Store(settings.database_path)
    with ThreadPoolExecutor(max_workers=8) as pool:
        keys = list(
            pool.map(lambda n: store.enqueue(event(received_at_ms=NOW * 1000 + n)), range(20))
        )
    assert len(set(keys)) == 1
    assert store.counts()["inbox"] == {"pending": 1}
    with pytest.raises(EventConflict):
        store.enqueue(event(text="tampered"))


def test_inbox_lease_recovery_is_fenced_and_fifo(settings):
    clock = [1000.0]
    store = Store(settings.database_path, clock=lambda: clock[0])
    store.enqueue(event())
    old = store.claim_inbox()
    clock[0] += 1
    store.enqueue(event(event_id="101"))
    assert store.claim_inbox() is None
    clock[0] += 400
    new = store.claim_inbox()
    assert new["key"] == old["key"]
    with pytest.raises(LeaseLost):
        store.complete_inbox(old, "stale answer")
    store.complete_inbox(new, "current answer")
    assert store.claim_inbox()["event"]["event_id"] == "101"


@pytest.mark.parametrize("platform", ["telegram", "feishu"])
def test_unicode_splits_are_lossless_and_bounded(platform):
    text = "知识🙂\n" * 7000
    parts = split_text(text, platform)
    assert "".join(parts) == text
    assert all(len(part.encode("utf-16-le")) // 2 <= 4000 for part in parts)
    assert all(
        len(json.dumps({"text": part}, ensure_ascii=False).encode()) < 30000 for part in parts
    )


def prepare_outbox(settings, platform="telegram", text="answer", thread_id=""):
    clock = [1000.0]
    store = Store(settings.database_path, clock=lambda: clock[0])
    store.enqueue(event(platform=platform, thread_id=thread_id))
    row = store.claim_inbox()
    store.complete_inbox(row, text)
    return store, clock


def test_telegram_ambiguous_crash_never_resends(settings):
    store, clock = prepare_outbox(settings)
    first = store.claim_outbox()
    clock[0] += 601
    assert Store(settings.database_path, clock=lambda: clock[0]).claim_outbox() is None
    assert store.counts()["outbox"] == {"ambiguous": 1}
    assert first["text"] == "answer"


def test_feishu_uuid_retries_stop_before_one_hour(settings):
    store, clock = prepare_outbox(settings, "feishu")
    first = store.claim_outbox()
    clock[0] += 601
    retry = store.claim_outbox()
    assert retry["id"] == first["id"]
    with pytest.raises(LeaseLost):
        store.finish_outbox(first["id"], "sent", attempt=first["attempts"])
    clock[0] = 4301
    assert store.claim_outbox() is None
    assert store.counts()["outbox"] == {"ambiguous": 1}


def test_revoke_suppresses_all_pending_parts(settings):
    store, _ = prepare_outbox(settings, text="x" * 8001)
    first = store.claim_outbox()
    store.finish_outbox(first["id"], "suppressed", attempt=first["attempts"])
    assert store.counts()["outbox"] == {"suppressed": 3}
    assert store.claim_outbox() is None


class FakeTransport:
    def __init__(self, failure=None):
        self.sent, self.failure = [], failure

    async def send(self, row):
        self.sent.append(dict(row))
        if self.failure:
            raise self.failure
        return "remote-123"

    async def close(self):
        pass


def test_worker_retries_delivery_without_rerunning_backend(settings):
    async def scenario():
        store = Store(settings.database_path)
        store.enqueue(event())
        calls = []

        def backend(request):
            calls.append(request.url.path)
            if request.method == "POST":
                return httpx.Response(200, json={"event_key": event_key(event()), "text": "answer"})
            return httpx.Response(200, json={"allowed": True})

        transport = FakeTransport(RetryLater(10))
        worker = Worker(
            settings,
            store,
            transport,
            client=httpx.AsyncClient(
                base_url="http://test", transport=httpx.MockTransport(backend)
            ),
        )
        await worker.process_inbox()
        await worker.process_outbox()
        assert store.counts()["inbox"] == {"complete": 1}
        with store.connect() as db:
            db.execute("UPDATE outbox SET available=0")
        transport.failure = None
        await worker.process_outbox()
        assert calls.count("/api/channel-gateway/dispatch") == 1
        assert len(transport.sent) == 2
        assert transport.sent[0]["id"] == transport.sent[1]["id"]
        assert store.counts()["outbox"]["sent"] == 1
        await worker.close()

    asyncio.run(scenario())


def test_worker_authorizes_each_delivery_and_preserves_ambiguous(settings):
    async def scenario():
        store, _ = prepare_outbox(settings, text="x" * 8001)
        transport = FakeTransport()
        worker = Worker(
            settings,
            store,
            transport,
            client=httpx.AsyncClient(
                base_url="http://test",
                transport=httpx.MockTransport(
                    lambda _: httpx.Response(200, json={"allowed": False})
                ),
            ),
        )
        await worker.process_outbox()
        assert transport.sent == []
        assert store.counts()["outbox"] == {"suppressed": 3}
        await worker.close()

    asyncio.run(scenario())


def test_telegram_transports_reply_to_original_topic_and_no_markup(settings):
    async def scenario():
        calls = []

        async def send(**kwargs):
            calls.append(kwargs)
            return SimpleNamespace(message_id=12)

        transports = object.__new__(Transports)
        transports.telegram = SimpleNamespace(send_message=send)
        await transports.send(
            {"platform": "telegram", "chat_id": "77", "thread_id": "321", "text": "<b>plain</b>"}
        )
        assert calls[0]["message_thread_id"] == 321
        assert calls[0]["parse_mode"] is None
        assert calls[0]["protect_content"] is True

    asyncio.run(scenario())


def test_one_sender_cannot_fill_shared_queue(settings):
    from everplain_gateway.store import SubjectBusy

    store = Store(settings.database_path)
    for number in range(20):
        store.enqueue(event(event_id=str(number)))
    with pytest.raises(SubjectBusy):
        store.enqueue(event(event_id="excess", thread_id="new-topic"))
    store.enqueue(event(event_id="other-user", subject_id="88", chat_id="88"))
    assert store.counts()["inbox"] == {"pending": 21}


def test_slow_task_receives_single_safe_progress_and_dead_notice(settings):
    clock = [1000.0]
    store = Store(settings.database_path, clock=lambda: clock[0])
    store.enqueue(event())
    row = store.claim_inbox()
    store.progress(row)
    store.progress(row)
    assert store.claim_outbox() is None
    clock[0] += 3
    progress = store.claim_outbox()
    assert progress["part"] == -1 and not progress["require_auth"]
    assert "private input" not in progress["text"]
    store.finish_outbox(progress["id"], "sent", attempt=progress["attempts"])
    store.fail_inbox(row)
    failure = store.claim_outbox()
    assert failure["part"] == -2 and not failure["require_auth"]
    assert store.counts()["inbox"] == {"dead": 1}


def test_feishu_business_rate_limit_keeps_retryable_state():
    async def scenario():
        async def create(_):
            return SimpleNamespace(
                success=lambda: False, code=230020, raw=SimpleNamespace(status_code=400, headers={})
            )

        transports = object.__new__(Transports)
        transports.feishu = SimpleNamespace(
            im=SimpleNamespace(v1=SimpleNamespace(message=SimpleNamespace(acreate=create)))
        )
        with pytest.raises(RetryLater):
            await transports.send(
                {"platform": "feishu", "chat_id": "oc_fixture", "id": "0" * 64, "text": "synthetic"}
            )

    asyncio.run(scenario())
