"""Run verified private-channel requests through the same Agent and billing application."""

import hashlib
import secrets
import threading
import time
from uuid import UUID

from qunxue_api.modules.agent_conversation import AgentInterrupted
from qunxue_api.modules.channel_gateway import GatewayDenied
from qunxue_api.modules.identity import AccountStatus


class ChannelGatewayApplication:
    def __init__(self, repository, identities, *, clock=time.time):
        self.repository = repository
        self.identities = identities
        self.clock = clock

    def active_user(self, user_id):
        user = self.identities.get_user(UUID(str(user_id)))
        if user is None or user.status != AccountStatus.ACTIVE or user.deactivated_at is not None:
            raise GatewayDenied("账号当前不可用。")

    def require_binding(self, binding_id):
        binding = self.repository.binding(binding_id)
        if binding is None or binding.revoked_at is not None:
            raise GatewayDenied("绑定已撤销。")
        self.active_user(binding.user_id)
        return binding

    def create_code(self, user_id, gateway_id):
        self.active_user(user_id)
        code = secrets.token_urlsafe(24)
        now = int(self.clock())
        self.repository.create_code(user_id, gateway_id, _code_hash(code), now)
        return {"code": code, "expires_at": now + 600, "gateway_id": gateway_id}

    def cancel_codes(self, user_id, gateway_id):
        self.active_user(user_id)
        self.repository.cancel_codes(user_id, gateway_id, int(self.clock()))

    def bindings(self, user_id):
        self.active_user(user_id)
        return self.repository.bindings(user_id)

    def revoke(self, user_id, binding_id):
        self.active_user(user_id)
        self.repository.revoke(user_id, str(binding_id), int(self.clock()))

    def can_deliver(self, gateway_id, event_key):
        row = self.repository.event(event_key)
        if row is None or row.gateway_id != gateway_id or row.state != "complete":
            return False
        if row.binding_id is not None:
            try:
                self.require_binding(row.binding_id)
            except GatewayDenied:
                return False
        return True

    def dispatch(self, event, *, gateway_scope, runtime_scope):
        now_ms = int(self.clock() * 1000)
        now = now_ms // 1000
        # No group fallback: the normal runtime has private memory/tools. A fresh
        # conversation alone does not constitute a safe shared-room runtime.
        if event.chat_type != "private":
            raise GatewayDenied("群聊暂未开放，请使用机器人私聊。")
        if (
            event.occurred_at > now + 300
            or event.occurred_at < now - 86400
            or event.received_at_ms > now_ms + 300000
            or event.received_at_ms < now_ms - 86400000
        ):
            raise GatewayDenied("消息已过期。")
        binding = self.repository.active_binding(event.identity_key)
        if binding is not None:
            self.require_binding(binding.binding_id)
        row, conversation_id = self.repository.reserve(event, binding, now)
        if row.state == "complete":
            if not self.can_deliver(event.gateway_id, event.event_key):
                raise GatewayDenied("绑定已撤销。")
            return row.answer
        token = row.lease_token
        if event.text.startswith("/bind "):
            try:
                binding = self.repository.redeem(
                    event, _code_hash(event.text.removeprefix("/bind ").strip()), now, now_ms
                )
                self.active_user(binding.user_id)
            except GatewayDenied as exc:
                # Rollback includes one-use consumption when the account was disabled.
                raise GatewayDenied(str(exc)) from exc
            answer = (
                "绑定成功。此私聊将使用你的 Everplain 账号和用量。可在 Everplain 随时解除绑定。"
            )
            return self.repository.finish(event.event_key, token, answer, binding.binding_id).answer
        if binding is None:
            return self.repository.finish(
                event.event_key,
                token,
                "请先登录 Everplain 生成此机器人的一次性绑定码，然后在私聊发送 /bind 绑定码。",
            ).answer
        if event.occurred_at < binding.created_at or event.received_at_ms < binding.activated_at_ms:
            self.repository.finish(event.event_key, token, None)
            raise GatewayDenied("这条消息早于当前绑定，请重新发送。")

        user_id = UUID(binding.user_id)
        binding_id = binding.binding_id
        stopped = threading.Event()
        cancelled = threading.Event()
        run_state = {}
        deadline = time.monotonic() + 300

        def checkpoint(conversation=None):
            with gateway_scope() as gateway:
                gateway.require_binding(binding_id)
                gateway.repository.renew(event.event_key, token, int(gateway.clock()), conversation)

        def started(run_id, conversation_id, replayed, *, lease_token=None):
            checkpoint(conversation_id)
            if not replayed:
                run_state.update(run_id=run_id, lease_token=lease_token)

        def watch():
            while not stopped.wait(5):
                try:
                    checkpoint()
                    if time.monotonic() >= deadline:
                        cancelled.set()
                    if run_state:
                        with runtime_scope() as runtime:
                            if runtime.heartbeat(user_id=user_id, **run_state):
                                cancelled.set()
                except Exception:
                    cancelled.set()

        watcher = threading.Thread(target=watch, daemon=True, name="channel-run-lease")
        watcher.start()
        try:
            # Never accept user_id, material IDs, task IDs or model settings from
            # a platform payload. Standard runtime resolves all account ownership.
            with runtime_scope() as runtime:
                result = runtime.run_turn(
                    user_id=user_id,
                    conversation_id=UUID(conversation_id) if conversation_id else None,
                    prompt=event.text,
                    idempotency_key=f"channel:{event.event_key}",
                    on_run_started=started,
                    on_delta=lambda _delta: None,
                    is_cancelled=lambda: cancelled.is_set() or time.monotonic() >= deadline,
                )
            self.require_binding(binding_id)
            if cancelled.is_set():
                raise AgentInterrupted()
            # The reply and its replay receipt commit before the gateway sees success.
            return self.repository.finish(event.event_key, token, result.result.answer).answer
        except Exception:
            self.repository.finish(event.event_key, token, None)
            raise
        finally:
            stopped.set()
            watcher.join(timeout=6)


def _code_hash(code):
    return hashlib.sha256(code.encode()).hexdigest()
