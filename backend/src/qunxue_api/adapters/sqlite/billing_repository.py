import json
from datetime import UTC, datetime, timedelta
from fractions import Fraction
from uuid import NAMESPACE_URL, UUID, uuid4, uuid5

from sqlalchemy import case, func, select, text, update
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from qunxue_api.adapters.sqlite.billing_model import (
    CreditAccountRow,
    CreditLedgerRow,
    CreditRedemptionCodeRow,
)
from qunxue_api.adapters.sqlite.quota_periods import (
    ensure_quota_period,
    get_quota_period,
)
from qunxue_api.modules.billing import (
    SIGNUP_GRANT,
    CreditCodeBatchConflict,
    CreditCodeSpec,
    CreditCodeUnavailable,
    CreditEntry,
    CreditRedemption,
    CreditsDepleted,
    CreditSummary,
)

_RESERVATION_LEASE = timedelta(minutes=10)


def _as_utc(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


class SqliteCreditRepository:
    def __init__(self, session: Session, *, plan_limits=None, clock=None) -> None:
        self._session = session
        self._plan_limits = plan_limits or {}
        self._clock = clock or (lambda: datetime.now(UTC))

    def ensure_welcome_grant(
        self,
        *,
        user_id: UUID,
        points: int,
        now: datetime,
    ) -> CreditSummary:
        existing = self.get_summary(user_id=user_id, offset=0, limit=50)
        if existing is not None:
            return existing
        self._session.execute(
            sqlite_insert(CreditAccountRow)
            .values(
                user_id=str(user_id),
                balance=points,
                active_run_id=None,
                active_run_expires_at=None,
                created_at=now,
                updated_at=now,
            )
            .on_conflict_do_nothing(index_elements=["user_id"])
        )
        self._session.execute(
            sqlite_insert(CreditLedgerRow)
            .values(
                entry_id=str(user_id),
                user_id=str(user_id),
                run_id=None,
                kind="signup_grant",
                points=points,
                balance_after=points,
                input_tokens=0,
                output_tokens=0,
                model=None,
                created_at=now,
            )
            .on_conflict_do_nothing(index_elements=["entry_id"])
        )
        self._session.flush()
        summary = self.get_summary(user_id=user_id, offset=0, limit=50)
        if summary is None:
            raise RuntimeError("welcome credit grant was not persisted")
        return summary

    def get_summary(
        self,
        *,
        user_id: UUID,
        limit: int,
        offset: int = 0,
    ) -> CreditSummary | None:
        account = self._session.get(CreditAccountRow, str(user_id))
        if account is None:
            return None
        period = ensure_quota_period(
            self._session.connection(), user_id, self._clock(), self._plan_limits, start=False
        )
        self._session.refresh(account)
        total_entries = (
            self._session.scalar(
                select(func.count())
                .select_from(CreditLedgerRow)
                .where(
                    CreditLedgerRow.user_id == str(user_id),
                    CreditLedgerRow.kind == "usage",
                )
            )
            or 0
        )
        page_limit = max(1, min(limit, 100))
        rows = self._session.scalars(
            select(CreditLedgerRow)
            .where(
                CreditLedgerRow.user_id == str(user_id),
                CreditLedgerRow.kind == "usage",
            )
            .order_by(
                CreditLedgerRow.created_at.desc(),
                case((CreditLedgerRow.kind == "usage", 1), else_=0).desc(),
                CreditLedgerRow.entry_id.desc(),
            )
            .offset(max(0, offset))
            .limit(page_limit)
        ).all()
        frozen, operations = self._billing_details(user_id, page_limit, offset)
        grants = self._session.scalars(
            select(CreditLedgerRow).where(
                CreditLedgerRow.user_id == str(user_id), CreditLedgerRow.kind != "usage"
            )
        ).all()
        welcome_only = (
            len(grants) == 1
            and grants[0].kind == "signup_grant"
            and 0 <= account.balance <= grants[0].points
        )
        baseline = (grants[0].entry_id, grants[0].points) if welcome_only else None
        reset_table = self._session.scalar(
            text(
                "SELECT 1 FROM sqlite_master WHERE type='table' "
                "AND name='billing_precision_adjustments'"
            )
        )
        if reset_table:
            reset = (
                self._session.execute(
                    text(
                        "SELECT * FROM billing_precision_adjustments WHERE user_id=:user "
                        "ORDER BY julianday(created_at) DESC, rowid DESC LIMIT 1"
                    ),
                    {"user": str(user_id)},
                )
                .mappings()
                .first()
            )
            if reset is not None:
                baseline = None
                entry_id = str(
                    uuid5(NAMESPACE_URL, f"everplain-balance-reset:{reset['reset_id']}:{user_id}")
                )
                receipt = next((g for g in grants if g.entry_id == entry_id), None)
                later_grants = self._session.scalar(
                    text(
                        "SELECT count(*) FROM credit_ledger WHERE user_id=:user "
                        "AND kind!='usage' AND entry_id!=:entry "
                        "AND julianday(created_at)>=julianday(:created)"
                    ),
                    {"user": str(user_id), "entry": entry_id, "created": reset["created_at"]},
                )
                if (
                    reset["reason"] == "user_requested_all_accounts_reset"
                    and reset["after_precision"] == "0"
                    and reset["after_balance"] > 0
                    and receipt is not None
                    and receipt.kind == "redemption"
                    and receipt.model == "admin-balance-reset"
                    and receipt.points == reset["delta_points"]
                    and receipt.balance_after == reset["after_balance"]
                    and not later_grants
                    and 0 <= account.balance <= reset["after_balance"]
                ):
                    baseline = (entry_id, reset["after_balance"])
        # Read the integer balance and fractional carry in one SQL snapshot.
        # A hold is authorization capacity, not settled consumption.
        precision_exists = self._session.scalar(
            text("SELECT 1 FROM sqlite_master WHERE type='table' AND name='billing_precision'")
        )
        projection_sql = (
            "SELECT a.balance, p.total_credit_pico FROM credit_accounts a "
            "LEFT JOIN billing_precision p ON p.user_id=a.user_id WHERE a.user_id=:user"
            if precision_exists
            else ("SELECT balance, NULL AS total_credit_pico "
                  "FROM credit_accounts WHERE user_id=:user")
        )
        projection = self._session.execute(text(projection_sql), {"user": str(user_id)}).one()
        exact = Fraction(projection.total_credit_pico or "0") / 10**12
        settled_remaining = max(Fraction(0), Fraction(projection.balance) - (exact % 1))
        # Only an unmixed signup grant or a receipted reset establishes this
        # free allowance. Historical redemption amounts are not a denominator.
        if period:
            baseline = (f"quota:{user_id}:{period['epoch']}", period["limit_points"])
        buckets = (
            (
                {
                    "bucket_id": baseline[0],
                    "kind": "subscription" if period else "welcome",
                    "available_points": max(0, account.balance - frozen),
                    "limit_points": baseline[1],
                    "expires_at": _as_utc(datetime.fromisoformat(period["expires_at"]))
                    if period
                    else None,
                    "settled_remaining_points": float(settled_remaining),
                },
            )
            if baseline
            else ()
        )
        return CreditSummary(
            balance=account.balance,
            frozen_points=frozen,
            available_balance=max(0, account.balance - frozen),
            operations=operations,
            total_granted_points=baseline[1] if baseline else None,
            active_usage_buckets=buckets,
            quota_status="known" if baseline else "unavailable",
            quota_period_started_at=(
                datetime.fromisoformat(period["started_at"]) if period else None
            ),
            quota_period_expires_at=(
                datetime.fromisoformat(period["expires_at"]) if period else None
            ),
            quota_plan_id=period["plan_id"] if period else None,
            entries=tuple(self._entry(row) for row in rows),
            total_entries=total_entries,
            next_cursor=(str(offset + page_limit) if offset + page_limit < total_entries else None),
        )

    def create_redemption_codes(self, *, codes: tuple[CreditCodeSpec, ...]) -> None:
        if not codes:
            return
        first = codes[0]
        values = [
            {
                "code_id": str(code.code_id),
                "code_hash": code.code_hash,
                "batch_id": code.batch_id,
                "code_index": code.code_index,
                "created_by_user_id": str(code.created_by_user_id),
                "created_at": code.created_at,
                "expires_at": code.expires_at,
                "redeemed_by_user_id": None,
                "redeemed_at": None,
            }
            for code in codes
        ]
        self._session.execute(
            sqlite_insert(CreditRedemptionCodeRow).values(values).on_conflict_do_nothing()
        )
        self._session.flush()
        stored = self._session.scalars(
            select(CreditRedemptionCodeRow)
            .where(
                CreditRedemptionCodeRow.created_by_user_id == str(first.created_by_user_id),
                CreditRedemptionCodeRow.batch_id == first.batch_id,
            )
            .order_by(CreditRedemptionCodeRow.code_index)
        ).all()
        if len(stored) != len(codes) or any(
            row.code_index != code.code_index
            or row.code_hash != code.code_hash
            or _as_utc(row.expires_at) != _as_utc(code.expires_at)
            for row, code in zip(stored, codes, strict=True)
        ):
            raise CreditCodeBatchConflict

    def redeem_code(
        self,
        *,
        user_id: UUID,
        code_hash: str,
        now: datetime,
    ) -> CreditRedemption:
        # A no-op account UPDATE acquires SQLite's writer lock before reading
        # frozen funds or claiming the code. DurableBilling reserves with BEGIN
        # IMMEDIATE, so a new hold cannot interleave with this balance reset.
        # The caller's existing transaction owns the lock through commit/rollback.
        self._session.execute(
            update(CreditAccountRow)
            .where(CreditAccountRow.user_id == str(user_id))
            .values(balance=CreditAccountRow.balance)
            .execution_options(synchronize_session=False)
        )
        code = self._session.scalar(
            select(CreditRedemptionCodeRow).where(CreditRedemptionCodeRow.code_hash == code_hash)
        )
        if code is None or _as_utc(code.expires_at) <= _as_utc(now):
            raise CreditCodeUnavailable
        if code.redeemed_by_user_id is not None:
            if code.redeemed_by_user_id != str(user_id):
                raise CreditCodeUnavailable
            replay = self._session.get(CreditLedgerRow, code.code_id)
            if replay is None:
                raise RuntimeError("redeemed credit code is missing its ledger entry")
            receipt_period = get_quota_period(
                self._session.connection(), user_id, replay.quota_period_epoch
            )
            return CreditRedemption(
                quota_period_started_at=(
                    datetime.fromisoformat(receipt_period["started_at"]) if receipt_period else None
                ),
                quota_period_expires_at=(
                    datetime.fromisoformat(receipt_period["expires_at"]) if receipt_period else None
                ),
                redeemed_points=replay.balance_after,
                delta_points=replay.points,
                balance=self._current_balance(user_id),
            )

        claimed = self._session.execute(
            update(CreditRedemptionCodeRow)
            .where(
                CreditRedemptionCodeRow.code_id == code.code_id,
                CreditRedemptionCodeRow.redeemed_by_user_id.is_(None),
                CreditRedemptionCodeRow.expires_at >= now,
            )
            .values(redeemed_by_user_id=str(user_id), redeemed_at=now)
            .execution_options(synchronize_session=False)
        )
        if claimed.rowcount != 1:
            self._session.expire(code)
            refreshed = self._session.get(CreditRedemptionCodeRow, code.code_id)
            if refreshed is not None and refreshed.redeemed_by_user_id == str(user_id):
                replay = self._session.get(CreditLedgerRow, code.code_id)
                if replay is not None:
                    return CreditRedemption(
                        redeemed_points=replay.balance_after,
                        delta_points=replay.points,
                        balance=self._current_balance(user_id),
                    )
            raise CreditCodeUnavailable

        period = ensure_quota_period(
            self._session.connection(),
            user_id,
            now,
            self._plan_limits,
            reset=True,
            receipt_id=code.code_id,
        )
        if period is None:
            raise RuntimeError("bank RESET requires the weekly quota migration")
        self._session.expire_all()
        self._session.flush()
        receipt = self._session.get(CreditLedgerRow, code.code_id)
        return CreditRedemption(
            redeemed_points=period["limit_points"],
            balance=period["balance"],
            delta_points=receipt.points,
            quota_period_started_at=datetime.fromisoformat(period["started_at"]),
            quota_period_expires_at=datetime.fromisoformat(period["expires_at"]),
        )

    def reserve_usage(self, *, user_id: UUID, run_id: UUID, now: datetime) -> None:
        if self._session.get(CreditAccountRow, str(user_id)) is None:
            self.ensure_welcome_grant(user_id=user_id, points=SIGNUP_GRANT, now=now)
        ensure_quota_period(self._session.connection(), user_id, now, self._plan_limits)
        for _attempt in range(2):
            changed = self._session.execute(
                update(CreditAccountRow)
                .where(
                    CreditAccountRow.user_id == str(user_id),
                    CreditAccountRow.balance > 0,
                )
                .values(
                    active_run_id=str(run_id),
                    active_run_expires_at=now + _RESERVATION_LEASE,
                    updated_at=now,
                )
            )
            if changed.rowcount == 1:
                self._session.flush()
                return
            account = self._session.get(
                CreditAccountRow,
                str(user_id),
                populate_existing=True,
            )
            if account is None:
                self.ensure_welcome_grant(
                    user_id=user_id,
                    points=SIGNUP_GRANT,
                    now=now,
                )
                continue
            if account.balance <= 0:
                raise CreditsDepleted
            if account.active_run_id == str(run_id):
                return
            # A new foreground turn owns the account lease. The displaced run
            # cannot charge because charge_usage still requires this exact ID.
            continue
        raise RuntimeError("credit reservation could not be created")

    def release_usage(self, *, user_id: UUID, run_id: UUID, now: datetime) -> None:
        self._session.execute(
            update(CreditAccountRow)
            .where(
                CreditAccountRow.user_id == str(user_id),
                CreditAccountRow.active_run_id == str(run_id),
            )
            .values(
                active_run_id=None,
                active_run_expires_at=None,
                updated_at=now,
            )
        )
        self._session.flush()

    def charge_usage(
        self,
        *,
        user_id: UUID,
        run_id: UUID,
        points: int,
        input_tokens: int,
        output_tokens: int,
        model: str,
        now: datetime,
    ) -> CreditEntry:
        for _attempt in range(2):
            replay = self._session.scalar(
                select(CreditLedgerRow).where(CreditLedgerRow.run_id == str(run_id))
            )
            if replay is not None:
                return self._entry(replay)
            account = self._session.get(CreditAccountRow, str(user_id), populate_existing=True)
            if account is None:
                raise RuntimeError("credit account is missing")
            if account.active_run_id != str(run_id):
                raise RuntimeError("credit usage was not reserved for this run")
            previous_balance = account.balance
            charged_points = min(points, previous_balance)
            balance_after = previous_balance - charged_points
            changed = self._session.execute(
                update(CreditAccountRow)
                .where(
                    CreditAccountRow.user_id == str(user_id),
                    CreditAccountRow.balance == previous_balance,
                    CreditAccountRow.active_run_id == str(run_id),
                )
                .values(
                    balance=balance_after,
                    active_run_id=None,
                    active_run_expires_at=None,
                    updated_at=now,
                )
            )
            if changed.rowcount != 1:
                self._session.expire(account)
                continue
            row = CreditLedgerRow(
                entry_id=str(uuid4()),
                user_id=str(user_id),
                run_id=str(run_id),
                kind="usage",
                points=-charged_points,
                balance_after=balance_after,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                model=model[:128],
                created_at=now,
            )
            self._session.add(row)
            self._session.flush()
            return self._entry(row)
        raise RuntimeError("credit balance changed concurrently")

    def _billing_details(self, user_id, limit, offset):
        exists = self._session.scalar(
            text("SELECT 1 FROM sqlite_master WHERE type='table' AND name='billing_operations'")
        )
        if not exists:
            return 0, ()
        frozen = self._session.scalar(
            text(
                "SELECT coalesce(sum(hold_points),0) "
                "FROM billing_operations WHERE user_id=:user AND status='active' AND "
                "(quota_period_epoch IS NULL OR quota_period_epoch=(SELECT quota_period_epoch "
                "FROM credit_accounts WHERE user_id=:user))"
            ),
            {"user": str(user_id)},
        )
        rows = (
            self._session.execute(
                text(
                    "SELECT * FROM billing_operations WHERE user_id=:user "
                    "ORDER BY created_at DESC,run_id DESC LIMIT :limit OFFSET :offset"
                ),
                {"user": str(user_id), "limit": limit, "offset": max(0, offset)},
            )
            .mappings()
            .all()
        )
        operations = []
        for row in rows:
            prices = json.loads(row["price_json"])
            attempts = (
                self._session.execute(
                    text(
                        "SELECT attempt_id,endpoint_id,provider_host,api_type,"
                        "requested_model,returned_model,requested_effort,requested_service_tier"
                        ",billable,"
                        "returned_service_tier,provider_response_id,outcome,usage_state,input_t"
                        "okens,"
                        "cache_read_tokens,cache_write_tokens,output_tokens,reasoning_tokens,fi"
                        "nish_reason,"
                        "reference_cost_pico,procurement_cost_pico,procurement_status,overrun_c"
                        "ost_pico,"
                        "failure_code,price_json,raw_usage_json,created_at,updated_at "
                        "FROM billing_attempts WHERE "
                        "run_id=:run "
                        "ORDER BY created_at,attempt_id"
                    ),
                    {"run": row["run_id"]},
                )
                .mappings()
                .all()
            )
            operations.append(
                {
                    "operation_id": row["run_id"],
                    "outcome": row["status"],
                    "frozen_points": row["hold_points"],
                    "points_charged": row["charged_points"],
                    "exact_credit_numerator": str(Fraction(row["credit_pico"]).numerator),
                    "exact_credit_denominator": str(Fraction(row["credit_pico"]).denominator),
                    "original_credit_numerator": str(
                        Fraction(row["original_credit_pico"]).numerator
                    ),
                    "original_credit_denominator": str(
                        Fraction(row["original_credit_pico"]).denominator
                    ),
                    "credit_scale": "1000000000000",
                    "price_version": prices["version"],
                    "credits_per_usd": prices["credits_per_usd"],
                    "reference_currency": "USD",
                    "retail_snapshot": {
                        key: prices.get(key)
                        for key in (
                            "points_per_cny",
                            "retail_rate_ppm",
                            "fx_cny_per_usd_micro",
                            "fx_snapshot_id",
                            "fx_as_of",
                            "fx_source",
                            "procurement_estimate_source",
                            "procurement_estimate_ratio",
                        )
                    },
                    "exempt": bool(row["exempt"]),
                    "created_at": row["created_at"],
                    "attempts": [
                        {
                            **{
                                key: value
                                for key, value in a.items()
                                if key not in {"price_json", "raw_usage_json"}
                            },
                            "price_snapshot": json.loads(a["price_json"]),
                            **(
                                {"search_usage": json.loads(a["raw_usage_json"] or "{}")}
                                if a["api_type"] == "tavily_search"
                                else {}
                            ),
                        }
                        for a in attempts
                    ],
                }
            )
        return frozen, tuple(operations)

    def _current_balance(self, user_id: UUID) -> int:
        account = self._session.get(
            CreditAccountRow,
            str(user_id),
            populate_existing=True,
        )
        if account is None:
            raise RuntimeError("credit account is missing during redemption replay")
        return account.balance

    @staticmethod
    def _entry(row: CreditLedgerRow) -> CreditEntry:
        return CreditEntry(
            entry_id=UUID(row.entry_id),
            kind=row.kind,  # type: ignore[arg-type]
            points=row.points,
            balance_after=row.balance_after,
            input_tokens=row.input_tokens,
            output_tokens=row.output_tokens,
            model=row.model,
            created_at=_as_utc(row.created_at),
            quota_period_epoch=row.quota_period_epoch,
        )
