"""Durable binding generations, delivery authorization and fenced channel execution leases."""

import time
from uuid import uuid4

from sqlalchemy import ForeignKey, Integer, String, Text, select, update
from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Mapped, mapped_column

from qunxue_api.modules.channel_gateway import GatewayBusy, GatewayConflict, GatewayDenied

from .base import Base


class ChannelLinkCodeRow(Base):
    __tablename__ = "channel_link_codes"
    code_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.user_id", ondelete="CASCADE"))
    gateway_id: Mapped[str] = mapped_column(String(200))
    expires_at: Mapped[int] = mapped_column(Integer)
    consumed_at: Mapped[int | None] = mapped_column(Integer)


class ChannelBindingRow(Base):
    __tablename__ = "channel_bindings"
    binding_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.user_id", ondelete="CASCADE"), index=True
    )
    identity_key: Mapped[str | None] = mapped_column(String(64), unique=True)
    gateway_id: Mapped[str] = mapped_column(String(200))
    subject_id: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[int] = mapped_column(Integer)
    activated_at_ms: Mapped[int] = mapped_column(Integer)
    revoked_at: Mapped[int | None] = mapped_column(Integer)


class ChannelScopeRow(Base):
    __tablename__ = "channel_scopes"
    scope_key: Mapped[str] = mapped_column(String(64), primary_key=True)
    binding_id: Mapped[str] = mapped_column(
        ForeignKey("channel_bindings.binding_id", ondelete="CASCADE"), index=True
    )
    conversation_id: Mapped[str | None] = mapped_column(String(36))
    active_event: Mapped[str | None] = mapped_column(String(64))
    lease_until: Mapped[int] = mapped_column(Integer, default=0)


class ChannelEventRow(Base):
    __tablename__ = "channel_events"
    event_key: Mapped[str] = mapped_column(String(64), primary_key=True)
    gateway_id: Mapped[str] = mapped_column(String(200))
    payload_hash: Mapped[str] = mapped_column(String(64))
    binding_id: Mapped[str | None] = mapped_column(
        ForeignKey("channel_bindings.binding_id", ondelete="CASCADE")
    )
    scope_key: Mapped[str | None] = mapped_column(String(64))
    state: Mapped[str] = mapped_column(String(20))
    lease_token: Mapped[str | None] = mapped_column(String(36))
    lease_until: Mapped[int] = mapped_column(Integer, default=0)
    answer: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[int] = mapped_column(Integer)


class SqliteChannelGatewayRepository:
    def __init__(self, session):
        self.session = session

    def commit(self):
        self.session.commit()

    def binding(self, binding_id):
        return self.session.get(ChannelBindingRow, binding_id, populate_existing=True)

    def active_binding(self, identity_key):
        return self.session.scalar(
            select(ChannelBindingRow)
            .where(
                ChannelBindingRow.identity_key == identity_key,
                ChannelBindingRow.revoked_at.is_(None),
            )
            .execution_options(populate_existing=True)
        )

    def bindings(self, user_id):
        return self.session.scalars(
            select(ChannelBindingRow).where(
                ChannelBindingRow.user_id == str(user_id),
                ChannelBindingRow.revoked_at.is_(None),
            )
        ).all()

    def create_code(self, user_id, gateway_id, code_hash, now):
        # Bound outstanding grants without retaining the reusable secret.
        self.session.execute(
            update(ChannelLinkCodeRow)
            .where(
                ChannelLinkCodeRow.user_id == str(user_id),
                ChannelLinkCodeRow.gateway_id == gateway_id,
                ChannelLinkCodeRow.consumed_at.is_(None),
            )
            .values(consumed_at=now)
        )
        self.session.add(
            ChannelLinkCodeRow(
                code_hash=code_hash,
                user_id=str(user_id),
                gateway_id=gateway_id,
                expires_at=now + 600,
                consumed_at=None,
            )
        )
        self.commit()

    def cancel_codes(self, user_id, gateway_id, now):
        self.session.execute(
            update(ChannelLinkCodeRow)
            .where(
                ChannelLinkCodeRow.user_id == str(user_id),
                ChannelLinkCodeRow.gateway_id == gateway_id,
                ChannelLinkCodeRow.consumed_at.is_(None),
            )
            .values(consumed_at=now)
        )
        self.commit()

    def redeem(self, event, code_hash, now, now_ms):
        code = self.session.get(ChannelLinkCodeRow, code_hash)
        if (
            code is None
            or code.gateway_id != event.gateway_id
            or code.expires_at <= now
            or code.consumed_at is not None
        ):
            raise GatewayDenied("绑定码无效或已过期，请在 Everplain 重新生成。")
        current = self.active_binding(event.identity_key)
        if current is not None:
            raise GatewayDenied("此平台账号已绑定，请先在 Everplain 解除绑定。")
        changed = self.session.execute(
            update(ChannelLinkCodeRow)
            .where(
                ChannelLinkCodeRow.code_hash == code_hash,
                ChannelLinkCodeRow.consumed_at.is_(None),
                ChannelLinkCodeRow.expires_at > now,
            )
            .values(consumed_at=now)
        ).rowcount
        if changed != 1:
            raise GatewayDenied("绑定码已使用。")
        binding = ChannelBindingRow(
            binding_id=str(uuid4()),
            user_id=code.user_id,
            identity_key=event.identity_key,
            gateway_id=event.gateway_id,
            subject_id=event.subject_id,
            created_at=now,
            activated_at_ms=now_ms,
            revoked_at=None,
        )
        self.session.add(binding)
        try:
            self.session.flush()
        except IntegrityError as exc:
            raise GatewayBusy() from exc
        return binding

    def revoke(self, user_id, binding_id, now):
        row = self.binding(binding_id)
        if row is None or row.user_id != str(user_id):
            raise GatewayDenied("绑定不存在。")
        changed = self.session.execute(
            update(ChannelBindingRow)
            .where(
                ChannelBindingRow.binding_id == binding_id,
                ChannelBindingRow.user_id == str(user_id),
                ChannelBindingRow.revoked_at.is_(None),
            )
            .values(revoked_at=now, identity_key=None)
        ).rowcount
        if changed != 1:
            self.commit()
            return
        # Only the first revocation closes outstanding grants for this owner/bot.
        # Replaying an old DELETE must not consume a later explicit relink grant.
        self.session.execute(
            update(ChannelLinkCodeRow)
            .where(
                ChannelLinkCodeRow.user_id == str(user_id),
                ChannelLinkCodeRow.gateway_id == row.gateway_id,
                ChannelLinkCodeRow.consumed_at.is_(None),
            )
            .values(consumed_at=now)
        )
        self.commit()

    def event(self, key):
        return self.session.get(ChannelEventRow, key, populate_existing=True)

    def active_event(self, scope_key):
        scope = self.session.get(ChannelScopeRow, scope_key, populate_existing=True)
        return scope.active_event if scope else None

    def request_stop(self, event_key):
        changed = self.session.execute(
            update(ChannelEventRow).where(
                ChannelEventRow.event_key == event_key,
                ChannelEventRow.state.in_(("processing", "cancel_requested")),
            ).values(state="cancel_requested")
        ).rowcount
        self.commit()
        return bool(changed)

    def reserve(self, event, binding, now, *, control=False):
        # INSERT obtains a SQLite write transaction before checking leases, including
        # concurrent first deliveries. The whole reservation commits atomically.
        scope_key = (
            event.scope_key(binding.binding_id) if binding is not None and not control else None
        )
        self.session.execute(
            insert(ChannelEventRow)
            .values(
                event_key=event.event_key,
                gateway_id=event.gateway_id,
                payload_hash=event.payload_hash,
                binding_id=binding.binding_id if binding else None,
                scope_key=scope_key,
                state="pending",
                lease_until=0,
                created_at=now,
            )
            .on_conflict_do_nothing(index_elements=["event_key"])
        )
        row = self.event(event.event_key)
        if row.payload_hash != event.payload_hash:
            raise GatewayConflict("Event identity was reused with different content")
        # A binding command's saved receipt may acquire a binding after execution.
        if row.binding_id != (binding.binding_id if binding else None) and not (
            row.state == "complete" and event.text.startswith("/bind ")
        ):
            raise GatewayDenied("绑定已改变，旧消息不会继续处理。")
        if row.state == "complete":
            self.commit()
            return row, None
        if row.lease_until > now:
            raise GatewayBusy()
        conversation_id = None
        if scope_key is not None:
            self.session.execute(
                insert(ChannelScopeRow)
                .values(
                    scope_key=scope_key,
                    binding_id=binding.binding_id,
                    lease_until=0,
                )
                .on_conflict_do_nothing(index_elements=["scope_key"])
            )
            scope = self.session.get(ChannelScopeRow, scope_key, populate_existing=True)
            if scope.lease_until > now:
                raise GatewayBusy()
            scope.active_event = row.event_key
            scope.lease_until = now + 45
            conversation_id = scope.conversation_id
        if row.state != "cancel_requested":
            row.state = "processing"
        row.lease_token = str(uuid4())
        row.lease_until = now + 45
        self.commit()
        return row, conversation_id

    def renew(self, key, token, now, conversation_id=None):
        changed = self.session.execute(
            update(ChannelEventRow)
            .where(
                ChannelEventRow.event_key == key,
                ChannelEventRow.lease_token == token,
                ChannelEventRow.state.in_(("processing", "cancel_requested")),
                ChannelEventRow.lease_until > now,
            )
            .values(lease_until=now + 45)
        ).rowcount
        if changed != 1:
            raise GatewayBusy()
        row = self.event(key)
        if row.scope_key:
            values = {"lease_until": now + 45}
            if conversation_id:
                values["conversation_id"] = str(conversation_id)
            self.session.execute(
                update(ChannelScopeRow)
                .where(
                    ChannelScopeRow.scope_key == row.scope_key,
                    ChannelScopeRow.active_event == key,
                )
                .values(**values)
            )
        self.commit()

    def finish(self, key, token, answer, binding_id=None):
        values = {
            "answer": answer,
            "state": "complete" if answer is not None else "pending",
            "lease_until": 0,
        }
        if binding_id:
            values["binding_id"] = binding_id
        # The fence must be in the UPDATE, not a preceding Python check. A stale
        # worker must not publish an answer or release a replacement worker's lease.
        changed = self.session.execute(
            update(ChannelEventRow)
            .where(
                ChannelEventRow.event_key == key,
                ChannelEventRow.lease_token == token,
                ChannelEventRow.state.in_(("processing", "cancel_requested")),
                ChannelEventRow.lease_until > int(time.time()),
            )
            .values(**values)
        ).rowcount
        if changed != 1:
            raise GatewayBusy()
        row = self.event(key)
        if row.scope_key:
            self.session.execute(
                update(ChannelScopeRow)
                .where(
                    ChannelScopeRow.scope_key == row.scope_key,
                    ChannelScopeRow.active_event == key,
                )
                .values(lease_until=0, active_event=None)
            )
        self.commit()
        return row
