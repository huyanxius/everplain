"""Durable checkout reservations and transactional webhook replay protection."""

from dataclasses import replace
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text, select
from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.orm import Mapped, Session, mapped_column

from qunxue_api.adapters.sqlite.base import Base
from qunxue_api.adapters.sqlite.identity_model import UserRow
from qunxue_api.modules.subscriptions import (
    TERMINAL_STATUSES,
    CheckoutIntent,
    CheckoutResult,
    Subscription,
    SubscriptionConflict,
    SubscriptionEvent,
)


class SubscriptionRow(Base):
    __tablename__ = "subscriptions"
    provider_id: Mapped[str] = mapped_column(String(255), primary_key=True)
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.user_id", ondelete="CASCADE"),
        index=True,
    )
    customer_id: Mapped[str] = mapped_column(String(255))
    plan_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    status: Mapped[str] = mapped_column(String(24))
    current_period_end: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    cancel_at_period_end: Mapped[bool] = mapped_column(Boolean)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class SubscriptionCheckoutRow(Base):
    __tablename__ = "subscription_checkouts"
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.user_id", ondelete="CASCADE"),
        index=True,
    )
    plan_id: Mapped[str] = mapped_column(String(64))
    price_id: Mapped[str] = mapped_column(String(255))
    success_url: Mapped[str] = mapped_column(Text)
    cancel_url: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    session_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    checkout_url: Mapped[str | None] = mapped_column(Text, nullable=True)


class SubscriptionWebhookRow(Base):
    __tablename__ = "subscription_webhook_events"
    # No raw payload, signature, customer details or user data retained in this replay ledger.
    event_id: Mapped[str] = mapped_column(String(255), primary_key=True)
    event_type: Mapped[str] = mapped_column(String(120))
    processed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


def _utc(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=UTC)


def _subscription(row: SubscriptionRow) -> Subscription:
    return Subscription(
        user_id=UUID(row.user_id),
        provider_id=row.provider_id,
        customer_id=row.customer_id,
        plan_id=row.plan_id,
        status=row.status,
        cancel_at_period_end=row.cancel_at_period_end,
        created_at=_utc(row.created_at),
        current_period_end=_utc(row.current_period_end) if row.current_period_end else None,
    )


class SqliteSubscriptionRepository:
    def __init__(self, session: Session):
        self.session = session

    def get(self, user_id: UUID) -> Subscription | None:
        rows = self.session.scalars(
            select(SubscriptionRow).where(
                SubscriptionRow.user_id == str(user_id),
            )
        ).all()
        if not rows:
            return None
        # A late event for an old canceled subscription cannot hide a newer active one.
        row = max(rows, key=lambda row: (row.status not in TERMINAL_STATUSES, _utc(row.created_at)))
        return _subscription(row)

    def reserve_checkout(self, intent: CheckoutIntent) -> CheckoutIntent:
        # The first write locks SQLite before any concurrency-sensitive reads.
        inserted = self.session.execute(
            insert(SubscriptionCheckoutRow)
            .values(
                key=intent.key,
                user_id=str(intent.user_id),
                plan_id=intent.plan_id,
                price_id=intent.price_id,
                success_url=intent.success_url,
                cancel_url=intent.cancel_url,
                created_at=intent.created_at,
            )
            .on_conflict_do_nothing()
        ).rowcount
        row = self.session.get(SubscriptionCheckoutRow, intent.key)
        if row is None or row.user_id != str(intent.user_id) or row.plan_id != intent.plan_id:
            raise SubscriptionConflict("重复请求与原始订阅不一致")
        age = intent.created_at - _utc(row.created_at)
        if age >= timedelta(hours=1):
            raise SubscriptionConflict("结账会话已过期，请重新开始")
        if not inserted:
            result = CheckoutResult(row.checkout_url, row.session_id) if row.session_id else None
            if result is None and age >= timedelta(minutes=25):
                raise SubscriptionConflict("结账结果待确认，请稍后重新开始")
            return replace(
                intent,
                price_id=row.price_id,
                success_url=row.success_url,
                cancel_url=row.cancel_url,
                created_at=_utc(row.created_at),
                result=result,
            )
        current = self.get(intent.user_id)
        if current and current.status not in TERMINAL_STATUSES:
            raise SubscriptionConflict("已有订阅，请先处理当前订阅")
        other = self.session.scalar(
            select(SubscriptionCheckoutRow.key)
            .where(
                SubscriptionCheckoutRow.user_id == str(intent.user_id),
                SubscriptionCheckoutRow.key != intent.key,
                SubscriptionCheckoutRow.created_at > intent.created_at - timedelta(hours=1),
            )
            .limit(1)
        )
        if other:
            raise SubscriptionConflict("已有结账会话，请继续原会话或等待过期")
        return intent

    def complete_checkout(self, intent: CheckoutIntent, result: CheckoutResult) -> None:
        row = self.session.get(SubscriptionCheckoutRow, intent.key)
        if row is None or row.user_id != str(intent.user_id):
            raise SubscriptionConflict("结账会话不存在")
        if row.session_id is not None and row.session_id != result.session_id:
            raise SubscriptionConflict("结账会话发生冲突")
        row.session_id, row.checkout_url = result.session_id, result.checkout_url
        self.session.flush()

    def claim_event(self, event: SubscriptionEvent, now: datetime) -> bool:
        return (
            self.session.execute(
                insert(SubscriptionWebhookRow)
                .values(
                    event_id=event.id,
                    event_type=event.type,
                    processed_at=now,
                )
                .on_conflict_do_nothing()
            ).rowcount
            == 1
        )

    def save_subscription(self, value: Subscription) -> None:
        user = self.session.get(UserRow, str(value.user_id))
        if user is None or user.status != "active":
            return  # Never recreate erased account data via a delayed webhook.
        existing = self.session.get(SubscriptionRow, value.provider_id)
        if existing and (
            existing.user_id != str(value.user_id) or existing.customer_id != value.customer_id
        ):
            raise SubscriptionConflict("订阅所属账号不一致")
        other_owner = self.session.scalar(
            select(SubscriptionRow.provider_id)
            .where(
                SubscriptionRow.customer_id == value.customer_id,
                SubscriptionRow.user_id != str(value.user_id),
            )
            .limit(1)
        )
        if other_owner:
            raise SubscriptionConflict("订阅所属账号不一致")
        row = existing or SubscriptionRow(provider_id=value.provider_id)
        row.user_id, row.customer_id, row.plan_id = (
            str(value.user_id),
            value.customer_id,
            value.plan_id,
        )
        row.status, row.current_period_end = value.status, value.current_period_end
        row.cancel_at_period_end, row.created_at = value.cancel_at_period_end, value.created_at
        self.session.add(row)
        self.session.flush()


def has_open_billing_commitment(session: Session, user_id: UUID, now: datetime) -> bool:
    """Account-erasure guard; call within its transaction, after acquiring the write lock.

    Never interpret local erasure as cancellation of recurring Stripe charges.
    An unexpired checkout could finish while a cancellation webhook is still in flight.
    """
    subscription = session.scalar(
        select(SubscriptionRow.provider_id)
        .where(
            SubscriptionRow.user_id == str(user_id),
            SubscriptionRow.status.not_in(TERMINAL_STATUSES),
        )
        .limit(1)
    )
    if subscription is not None:
        return True
    checkout = session.scalar(
        select(SubscriptionCheckoutRow.key)
        .where(
            SubscriptionCheckoutRow.user_id == str(user_id),
            SubscriptionCheckoutRow.created_at > now - timedelta(hours=1),
        )
        .limit(1)
    )
    return checkout is not None
