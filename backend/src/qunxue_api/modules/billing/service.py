import base64
import hashlib
import hmac
from collections.abc import Callable, Collection, Mapping
from datetime import UTC, datetime, time, timedelta
from uuid import NAMESPACE_URL, UUID, uuid5

from qunxue_api.modules.billing.domain import (
    SIGNUP_GRANT,
    CreditCodeSpec,
    CreditEntry,
    CreditRedemption,
    CreditsDepleted,
    CreditSummary,
    GeneratedCreditCodeBatch,
    usage_credit_cost,
)
from qunxue_api.modules.billing.ports import CreditRepository
from qunxue_api.modules.subscriptions import MEMBERSHIP_WEEKLY_POINTS, membership_plan


class CreditService:
    def __init__(
        self,
        repository: CreditRepository,
        *,
        clock: Callable[[], datetime] | None = None,
        exempt_user_ids: Collection[UUID] = (),
        code_signing_secret: str | None = None,
        plan_limits: Mapping[str, int] | None = None,
    ) -> None:
        self._repository = repository
        self._clock = clock or (lambda: datetime.now(UTC))
        self._exempt_user_ids = frozenset(exempt_user_ids)
        self._plan_limits = {**MEMBERSHIP_WEEKLY_POINTS, **(plan_limits or {})}
        self._code_signing_secret = (
            code_signing_secret.encode("utf-8") if code_signing_secret else None
        )

    def summary(
        self,
        *,
        user_id: UUID,
        offset: int = 0,
        limit: int = 20,
    ) -> CreditSummary:
        summary = self._repository.get_summary(
            user_id=user_id,
            offset=offset,
            limit=limit,
        )
        if summary is None:
            summary = self._repository.ensure_welcome_grant(
                user_id=user_id,
                points=SIGNUP_GRANT,
                now=self._clock(),
            )
        if user_id in self._exempt_user_ids:
            return CreditSummary(
                balance=summary.balance,
                entries=summary.entries,
                total_entries=summary.total_entries,
                next_cursor=summary.next_cursor,
                is_unlimited=True,
                frozen_points=summary.frozen_points,
                available_balance=summary.available_balance,
                operations=summary.operations,
                total_granted_points=summary.total_granted_points,
                active_usage_buckets=summary.active_usage_buckets,
                quota_status=summary.quota_status,
                quota_period_started_at=summary.quota_period_started_at,
                quota_period_expires_at=summary.quota_period_expires_at,
                quota_plan_id=summary.quota_plan_id,
            )
        return summary

    def ensure_can_start(self, *, user_id: UUID) -> None:
        if user_id in self._exempt_user_ids:
            return
        summary = self.summary(user_id=user_id, limit=1)
        # An accepted first message opens a new full plan epoch in the operation
        # writer transaction. Preflight reads must not start it or reject legacy 0.
        if summary.quota_period_started_at is not None and summary.balance <= 0:
            raise CreditsDepleted

    def generate_redemption_codes(
        self,
        *,
        actor_user_id: UUID,
        batch_id: str,
        count: int,
        expires_in_days: int,
        plan_id: str | None = None,
    ) -> GeneratedCreditCodeBatch:
        if self._code_signing_secret is None:
            raise RuntimeError("credit code signing secret is not configured")
        now = self._clock()
        plan = membership_plan(plan_id) if plan_id is not None else None
        points = self._plan_limits[plan.id] if plan else SIGNUP_GRANT
        action = "membership" if plan else "bank_reset"
        expires_on = (now + timedelta(days=expires_in_days)).date()
        expires_at = datetime.combine(expires_on, time(23, 59, 59), tzinfo=UTC)
        plain_codes: list[str] = []
        specs: list[CreditCodeSpec] = []
        for code_index in range(count):
            seed = f"{actor_user_id}:{batch_id}:{code_index}".encode()
            digest = hmac.new(
                self._code_signing_secret,
                seed,
                hashlib.sha256,
            ).digest()
            token = base64.b32encode(digest[:10]).decode("ascii").rstrip("=")
            code = "QX-" + "-".join(token[index : index + 4] for index in range(0, len(token), 4))
            plain_codes.append(code)
            specs.append(
                CreditCodeSpec(
                    code_id=uuid5(
                        NAMESPACE_URL,
                        f"qunxue-credit:{actor_user_id}:{batch_id}:{code_index}",
                    ),
                    batch_id=batch_id,
                    code_index=code_index,
                    code_hash=_hash_code(code),
                    created_by_user_id=actor_user_id,
                    created_at=now,
                    expires_at=expires_at,
                    action=action,
                    plan_id=plan_id,
                )
            )
        self._repository.create_redemption_codes(codes=tuple(specs))
        return GeneratedCreditCodeBatch(
            codes=tuple(plain_codes),
            points=points,
            expires_at=expires_at,
            action=action,
            plan_id=plan_id,
        )

    def redeem(self, *, user_id: UUID, code: str) -> CreditRedemption:
        self.summary(user_id=user_id, limit=1)
        return self._repository.redeem_code(
            user_id=user_id,
            code_hash=_hash_code(code),
            now=self._clock(),
        )

    def reserve(self, *, user_id: UUID, run_id: UUID) -> None:
        if user_id in self._exempt_user_ids:
            return
        self._repository.reserve_usage(
            user_id=user_id,
            run_id=run_id,
            now=self._clock(),
        )

    def release(self, *, user_id: UUID, run_id: UUID) -> None:
        if user_id in self._exempt_user_ids:
            return
        self._repository.release_usage(
            user_id=user_id,
            run_id=run_id,
            now=self._clock(),
        )

    def charge(
        self,
        *,
        user_id: UUID,
        run_id: UUID,
        input_tokens: int,
        output_tokens: int,
        model: str,
    ) -> CreditEntry | None:
        if user_id in self._exempt_user_ids:
            return None
        points = usage_credit_cost(
            input_tokens=input_tokens,
            output_tokens=output_tokens,
        )
        if points == 0:
            self.release(user_id=user_id, run_id=run_id)
            return None
        return self._repository.charge_usage(
            user_id=user_id,
            run_id=run_id,
            points=points,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            model=model,
            now=self._clock(),
        )


def _hash_code(code: str) -> str:
    canonical = "".join(character for character in code.upper() if character.isalnum())
    if canonical.startswith("QX"):
        canonical = canonical[2:]
    return hashlib.sha256(canonical.encode("ascii", errors="ignore")).hexdigest()
