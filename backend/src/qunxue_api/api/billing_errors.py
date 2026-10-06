"""One safe JSON/SSE boundary for billing failures; never expose provider bodies."""

from uuid import uuid4

from fastapi.responses import JSONResponse

from qunxue_api.api.contracts.common import ErrorCode, ErrorDetail, ErrorResponse
from qunxue_api.modules.billing import (
    BillingBudgetExceeded,
    BillingContextMissing,
    BillingFailure,
    BillingReplayBlocked,
    CreditRunInProgress,
    CreditsDepleted,
    ModelDeliveryRejected,
    UnknownPrice,
    UnknownTokenUsage,
)

_USAGE_SETTLEMENT_MESSAGE = "已产生的模型用量按实际结算，请在账户设置中查看用量。"


def billing_error(error):
    # An error describes the failed attempt, not the operation's settled usage.
    # Even a pre-dispatch rejection can follow an earlier paid stage. Without a
    # ledger snapshot, this boundary must never promise a free turn or a refund.
    if isinstance(error, CreditsDepleted) or (
        isinstance(error, BillingBudgetExceeded) and error.reason == "credits_depleted"
    ):
        return 402, ErrorCode.CREDITS_DEPLETED, "额度已用尽，请等待 receipt"
    if isinstance(error, CreditRunInProgress) or (
        isinstance(error, BillingBudgetExceeded) and error.reason == "credits_frozen"
    ):
        return 409, ErrorCode.CREDIT_RUN_IN_PROGRESS, "当前账户有积分正在冻结，请稍后重试。"
    if isinstance(error, BillingReplayBlocked):
        return (
            409,
            ErrorCode.BILLING_REPLAY_BLOCKED,
            "本轮请求已处理，请刷新查看结果；不会重复扣费。",
        )
    if isinstance(error, (BillingContextMissing, UnknownPrice)):
        return (
            503,
            ErrorCode.BILLING_NOT_CONFIGURED,
            "计费配置暂不可用，请稍后重试。" + _USAGE_SETTLEMENT_MESSAGE,
        )
    if isinstance(error, BillingBudgetExceeded):
        if error.reason == "service_budget_exceeded":
            return (
                429,
                ErrorCode.BILLING_BUDGET_EXCEEDED,
                "模型服务的安全额度暂时不足，请稍后重试或联系管理员。"
                + _USAGE_SETTLEMENT_MESSAGE,
            )
        return (
            429,
            ErrorCode.BILLING_BUDGET_EXCEEDED,
            "本轮请求因费用上限已停止。" + _USAGE_SETTLEMENT_MESSAGE,
        )
    if isinstance(error, UnknownTokenUsage):
        message = "模型用量尚未确认，请等待 receipt。"
    elif isinstance(error, ModelDeliveryRejected):
        message = "模型输出未能完整交付。"
    else:
        message = "模型费用或输出暂时无法确认。"
    return 502, ErrorCode.BILLING_PROVIDER_ERROR, message + _USAGE_SETTLEMENT_MESSAGE


def install_billing_error_handlers(app):
    async def handle(_request, error):
        status, code, message = billing_error(error)
        body = ErrorResponse(error=ErrorDetail(code=code, message=message, trace_id=str(uuid4())))
        return JSONResponse(status_code=status, content=body.model_dump(mode="json"))

    for error_type in (BillingFailure, CreditRunInProgress, CreditsDepleted):
        app.add_exception_handler(error_type, handle)
