"""Personal 168-hour quota epochs, under the caller's SQLite writer transaction.

Closed epochs retain their own balance and exact carry for delayed provider receipts.
No history, old policy snapshots, reset fences or audit rows are rewritten.
"""

import json
from datetime import UTC, datetime, timedelta
from fractions import Fraction
from uuid import NAMESPACE_URL, uuid5

from sqlalchemy import text

from qunxue_api.modules.subscriptions import MEMBERSHIP_WEEKLY_POINTS

FREE_WEEKLY_POINTS = 30
PERIOD_LENGTH = timedelta(hours=168)


class QuotaConfigurationUnavailable(RuntimeError):
    code = "quota_configuration_unavailable"


def _utc(value):
    if isinstance(value, str):
        value = datetime.fromisoformat(value)
    return value if value.tzinfo else value.replace(tzinfo=UTC)


def _exists(conn, table):
    return bool(
        conn.scalar(
            text("SELECT 1 FROM sqlite_master WHERE type='table' AND name=:table"), {"table": table}
        )
    )


def current_plan_entitlement(conn, user_id, now, plan_limits=None):
    """Select an effective subscription, never a queued future voucher."""
    plan, starts_at, ends_at = "free", None, None
    if _exists(conn, "subscriptions"):
        rows = (
            conn.execute(
                text(
                    "SELECT plan_id,current_period_start,current_period_end FROM subscriptions "
                    "WHERE user_id=:user AND status IN ('active','trialing') "
                    "ORDER BY created_at DESC,provider_id DESC"
                ),
                {"user": str(user_id)},
            )
            .mappings()
            .all()
        )
        for row in rows:
            start = _utc(row["current_period_start"]) if row["current_period_start"] else None
            end = _utc(row["current_period_end"]) if row["current_period_end"] else None
            if (start is None or start <= _utc(now)) and (end is None or end > _utc(now)):
                plan = row["plan_id"] or "unconfigured"
                starts_at, ends_at = start, end
                break
    limits = {**MEMBERSHIP_WEEKLY_POINTS, **(plan_limits or {})}
    limit = FREE_WEEKLY_POINTS if plan == "free" else limits.get(plan)
    if type(limit) is not int or limit <= 0:
        raise QuotaConfigurationUnavailable("current subscription quota is not configured")
    return plan, limit, starts_at, ends_at


def current_plan_quota(conn, user_id, now, plan_limits=None):
    return current_plan_entitlement(conn, user_id, now, plan_limits)[:2]


def get_quota_period(conn, user_id, epoch):
    if epoch is None or not _exists(conn, "credit_quota_periods"):
        return None
    row = (
        conn.execute(
            text(
                "SELECT p.*,a.quota_period_epoch=p.epoch AS is_current "
                "FROM credit_quota_periods p JOIN credit_accounts a ON a.user_id=p.user_id "
                "WHERE p.user_id=:user AND p.epoch=:epoch"
            ),
            {"user": str(user_id), "epoch": epoch},
        )
        .mappings()
        .first()
    )
    return dict(row) if row else None


def settle_quota_period(conn, user_id, epoch, balance, total_credit_pico, now):
    """Mirror only the current epoch; an old receipt can never consume renewed quota."""
    period = get_quota_period(conn, user_id, epoch)
    if period is None:
        raise RuntimeError("billing quota epoch is missing")
    if type(balance) is not int or balance < 0 or Fraction(total_credit_pico) < 0:
        raise ValueError("invalid quota settlement")
    args = dict(
        user=str(user_id),
        epoch=epoch,
        balance=balance,
        precision=str(total_credit_pico),
        now=_utc(now).isoformat(),
    )
    conn.execute(
        text(
            "UPDATE credit_quota_periods SET balance=:balance,total_credit_pico=:precision "
            "WHERE user_id=:user AND epoch=:epoch"
        ),
        args,
    )
    if period["is_current"]:
        conn.execute(
            text(
                "UPDATE credit_accounts SET balance=:balance,updated_at=:now "
                "WHERE user_id=:user AND quota_period_epoch=:epoch"
            ),
            args,
        )
        if _exists(conn, "billing_precision"):
            conn.execute(
                text(
                    "INSERT INTO billing_precision(user_id,total_credit_pico) "
                    "VALUES(:user,:precision) "
                    "ON CONFLICT(user_id) DO UPDATE "
                    "SET total_credit_pico=excluded.total_credit_pico"
                ),
                args,
            )


def ensure_quota_period(
    conn,
    user_id,
    now,
    plan_limits=None,
    *,
    start=True,
    reset=False,
    receipt_id=None,
    reset_reason="bank_reset",
):
    """Start only at accepted message-operation creation; GET may renew an existing epoch.

    First activation archives historical balance/carry. Every new epoch restores
    the current plan's full allowance, recording only the net delta.
    """
    if not _exists(conn, "credit_quota_periods"):
        return None
    now = _utc(now)
    user_id = str(user_id)
    # Safe for Session callers too: obtain the writer lock before any epoch read.
    conn.execute(
        text("UPDATE credit_accounts SET balance=balance WHERE user_id=:user"), {"user": user_id}
    )
    account = (
        conn.execute(
            text("SELECT balance,quota_period_epoch FROM credit_accounts WHERE user_id=:user"),
            {"user": user_id},
        )
        .mappings()
        .first()
    )
    if account is None:
        raise RuntimeError("credit account is missing")
    period = get_quota_period(conn, user_id, account["quota_period_epoch"])
    if period and not reset and now < _utc(period["expires_at"]):
        return period
    if period is None and not start and not reset:
        return None
    plan, limit, membership_start, membership_end = current_plan_entitlement(
        conn, user_id, now, plan_limits
    )
    precision = "0"
    if _exists(conn, "billing_precision"):
        precision = (
            conn.scalar(
                text("SELECT total_credit_pico FROM billing_precision WHERE user_id=:user"),
                {"user": user_id},
            )
            or "0"
        )
    if period:
        # Snapshot the account mirror before closing; legacy callbacks retain epoch 0.
        settle_quota_period(conn, user_id, period["epoch"], account["balance"], precision, now)
        conn.execute(
            text(
                "UPDATE credit_quota_periods SET closed_at=:now "
                "WHERE user_id=:user AND epoch=:epoch"
            ),
            {"user": user_id, "epoch": period["epoch"], "now": now.isoformat()},
        )
    else:
        # Existing in-flight legacy operations bind to a closed epoch, never the reset grant.
        conn.execute(
            text(
                "INSERT INTO credit_quota_periods "
                "(user_id,epoch,plan_id,limit_points,started_at,expires_at,balance,total_credit_pico,"
                "closed_at,reason) VALUES(:user,0,:plan,:limit,:now,:now,:balance,:precision,:now,"
                "'legacy_before_quota')"
            ),
            dict(
                user=user_id,
                plan=plan,
                limit=limit,
                now=now.isoformat(),
                balance=account["balance"],
                precision=precision,
            ),
        )
    epoch = (period["epoch"] + 1) if period else 1
    anchor = now
    if period and not reset:
        expiry = _utc(period["expires_at"])
        anchor = expiry + ((now - expiry) // PERIOD_LENGTH) * PERIOD_LENGTH
    if (
        membership_start is not None
        and not reset
        and (period is None or membership_start > _utc(period["started_at"]))
    ):
        # A new membership starts its own cadence; within it, retain the current
        # epoch's cadence, including a new anchor established by bank RESET.
        anchor = membership_start + ((now - membership_start) // PERIOD_LENGTH) * PERIOD_LENGTH
    expires_at = anchor + PERIOD_LENGTH
    if membership_end is not None:
        expires_at = min(expires_at, membership_end)
    balance = limit
    new_precision = "0"
    conn.execute(
        text(
            "INSERT INTO credit_quota_periods "
            "(user_id,epoch,plan_id,limit_points,started_at,expires_at,"
            "balance,total_credit_pico,reason) "
            "VALUES(:user,:epoch,:plan,:limit,:start,:end,:balance,:precision,:reason)"
        ),
        dict(
            user=user_id,
            epoch=epoch,
            plan=plan,
            limit=limit,
            start=anchor.isoformat(),
            end=expires_at.isoformat(),
            balance=balance,
            precision=new_precision,
            reason=reset_reason if reset else ("weekly_quota" if period else "quota_activation"),
        ),
    )
    # Bind unresolved pre-upgrade operations before selecting the new current epoch.
    if _exists(conn, "billing_operations"):
        conn.execute(
            text(
                "UPDATE billing_operations SET quota_period_epoch=:old "
                "WHERE user_id=:user AND quota_period_epoch IS NULL"
            ),
            {"user": user_id, "old": period["epoch"] if period else 0},
        )
    # Legacy non-durable leases cannot charge a newly restored allowance.
    columns = {row[1] for row in conn.execute(text("PRAGMA table_info(credit_accounts)"))}
    if "active_run_id" in columns:
        conn.execute(
            text(
                "UPDATE credit_accounts SET active_run_id=NULL,"
                "active_run_expires_at=NULL WHERE user_id=:user"
            ),
            {"user": user_id},
        )
    conn.execute(
        text(
            "UPDATE credit_accounts SET quota_period_epoch=:epoch,balance=:balance,updated_at=:now "
            "WHERE user_id=:user"
        ),
        dict(user=user_id, epoch=epoch, balance=balance, now=now.isoformat()),
    )
    if _exists(conn, "billing_precision"):
        conn.execute(
            text(
                "INSERT INTO billing_precision(user_id,total_credit_pico) "
                "VALUES(:user,:precision) "
                "ON CONFLICT(user_id) DO UPDATE "
                "SET total_credit_pico=excluded.total_credit_pico"
            ),
            {"user": user_id, "precision": new_precision},
        )
    entry_id = receipt_id or str(uuid5(NAMESPACE_URL, f"everplain-weekly-quota:{user_id}:{epoch}"))
    conn.execute(
        text(
            "INSERT INTO credit_ledger(entry_id,user_id,run_id,kind,points,"
            "balance_after,quota_period_epoch,"
            "input_tokens,output_tokens,model,created_at) "
            "VALUES(:id,:user,NULL,'redemption',:delta,:balance,:epoch,0,0,:model,:now)"
        ),
        dict(
            id=entry_id,
            user=user_id,
            epoch=epoch,
            delta=balance - account["balance"],
            balance=balance,
            model=reset_reason.replace("_", "-")
            if reset
            else ("weekly-quota-renewal" if period else "quota-activation"),
            now=now.isoformat(),
        ),
    )
    conn.execute(
        text(
            "INSERT INTO billing_precision_adjustments "
            "(reset_id,user_id,reason,before_precision,delta_precision,after_precision,"
            "before_balance,delta_points,after_balance,closed_operation_ids,created_at) "
            "VALUES(:id,:user,:reason,:before,:delta_precision,:after,:balance,:delta,:after_balance,"
            ":closed,:now)"
        ),
        dict(
            id=entry_id,
            user=user_id,
            reason=reset_reason
            if reset
            else ("weekly_quota_renewal" if period else "quota_activation"),
            before=precision,
            delta_precision=str(-Fraction(precision)),
            after=new_precision,
            balance=account["balance"],
            delta=balance - account["balance"],
            after_balance=balance,
            closed=json.dumps([]),
            now=now.isoformat(),
        ),
    )
    return get_quota_period(conn, user_id, epoch)
