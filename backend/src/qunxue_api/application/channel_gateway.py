"""Run verified private-channel requests through the same Agent and billing application."""

import hashlib
import secrets
import threading
import time
from uuid import UUID

from qunxue_api.modules.agent_conversation import AgentInterrupted, ConversationNotFound
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

    def can_deliver(self, gateway_id, event_key, *, runtime_scope):
        row = self.repository.event(event_key)
        if row is None or row.gateway_id != gateway_id or row.state != "complete":
            return False
        if row.binding_id is not None:
            try:
                binding = self.require_binding(row.binding_id)
                if row.scope_key is not None:
                    with runtime_scope() as runtime:
                        run = runtime.find_run(user_id=UUID(binding.user_id),
                                               idempotency_key=f"channel:{event_key}")
                    if run is None or run.output_redacted:
                        return False
            except (GatewayDenied, ConversationNotFound):
                return False
        return True

    def prepare(self, event, *, runtime_scope):
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
        control = event.text.strip() == "/cancel"
        row, conversation_id = self.repository.reserve(event, binding, now, control=control)
        if row.state == "complete":
            if not self.can_deliver(event.gateway_id, event.event_key, runtime_scope=runtime_scope):
                raise GatewayDenied("绑定已撤销。")
            return row, conversation_id, binding, row.answer
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
            self.repository.finish(event.event_key, token, answer, binding.binding_id)
            return row, conversation_id, binding, answer
        if binding is None:
            receipt = self.repository.finish(
                event.event_key,
                token,
                "请先登录 Everplain 生成此机器人的一次性绑定码，然后在私聊发送 /bind 绑定码。",
            )
            return row, conversation_id, binding, receipt.answer
        if event.occurred_at < binding.created_at or event.received_at_ms < binding.activated_at_ms:
            self.repository.finish(event.event_key, token, None)
            raise GatewayDenied("这条消息早于当前绑定，请重新发送。")

        if control:
            active = self.repository.active_event(event.scope_key(binding.binding_id))
            requested = self.repository.request_stop(active) if active else False
            with runtime_scope() as runtime:
                run = runtime.find_run(
                    user_id=UUID(binding.user_id), idempotency_key=f"channel:{active}"
                ) if active else None
                if run is not None and run.status == "running":
                    runtime.request_cancel(user_id=UUID(binding.user_id), run_id=run.run_id)
                if requested:
                    answer = "已请求停止本轮。已产生的模型用量仍按实际记录，请在 Everplain 查看。"
                else:
                    answer = "此私聊当前没有正在运行的回答。"
            self.repository.finish(event.event_key, token, answer)
            return row, conversation_id, binding, answer
        return row, conversation_id, binding, None

    def dispatch(self, event, *, gateway_scope, runtime_scope, prepared=None):
        row, conversation_id, binding, answer = prepared or self.prepare(
            event, runtime_scope=runtime_scope
        )
        if answer is not None:
            return answer
        token = row.lease_token

        user_id = UUID(binding.user_id)
        binding_id = binding.binding_id
        stopped = threading.Event()
        cancelled = threading.Event()
        run_state = {}
        deadline = time.monotonic() + 1800

        def checkpoint(conversation=None):
            with gateway_scope() as gateway:
                gateway.require_binding(binding_id)
                if gateway.repository.event(event.event_key).state == "cancel_requested":
                    cancelled.set()
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
            answer = result.result.answer
            if getattr(result, "incomplete_reason", None) == "length":
                answer += "\n\n本轮达到模型输出长度限制，已生成内容已保留，请在 Everplain 继续。"
            # The reply and its replay receipt commit before the gateway sees success.
            receipt = self.repository.finish(event.event_key, token, answer)
            if not self.can_deliver(event.gateway_id, event.event_key, runtime_scope=runtime_scope):
                raise GatewayDenied("本轮来源当前不可用，请在 Everplain 查看。")
            return receipt.answer
        except AgentInterrupted:
            self.require_binding(binding_id)
            with runtime_scope() as runtime:
                run = runtime.find_run(
                    user_id=user_id, idempotency_key=f"channel:{event.event_key}"
                )
            answer = (run.partial_answer if run else "") + (
                "\n\n本轮已停止。已产生的模型用量按实际记录，请在 Everplain 查看或继续。"
            )
            return self.repository.finish(event.event_key, token, answer).answer
        except Exception:
            if self.repository.event(event.event_key).state != "complete":
                self.repository.finish(event.event_key, token, None)
            raise
        finally:
            stopped.set()
            watcher.join(timeout=6)

    def output(self, gateway_id, event_key, *, runtime_scope, after=0):
        row = self.repository.event(event_key)
        if row is None or row.gateway_id != gateway_id:
            raise GatewayDenied("消息不存在。")
        binding = self.require_binding(row.binding_id) if row.binding_id else None
        if row.state == "complete" and binding is None:
            return {"event_key": event_key, "state": "complete", "cursor": 0,
                    "text": row.answer}
        if binding is None:
            raise GatewayDenied("绑定不存在。")
        with runtime_scope() as runtime:
            try:
                run = runtime.find_run(user_id=UUID(binding.user_id),
                                       idempotency_key=f"channel:{event_key}")
            except ConversationNotFound:
                run = None
            events = runtime.read_output_events(user_id=UUID(binding.user_id), run_id=run.run_id,
                                                after=after) if run else ()
        cursor = max((item.sequence for item in events), default=after)
        if row.scope_key is not None and (
            (run is None and row.state == "complete") or (run is not None and run.output_redacted)
        ):
            return {"event_key": event_key, "state": "complete",
                    "cursor": run.last_event_sequence if run else 0,
                    "text": run.partial_answer if run and run.output_redacted
                    else "本轮来源或会话当前不可用，请在 Everplain 查看。"}
        if row.state == "complete":
            return {"event_key": event_key, "state": "complete",
                    "cursor": run.last_event_sequence if run else 0, "text": row.answer}
        state = "processing" if row.state in {"processing", "cancel_requested"} \
            and row.lease_until > int(self.clock()) \
            else "retryable"
        return {"event_key": event_key, "state": state, "cursor": cursor, "text": None}


def _code_hash(code):
    return hashlib.sha256(code.encode()).hexdigest()
