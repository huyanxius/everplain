"""Actual loopback HTTP and official SDK tests; no real platform or model network access."""

import base64
import hashlib
import json
import os
import socket
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from uuid import uuid4

import httpx
import pytest
from Crypto.Cipher import AES

ROOT = Path(__file__).resolve().parents[2]
BACKEND_PYTHON = ROOT / "backend/.venv/bin/python"
GATEWAY_PYTHON = ROOT / "gateway/.venv/bin/python"


def port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def until(read, predicate, seconds=25):
    deadline = time.monotonic() + seconds
    last = None
    while time.monotonic() < deadline:
        try:
            last = read()
            if predicate(last):
                return last
        except httpx.HTTPError:
            pass
        time.sleep(0.1)
    raise AssertionError(f"Local fixture timed out; last result: {last}")


class Stack:
    def __init__(self, directory):
        self.directory = directory
        self.backend_port, self.gateway_port = port(), port()
        self.env = {
            **{key: value for key, value in os.environ.items()
               if not key.startswith("EVERPLAIN_")
               and key.upper() not in {"HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY"}},
            "EVERPLAIN_GATEWAY_CONTRACT_TEST": "1",
            "EVERPLAIN_DATABASE_URL": f"sqlite:///{directory / 'backend.db'}",
            "FIXTURE_BACKEND_PORT": str(self.backend_port),
            "FIXTURE_GATEWAY_PORT": str(self.gateway_port),
            "FIXTURE_GATEWAY_DATABASE": str(directory / "gateway.db"),
            "PYTHONPATH": str(ROOT / "backend/src"),
        }
        self.backend = None
        self.gateway = None
        self.logs = []
        self.event_times = {}
        self.client = httpx.Client(
            base_url=f"http://127.0.0.1:{self.backend_port}", trust_env=False, timeout=10
        )
        self.incoming = httpx.Client(
            base_url=f"http://127.0.0.1:{self.gateway_port}", trust_env=False, timeout=10
        )

    def spawn(self, name, python, script, extra=None):
        log = (self.directory / f"{name}-{time.time_ns()}.log").open("wb")
        self.logs.append(log)
        return subprocess.Popen(
            [str(python), str(ROOT / "gateway/integration" / script)],
            cwd=ROOT / "backend",
            env={**self.env, **(extra or {})},
            stdout=log,
            stderr=log,
        )

    def start_backend(self):
        self.backend = self.spawn("backend", BACKEND_PYTHON, "backend_fixture.py")
        until(lambda: self.client.get("/__fixture/state").status_code, lambda value: value == 200)

    def start_gateway(self, mode="all"):
        self.gateway = self.spawn(
            "gateway", GATEWAY_PYTHON, "gateway_fixture.py", {"FIXTURE_GATEWAY_MODE": mode}
        )

        def ready():
            if self.gateway.poll() is not None:
                raise AssertionError(
                    f"Gateway fixture exited before readiness: {self.gateway.returncode}"
                )
            return self.incoming.get("/health").status_code

        until(ready, lambda value: value == 200, seconds=60)

    @staticmethod
    def stop(process):
        if process and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)

    def restart_gateway(self, mode="all"):
        self.stop(self.gateway)
        self.start_gateway(mode)

    def state(self):
        return self.client.get("/__fixture/state").json()

    def queue(self):
        return self.incoming.get("/health").json()["queues"]

    def telegram(self, update, text, thread=None):
        message = {
            "message_id": update,
            "date": self.event_times.setdefault(f"telegram:{update}", int(time.time())),
            "from": {"id": 77, "is_bot": False, "first_name": "Fixture"},
            "chat": {"id": 77, "type": "private"},
            "text": text,
        }
        if thread:
            message["message_thread_id"] = thread
        return self.incoming.post(
            "/webhooks/telegram",
            headers={
                "X-Telegram-Bot-Api-Secret-Token": "fixture_" * 6,
            },
            json={"update_id": update, "message": message},
        )

    def feishu(self, event_id, text):
        plaintext = {
            "schema": "2.0",
            "header": {
                "event_id": event_id,
                "event_type": "im.message.receive_v1",
                "app_id": "cli_test",
                "tenant_key": "tenant_test",
                "token": "verify-fixture",
            },
            "event": {
                "sender": {
                    "sender_id": {"open_id": "ou_fixture"},
                    "sender_type": "user",
                    "tenant_key": "tenant_test",
                },
                "message": {
                    "message_id": event_id,
                    "chat_id": "oc_fixture",
                    "chat_type": "p2p",
                    "message_type": "text",
                    "create_time": str(
                        self.event_times.setdefault(f"feishu:{event_id}", int(time.time() * 1000))
                    ),
                    "content": json.dumps({"text": text}),
                },
            },
        }
        raw = json.dumps(plaintext).encode()
        pad = 16 - len(raw) % 16
        iv, key = b"0" * 16, "encrypt-fixture"
        cipher = AES.new(hashlib.sha256(key.encode()).digest(), AES.MODE_CBC, iv)
        body = json.dumps(
            {"encrypt": base64.b64encode(iv + cipher.encrypt(raw + bytes([pad]) * pad)).decode()}
        ).encode()
        timestamp, nonce = str(int(time.time())), "fixture-nonce"
        return self.incoming.post(
            "/webhooks/feishu",
            content=body,
            headers={
                "X-Lark-Request-Timestamp": timestamp,
                "X-Lark-Request-Nonce": nonce,
                "X-Lark-Signature": hashlib.sha256(
                    (timestamp + nonce + key).encode() + body
                ).hexdigest(),
            },
        )

    def register(self):
        response = self.client.post(
            "/api/session/register",
            headers={"Idempotency-Key": str(uuid4())},
            json={"email": "fixture-owner@example.test", "password": "fixture-password-only"},
        )
        assert response.status_code == 201, response.text

    def bind(self, platform="telegram"):
        gateway_id = "telegram:123" if platform == "telegram" else "feishu:cli_test:tenant_test"
        grant = self.client.post(
            "/api/channels/link-codes",
            json={"gateway_id": gateway_id, "acknowledge_private_data_and_usage": True},
        )
        assert grant.status_code == 201, grant.text
        response = (
            self.telegram(1, "/bind " + grant.json()["code"])
            if platform == "telegram"
            else self.feishu("bind", "/bind " + grant.json()["code"])
        )
        assert response.status_code == 200
        rows = until(
            lambda: self.client.get("/api/channels/bindings").json(),
            lambda rows: any(row["gateway_id"] == gateway_id for row in rows),
        )
        return next(row for row in rows if row["gateway_id"] == gateway_id)

    def close(self):
        (self.directory / "process-status.json").write_text(
            json.dumps(
                {
                    "backend_exit_before_teardown": self.backend.poll() if self.backend else None,
                    "gateway_exit_before_teardown": self.gateway.poll() if self.gateway else None,
                }
            )
        )
        self.stop(self.gateway)
        self.stop(self.backend)
        self.client.close()
        self.incoming.close()
        for log in self.logs:
            log.close()


@pytest.fixture
def stack(tmp_path):
    if not BACKEND_PYTHON.exists() or not GATEWAY_PYTHON.exists():
        pytest.skip("Install both independently locked environments before integration tests")
    value = Stack(tmp_path)
    try:
        value.start_backend()
        # Registration uses memory-hard password hashing. Complete account setup
        # before starting the independent SDK process on constrained test runners.
        value.register()
        value.start_gateway()
        yield value
    finally:
        value.close()


def test_real_telegram_sdk_http_replay_restart_and_durable_billing(stack):
    stack.bind()
    until(stack.queue, lambda q: q["outbox"].get("sent", 0) >= 1)
    stack.restart_gateway("receive_only")
    with ThreadPoolExecutor(max_workers=4) as pool:
        statuses = list(
            pool.map(
                lambda _: stack.telegram(2, "persisted hello", thread=42).status_code, range(12)
            )
        )
    assert set(statuses) == {200}
    assert stack.queue()["inbox"]["pending"] == 1
    assert stack.state()["calls"] == []
    stack.restart_gateway()
    state = until(
        stack.state,
        lambda value: any(
            item["body"].get("text") == "private fixture answer: persisted hello"
            for item in value["deliveries"]
        ),
    )
    assert state["calls"] == ["persisted hello"] and state["runs"] == 1 and state["charges"] == 1
    reply = next(
        item["body"]
        for item in state["deliveries"]
        if item["body"].get("text") == "private fixture answer: persisted hello"
    )
    assert reply["message_thread_id"] == "42"
    conversations = stack.client.get("/api/agent/conversations").json()["items"]
    saved = stack.client.get(
        f"/api/agent/conversations/{conversations[0]['conversation_id']}"
    ).json()
    assert saved["turns"][0]["assistant"]["content"] == reply["text"]
    stack.stop(stack.backend)
    stack.start_backend()
    assert stack.telegram(2, "persisted hello", thread=42).status_code == 200
    time.sleep(1)
    assert stack.state()["calls"] == ["persisted hello"] and stack.state()["charges"] == 1


def test_real_sdk_retries_delivery_without_repeating_model(stack):
    stack.bind()
    until(stack.queue, lambda q: q["outbox"].get("sent", 0) >= 1)
    stack.client.post("/__fixture/behavior/telegram/rate_once")
    assert stack.telegram(2, "retry answer").status_code == 200
    until(stack.queue, lambda q: q["outbox"].get("sent", 0) >= 2)
    state = stack.state()
    attempts = [
        item
        for item in state["deliveries"]
        if item["body"].get("text") == "private fixture answer: retry answer"
    ]
    assert len(attempts) == 2 and state["calls"] == ["retry answer"] and state["charges"] == 1
    stack.client.post("/__fixture/behavior/telegram/ambiguous_once")
    assert stack.telegram(3, "ambiguous answer").status_code == 200
    until(stack.queue, lambda q: q["outbox"].get("ambiguous", 0) == 1)
    stack.restart_gateway()
    time.sleep(1)
    attempts = [
        item
        for item in stack.state()["deliveries"]
        if item["body"].get("text") == "private fixture answer: ambiguous answer"
    ]
    assert len(attempts) == 1


def test_revoke_suppresses_all_persisted_private_parts_after_restart(stack):
    binding = stack.bind()
    until(stack.queue, lambda q: q["outbox"].get("sent", 0) >= 1)
    stack.restart_gateway("inbox_only")
    assert stack.telegram(2, "long unicode reply").status_code == 200
    until(stack.queue, lambda q: q["inbox"].get("complete", 0) == 2)
    assert stack.client.delete(f"/api/channels/bindings/{binding['binding_id']}").status_code == 204
    stack.restart_gateway()
    until(stack.queue, lambda q: q["outbox"].get("suppressed", 0) >= 3)
    assert not any("知识" in str(item["body"]) for item in stack.state()["deliveries"])
    assert stack.state()["calls"] == ["long unicode reply"]


def test_real_feishu_sdk_encrypted_webhook_and_stable_send_uuid(stack):
    stack.bind("feishu")
    until(stack.queue, lambda q: q["outbox"].get("sent", 0) >= 1)
    stack.client.post("/__fixture/behavior/feishu/rate_once")
    assert stack.feishu("normal", "feishu answer").status_code == 200
    until(stack.queue, lambda q: q["outbox"].get("sent", 0) >= 2)
    state = stack.state()
    sends = [
        item["body"]
        for item in state["deliveries"]
        if item["platform"] == "feishu" and "feishu answer" in item["body"].get("content", "")
    ]
    assert len(sends) == 2 and sends[0]["uuid"] == sends[1]["uuid"]
    assert state["calls"] == ["feishu answer"] and state["charges"] == 1


@pytest.mark.parametrize("fault", ["drop_once", "truncate_once"])
def test_committed_runtime_response_loss_replays_without_second_charge(stack, fault):
    stack.bind()
    until(stack.queue, lambda q: q["outbox"].get("sent", 0) >= 1)
    requests_before = stack.state()["dispatch_requests"]
    stack.client.post(f"/__fixture/behavior/dispatch/{fault}").raise_for_status()
    assert stack.telegram(2, "lost backend result").status_code == 200
    state = until(stack.state, lambda value: any(
        item["body"].get("text") == "private fixture answer: lost backend result"
        for item in value["deliveries"]
    ))
    assert state["dispatch_requests"] == requests_before + 1
    assert state["calls"] == ["lost backend result"]
    assert state["runs"] == state["charges"] == 1
    assert sum(
        item["body"].get("text") == "private fixture answer: lost backend result"
        for item in state["deliveries"]
    ) == 1


def test_revoke_before_durable_queue_execution_cannot_call_or_charge_model(stack):
    binding = stack.bind()
    until(stack.queue, lambda q: q["outbox"].get("sent", 0) >= 1)
    grant = stack.client.post(
        "/api/channels/link-codes",
        json={"gateway_id": "telegram:123", "acknowledge_private_data_and_usage": True},
    ).json()
    stack.restart_gateway("receive_only")
    assert stack.telegram(2, "queued private question").status_code == 200
    assert stack.telegram(3, "/bind " + grant["code"]).status_code == 200
    assert stack.client.delete(f"/api/channels/bindings/{binding['binding_id']}").status_code == 204
    stack.restart_gateway()
    until(stack.queue, lambda q: q["inbox"].get("complete", 0) == 3)
    assert stack.client.get("/api/channels/bindings").json() == []
    state = stack.state()
    assert state["calls"] == [] and state["runs"] == state["charges"] == 0
    assert not any("private fixture answer" in str(item["body"]) for item in state["deliveries"])


def test_real_sdk_permanent_failure_stops_without_model_replay(stack):
    stack.bind()
    until(stack.queue, lambda q: q["outbox"].get("sent", 0) >= 1)
    stack.client.post("/__fixture/behavior/telegram/permanent_once").raise_for_status()
    assert stack.telegram(2, "blocked platform").status_code == 200
    until(stack.queue, lambda q: q["outbox"].get("dead", 0) == 1)
    stack.restart_gateway()
    time.sleep(1)
    state = stack.state()
    assert state["calls"] == ["blocked platform"] and state["charges"] == 1
    assert sum(
        item["body"].get("text") == "private fixture answer: blocked platform"
        for item in state["deliveries"]
    ) == 1


@pytest.mark.parametrize("revoke", [False, True])
def test_long_http_runtime_retains_lease_and_rechecks_revocation(stack, revoke):
    binding = stack.bind()
    until(stack.queue, lambda q: q["outbox"].get("sent", 0) >= 1)
    assert stack.telegram(2, "gated long reply").status_code == 200
    until(stack.state, lambda value: value["calls"] == ["gated long reply"])
    with ThreadPoolExecutor(max_workers=4) as pool:
        assert set(pool.map(
            lambda _: stack.telegram(2, "gated long reply").status_code, range(12)
        )) == {200}
    try:
        # No model delta or checkpoint for longer than the normal runtime lease.
        time.sleep(31)
        conversations = stack.client.get("/api/agent/conversations").json()["items"]
        stack.client.get(
            f"/api/agent/conversations/{conversations[0]['conversation_id']}"
        ).raise_for_status()
        assert stack.state()["run_states"] == ["running"]
        if revoke:
            assert stack.client.delete(
                f"/api/channels/bindings/{binding['binding_id']}"
            ).status_code == 204
            # Allow the independent authorization watcher to cancel the active run.
            time.sleep(6)
    finally:
        stack.client.post("/__fixture/model/release").raise_for_status()
    until(stack.queue, lambda q: q["inbox"].get("complete", 0) == 2)
    state = until(stack.state, lambda value: "running" not in value["run_states"])
    assert state["calls"] == ["gated long reply"] and state["runs"] == 1
    if revoke:
        assert state["run_states"] == ["interrupted"]
        # This synthetic model has no metered provider attempt; interrupting it
        # cannot create a final-turn charge. Real provider spend may still exist.
        assert state["charges"] == 0
        assert not any(
            "private fixture answer" in str(item["body"]) for item in state["deliveries"]
        )
    else:
        state = until(stack.state, lambda value: any(
            item["body"].get("text") == "private fixture answer: gated long reply"
            for item in value["deliveries"]
        ))
        assert state["charges"] == 1


def test_active_get_cursor_survives_restart_and_private_cancel_does_not_rerun(stack):
    stack.bind()
    until(stack.queue, lambda q: q["outbox"].get("sent", 0) >= 1)
    assert stack.telegram(2, "gated cancellable reply").status_code == 200
    until(stack.state, lambda value: value["calls"] == ["gated cancellable reply"])
    try:
        # Restart while the accepted backend command is active, not only after
        # its final reply. The replacement gateway must GET the durable cursor.
        before = stack.state()["dispatch_requests"]
        stack.restart_gateway()
        assert stack.telegram(3, "/cancel").status_code == 200
        until(stack.state, lambda value: any(
            "请求停止" in item["body"].get("text", "") for item in value["deliveries"]
        ))
        assert stack.state()["dispatch_requests"] == before + 1
    finally:
        stack.client.post("/__fixture/model/release").raise_for_status()
    state = until(stack.state, lambda value: "running" not in value["run_states"])
    assert state["calls"] == ["gated cancellable reply"]
    assert state["runs"] == 1 and state["run_states"] == ["interrupted"]
    until(stack.state, lambda value: any(
        "private persisted fixture prefix" in item["body"].get("text", "")
        and "已停止" in item["body"].get("text", "") for item in value["deliveries"]
    ))
