"""Synthetic platform contracts; real SQLite/conversation/credit code, no external sends."""

import hashlib
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager, suppress
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from pydantic import SecretStr, ValidationError
from sqlalchemy import select, update

from qunxue_api.adapters.sqlite.agent_conversation_model import AgentConversationRow, AgentRunRow
from qunxue_api.adapters.sqlite.billing_model import CreditLedgerRow
from qunxue_api.adapters.sqlite.channel_gateway import (
    ChannelEventRow,
    ChannelLinkCodeRow,
    ChannelScopeRow,
)
from qunxue_api.adapters.sqlite.identity_model import UserRow
from qunxue_api.modules.agent_conversation import AgentRunResult
from qunxue_api.modules.channel_gateway import ChannelEvent
from qunxue_api.settings import Settings

SECRET = "synthetic-gateway-secret-not-a-real-credential"
HEADERS = {"Authorization": f"Bearer {SECRET}", "X-Everplain-Gateway": "telegram:123"}
PATH = "/api/channel-gateway/dispatch"


@pytest.fixture
def channels(plain_client):
    client = plain_client
    client.app.state.settings.channel_gateway_credentials = {
        "telegram:123": SecretStr(SECRET),
        "telegram:456": SecretStr(SECRET),
        "feishu:cli_test:tenant_test": SecretStr(SECRET),
    }
    result = client.post(
        "/api/session/register",
        headers={"Idempotency-Key": str(uuid4())},
        json={"email": "channel-owner@example.test", "password": "a-valid-pass123"},
    )
    assert result.status_code == 201, result.text
    owner = UUID(result.json()["user"]["user_id"])
    calls = []

    class SyntheticRunner:
        def run_stream(self, *, prompt, conversation, **kwargs):
            calls.append(prompt)
            return AgentRunResult(
                answer="synthetic answer: " + prompt,
                citations=(),
                release_id="",
                provider="test",
                model="test",
                input_tokens=1,
                output_tokens=1,
            )

    SyntheticRunner.run = SyntheticRunner.run_stream
    original = client.app.state.disciplinary_agent_scope

    @contextmanager
    def runtime():
        with original() as app:
            app._runner = SyntheticRunner()
            yield app

    client.app.state.disciplinary_agent_scope = runtime
    yield SimpleNamespace(
        client=client, owner=owner, calls=calls, db=client.app.state.database, runtime=runtime
    )


def event(**changes):
    return {
        "platform": "telegram",
        "bot_id": "123",
        "tenant_id": "",
        "event_id": str(uuid4()),
        "subject_id": "77",
        "chat_id": "77",
        "thread_id": "",
        "chat_type": "private",
        "occurred_at": int(time.time()),
        "received_at_ms": int(time.time() * 1000),
        "text": "hello",
        **changes,
    }


def code(channels, gateway="telegram:123"):
    response = channels.client.post(
        "/api/channels/link-codes",
        json={
            "gateway_id": gateway,
            "acknowledge_private_data_and_usage": True,
        },
    )
    assert response.status_code == 201, response.text
    assert response.headers["cache-control"] == "no-store"
    return response.json()["code"]


def dispatch(channels, payload, headers=None):
    return channels.client.post(PATH, headers=headers or HEADERS, json=payload)


def bind(channels, **changes):
    payload = event(text="/bind " + code(channels), **changes)
    response = dispatch(channels, payload)
    assert response.status_code == 200, response.text
    return channels.client.get("/api/channels/bindings").json()[0], payload


def test_binding_requires_session_consent_origin_and_config(channels):
    client = channels.client
    assert (
        client.post("/api/channels/link-codes", json={"gateway_id": "telegram:123"}).status_code
        == 422
    )
    assert (
        client.post(
            "/api/channels/link-codes",
            headers={"Origin": "https://evil.test"},
            json={
                "gateway_id": "telegram:123",
                "acknowledge_private_data_and_usage": True,
            },
        ).status_code
        == 403
    )
    client.cookies.clear()
    assert client.get("/api/channels/bindings").status_code == 401
    with pytest.raises(ValidationError):
        Settings(_env_file=None, channel_gateway_credentials={"telegram:123": "short"})


def test_codes_are_hashed_scoped_expiring_one_use(channels):
    grant = code(channels)
    with channels.db.session() as session:
        row = session.get(ChannelLinkCodeRow, hashlib.sha256(grant.encode()).hexdigest())
        assert row is not None and row.expires_at - int(time.time()) <= 600
        assert row.code_hash != grant
    wrong_bot = dispatch(
        channels,
        event(bot_id="456", text="/bind " + grant),
        {**HEADERS, "X-Everplain-Gateway": "telegram:456"},
    )
    assert wrong_bot.status_code == 403
    assert dispatch(channels, event(text="/bind " + grant)).status_code == 200
    assert (
        dispatch(channels, event(subject_id="88", chat_id="88", text="/bind " + grant)).status_code
        == 403
    )
    expired = code(channels)
    with channels.db.session() as session:
        session.execute(
            update(ChannelLinkCodeRow)
            .where(ChannelLinkCodeRow.code_hash == hashlib.sha256(expired.encode()).hexdigest())
            .values(expires_at=1)
        )
    assert dispatch(channels, event(subject_id="88", text="/bind " + expired)).status_code == 403


def test_auth_identity_group_and_injected_scope_are_rejected(channels):
    bind(channels)
    assert channels.client.post(PATH, json=event()).status_code == 401
    assert dispatch(channels, event(bot_id="other")).status_code == 403
    assert dispatch(channels, event(chat_type="group", chat_id="group")).status_code == 403
    assert dispatch(channels, event(user_id=str(channels.owner))).status_code == 422
    assert dispatch(channels, event(conversation_id=str(uuid4()))).status_code == 422
    assert dispatch(channels, event(occurred_at=1)).status_code == 403
    assert channels.calls == []


def test_concurrent_replay_runs_and_charges_once(channels):
    bind(channels)
    payload = event(text="same event billed once")
    with ThreadPoolExecutor(max_workers=8) as pool:
        replies = list(pool.map(lambda _: dispatch(channels, payload), range(20)))
    assert all(reply.status_code in {200, 429} for reply in replies), [
        (r.status_code, r.text) for r in replies
    ]
    assert any(reply.status_code == 200 for reply in replies)
    assert channels.calls == [payload["text"]]
    with channels.db.session() as session:
        runs = session.scalars(select(AgentRunRow)).all()
        assert len(runs) == 1
        ledger = session.scalars(
            select(CreditLedgerRow).where(CreditLedgerRow.run_id == runs[0].run_id)
        ).all()
        assert len(ledger) == 1 and ledger[0].points == -2
    assert dispatch(channels, {**payload, "text": "mutated"}).status_code == 409


def test_runtime_receipt_survives_gateway_crash_and_does_not_recharge(channels):
    bind(channels)
    payload = event()
    first = dispatch(channels, payload)
    assert first.status_code == 200, first.text
    key = ChannelEvent(**payload).event_key
    # Simulate runtime committed but gateway receipt not committed on worker crash.
    with channels.db.session() as session:
        session.execute(
            update(ChannelEventRow)
            .where(ChannelEventRow.event_key == key)
            .values(
                state="processing",
                answer=None,
                lease_until=0,
            )
        )
        session.execute(update(ChannelScopeRow).values(lease_until=0))
    second = dispatch(channels, payload)
    assert second.status_code == 200, second.text
    assert second.json() == first.json()
    assert channels.calls == ["hello"]


def test_threads_and_bots_are_isolated_and_unbound_subject_cannot_assume_user(channels):
    bind(channels)
    assert (
        "绑定" in dispatch(channels, event(subject_id="unknown", chat_id="unknown")).json()["text"]
    )
    for thread in ("", "", "other"):
        assert dispatch(channels, event(thread_id=thread)).status_code == 200
    with channels.db.session() as session:
        conversations = session.scalars(select(AgentConversationRow)).all()
        assert len(conversations) == 2
        assert {row.user_id for row in conversations} == {str(channels.owner)}
    assert (
        "绑定"
        in dispatch(
            channels, event(bot_id="456"), {**HEADERS, "X-Everplain-Gateway": "telegram:456"}
        ).json()["text"]
    )
    assert len(channels.calls) == 3


def test_revoke_suppresses_saved_and_queued_replies_and_rebinding(channels):
    binding, _ = bind(channels)
    payload = event()
    reply = dispatch(channels, payload)
    key = reply.json()["event_key"]
    assert channels.client.get(
        f"/api/channel-gateway/events/{key}/delivery", headers=HEADERS
    ).json()["allowed"]
    assert (
        channels.client.delete(f"/api/channels/bindings/{binding['binding_id']}").status_code == 204
    )
    assert not channels.client.get(
        f"/api/channel-gateway/events/{key}/delivery", headers=HEADERS
    ).json()["allowed"]
    assert dispatch(channels, payload).status_code == 403
    bind(channels)
    assert dispatch(channels, payload).status_code == 403
    assert len(channels.calls) == 1


def test_account_disable_cannot_run_or_deliver(channels):
    bind(channels)
    payload = event()
    response = dispatch(channels, payload)
    with channels.db.session() as session:
        session.execute(
            update(UserRow).where(UserRow.user_id == str(channels.owner)).values(status="disabled")
        )
    assert dispatch(channels, event()).status_code == 403
    key = response.json()["event_key"]
    assert not channels.client.get(
        f"/api/channel-gateway/events/{key}/delivery", headers=HEADERS
    ).json()["allowed"]
    assert len(channels.calls) == 1


def test_old_queued_message_cannot_cross_binding_generation(channels):
    binding, _ = bind(channels)
    queued = event(received_at_ms=int(time.time() * 1000) - 1)
    channels.client.delete(f"/api/channels/bindings/{binding['binding_id']}")
    bind(channels)
    assert dispatch(channels, queued).status_code == 403
    assert channels.calls == []


def test_depleted_account_does_not_call_runner(channels):
    from datetime import UTC, datetime

    from qunxue_api.adapters.sqlite.billing_repository import SqliteCreditRepository

    bind(channels)
    with channels.db.session() as session:
        repository = SqliteCreditRepository(session)
        run, now = uuid4(), datetime.now(UTC)
        repository.reserve_usage(user_id=channels.owner, run_id=run, now=now)
        opened = repository.get_summary(user_id=channels.owner, limit=1)
        assert opened.balance == 30 and opened.quota_period_started_at is not None
        repository.charge_usage(
            user_id=channels.owner, run_id=run, points=30, input_tokens=3000,
            output_tokens=0, model="synthetic-depleted", now=now,
        )
        depleted = repository.get_summary(user_id=channels.owner, limit=1)
        assert depleted.balance == 0 and depleted.quota_period_started_at is not None
        assert depleted.entries[0].points == -30
    assert dispatch(channels, event()).status_code == 402
    assert channels.calls == []


def test_first_valid_channel_message_opens_free30_for_unstarted_legacy_zero(channels):
    from datetime import UTC, datetime

    from qunxue_api.adapters.sqlite.billing_model import CreditAccountRow
    from qunxue_api.adapters.sqlite.billing_repository import SqliteCreditRepository

    bind(channels)
    with channels.db.session() as session:
        session.execute(update(CreditAccountRow)
                        .where(CreditAccountRow.user_id == str(channels.owner)).values(balance=0))
        session.add(CreditLedgerRow(
            entry_id=str(uuid4()), user_id=str(channels.owner), run_id=None, kind="usage",
            points=-30, balance_after=0, input_tokens=3000, output_tokens=0,
            model="synthetic-pre-cycle", created_at=datetime.now(UTC),
        ))
        before = SqliteCreditRepository(session).get_summary(user_id=channels.owner, limit=1)
        assert before.balance == 0 and before.quota_period_started_at is None
    payload = event()
    result = dispatch(channels, payload)
    assert result.status_code == 200, result.text
    assert channels.calls == ["hello"]
    with channels.db.session() as session:
        after = SqliteCreditRepository(session).get_summary(user_id=channels.owner, limit=1)
        assert after.quota_period_started_at is not None
        assert after.balance == 28
        assert after.active_usage_buckets[0]["limit_points"] == 30
    assert dispatch(channels, payload).status_code == 200
    assert channels.calls == ["hello"]


def test_durable_billing_metered_attempt_and_replay_share_one_charge(channels):
    from billing_test_support import synthetic_billing_runtime
    from sqlalchemy import text

    from qunxue_api.adapters.model.billing_operations import SqliteBillingOperations
    from qunxue_api.adapters.model.metering import current_operation

    bind(channels)
    billing = synthetic_billing_runtime(channels.db.engine)
    operations = SqliteBillingOperations(channels.db, billing)
    paid_calls = []

    class MeteredSyntheticRunner:
        def run_stream(self, **kwargs):
            operation = current_operation(required=True)
            operation.before_network()
            attempt = billing.before_attempt(
                run_id=operation.run_id,
                endpoint_id="synthetic",
                model="test-model",
                input_limit=10000,
                output_limit=1000,
                request_hash="synthetic",
            )
            billing.complete_attempt(
                attempt_id=attempt,
                input_tokens=10000,
                output_tokens=1000,
                cache_read_tokens=0,
                cache_write_tokens=0,
                returned_model="test-model",
                outcome="success",
            )
            paid_calls.append(attempt)
            return AgentRunResult(
                answer="metered synthetic receipt",
                citations=(),
                release_id="",
                provider="synthetic",
                model="test-model",
                input_tokens=10000,
                output_tokens=1000,
            )

    @contextmanager
    def metered_runtime():
        with channels.runtime() as runtime:
            runtime._billing = operations.bound_to(runtime._rollback.__self__)
            runtime._atomic = runtime._billing.atomic
            runtime._runner = MeteredSyntheticRunner()
            yield runtime

    channels.client.app.state.disciplinary_agent_scope = metered_runtime
    payload = event()
    first = dispatch(channels, payload)
    assert first.status_code == 200, first.text
    assert dispatch(channels, payload).json() == first.json()
    with channels.db.engine.connect() as connection:
        assert connection.scalar(text("SELECT count(*) FROM billing_attempts")) == 1
        assert connection.scalar(text("SELECT count(*) FROM billing_operations")) == 1
        assert connection.scalar(text("SELECT charged_points FROM billing_operations")) > 0
        assert connection.scalar(text("SELECT count(*) FROM credit_ledger WHERE kind='usage'")) == 1
    assert len(paid_calls) == 1


def test_backend_finish_cannot_overwrite_replacement_between_read_and_write(channels, monkeypatch):
    from qunxue_api.modules.channel_gateway import GatewayBusy

    bind(channels)
    payload = event()
    assert dispatch(channels, payload).status_code == 200
    key = ChannelEvent(**payload).event_key
    with channels.db.session() as session:
        session.execute(
            update(ChannelEventRow)
            .where(ChannelEventRow.event_key == key)
            .values(
                state="processing",
                answer=None,
                lease_token="old-worker",
                lease_until=int(time.time()) + 45,
            )
        )
    replaced = []
    with channels.client.app.state.channel_gateway_scope() as gateway:
        original = gateway.repository.event

        def hostile_interleaving(event_key):
            row = original(event_key)
            # An implementation that reads/checks in Python BEFORE its UPDATE is
            # raced here. A SQL-CAS implementation has already atomically completed.
            if row.state == "processing":
                with channels.db.session() as other:
                    other.execute(
                        update(ChannelEventRow)
                        .where(ChannelEventRow.event_key == event_key)
                        .values(lease_token="replacement-worker")
                    )
                replaced.append(True)
            return row

        monkeypatch.setattr(gateway.repository, "event", hostile_interleaving)
        with suppress(GatewayBusy):
            gateway.repository.finish(key, "old-worker", "answer")
    with channels.db.session() as session:
        row = session.get(ChannelEventRow, key)
        if replaced:
            assert row.lease_token == "replacement-worker" and row.answer is None
        else:
            assert row.lease_token == "old-worker" and row.state == "complete"
    with channels.client.app.state.channel_gateway_scope() as gateway, pytest.raises(GatewayBusy):
        gateway.repository.finish(key, "unrelated-stale-worker", "must not publish")


def test_channel_keeps_real_runtime_lease_alive_beyond_thirty_seconds(channels):
    import threading

    bind(channels)
    entered, release = threading.Event(), threading.Event()
    heartbeats = []

    class SlowSyntheticRunner:
        def run_stream(self, *, on_checkpoint, is_cancelled, **kwargs):
            # Match the actual SDK runner's pre-network checkpoint; it releases
            # any persona/memory SQL transaction before waiting on model I/O.
            on_checkpoint()
            entered.set()
            assert release.wait(90), "test must release its synthetic runner"
            return AgentRunResult(
                answer="long synthetic turn",
                citations=(),
                release_id="",
                provider="test",
                model="test",
            )

    @contextmanager
    def runtime_scope():
        with channels.runtime() as runtime:
            heartbeat = runtime.heartbeat

            def record_heartbeat(**kwargs):
                heartbeats.append(kwargs)
                return heartbeat(**kwargs)

            runtime.heartbeat = record_heartbeat
            runtime._runner = SlowSyntheticRunner()
            yield runtime

    channels.client.app.state.disciplinary_agent_scope = runtime_scope
    with ThreadPoolExecutor(max_workers=1) as pool:
        reply = pool.submit(dispatch, channels, event())
        try:
            assert entered.wait(10)
            # Deliberately exceed the existing Agent's thirty-second lease without
            # any model delta/checkpoint; only the gateway heartbeat can renew it.
            time.sleep(31)
            with channels.db.session() as session:
                run = session.scalar(select(AgentRunRow))
                conversation_id = run.conversation_id
            saved = channels.client.get(f"/api/agent/conversations/{conversation_id}")
            assert saved.status_code == 200
            with channels.db.session() as session:
                assert session.scalar(select(AgentRunRow)).status == "running"
            assert len(heartbeats) >= 5
            assert all(item["lease_token"] for item in heartbeats)
        finally:
            release.set()
        assert reply.result(timeout=10).status_code == 200


def test_feishu_tenant_is_in_authenticated_binding_and_event_identity(channels):
    gateway_id = "feishu:cli_test:tenant_test"
    headers = {**HEADERS, "X-Everplain-Gateway": gateway_id}
    payload = event(
        platform="feishu",
        bot_id="cli_test",
        tenant_id="tenant_test",
        text="/bind " + code(channels, gateway_id),
    )
    assert dispatch(channels, payload, headers).status_code == 200
    message = {
        **payload,
        "event_id": "same-provider-id",
        "text": "tenant private question",
        "received_at_ms": int(time.time() * 1000),
    }
    assert dispatch(channels, message, headers).status_code == 200
    other = {**message, "tenant_id": "other_tenant"}
    assert dispatch(channels, other, headers).status_code == 403
    assert dispatch(channels, {**message, "tenant_id": ""}, headers).status_code == 422
    other_gateway = "feishu:cli_test:other_tenant"
    channels.client.app.state.settings.channel_gateway_credentials[other_gateway] = SecretStr(
        SECRET
    )
    unbound = dispatch(channels, other, {**HEADERS, "X-Everplain-Gateway": other_gateway})
    assert unbound.status_code == 200 and "绑定" in unbound.json()["text"]
    assert ChannelEvent(**message).identity_key != ChannelEvent(**other).identity_key
    assert ChannelEvent(**message).event_key != ChannelEvent(**other).event_key
    assert channels.calls == ["tenant private question"]


def test_public_gateway_catalog_never_exposes_credentials_and_defaults_off(channels):
    from qunxue_api.settings import ChannelGatewayDisplay

    channels.client.app.state.settings.channel_gateway_display = {
        "telegram:123": ChannelGatewayDisplay(
            name="Example Telegram", bot_url="https://t.me/FixtureBot"
        )
    }
    result = channels.client.get("/api/channels/gateways")
    assert result.status_code == 200 and result.headers["cache-control"] == "no-store"
    assert SECRET not in result.text and "credentials" not in result.text
    telegram = next(item for item in result.json() if item["gateway_id"] == "telegram:123")
    assert (
        telegram["name"] == "Example Telegram" and telegram["bot_url"] == "https://t.me/FixtureBot"
    )
    channels.client.app.state.settings.channel_gateway_credentials = {}
    assert channels.client.get("/api/channels/gateways").json() == []
    channels.client.cookies.clear()
    assert channels.client.get("/api/channels/gateways").status_code == 401


def test_owner_can_cancel_unused_code_without_removing_existing_binding(channels):
    binding, _ = bind(channels)
    grant = code(channels)
    response = channels.client.delete(
        "/api/channels/link-codes", params={"gateway_id": "telegram:123"}
    )
    assert response.status_code == 204
    assert (
        dispatch(channels, event(subject_id="88", chat_id="88", text="/bind " + grant)).status_code
        == 403
    )
    assert (
        channels.client.get("/api/channels/bindings").json()[0]["binding_id"]
        == binding["binding_id"]
    )
    assert (
        channels.client.delete(
            "/api/channels/link-codes",
            params={"gateway_id": "telegram:123"},
            headers={"Origin": "https://evil.test"},
        ).status_code
        == 403
    )


@pytest.mark.parametrize(
    "url",
    [
        "https://evil.test/bot",
        "javascript:alert(1)",
        "https://t.me/FixtureBot?secret=code",
        "https://t.me/user",
        "https://applink.feishu.cn/client/bot/open?appId=wrong",
    ],
)
def test_bot_launch_link_is_restricted_to_configured_official_platform(url):
    with pytest.raises(ValidationError):
        Settings(
            _env_file=None,
            channel_gateway_credentials={"telegram:123": SECRET},
            channel_gateway_display={"telegram:123": {"name": "Bot", "bot_url": url}},
        )


def test_revoke_invalidates_unclaimed_codes_for_same_owner_and_bot(channels):
    binding, _ = bind(channels)
    outstanding = code(channels)
    assert (
        channels.client.delete(f"/api/channels/bindings/{binding['binding_id']}").status_code == 204
    )
    assert dispatch(channels, event(text="/bind " + outstanding)).status_code == 403
    assert channels.client.get("/api/channels/bindings").json() == []
