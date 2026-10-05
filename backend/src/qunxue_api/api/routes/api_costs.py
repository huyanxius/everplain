from datetime import date

from fastapi import APIRouter, HTTPException, Query, Request, Response

from qunxue_api.api.contracts.api_costs import ApiCostGroup, ApiCostReportResponse
from qunxue_api.api.dependencies import CurrentSessionDependency

router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.get(
    "/api-costs", operation_id="get_admin_api_costs", response_model=ApiCostReportResponse,
    responses={401: {"description": "Authentication required"},
               403: {"description": "Active administrator required"}},
)
def get_admin_api_costs(
    request: Request,
    response: Response,
    current: CurrentSessionDependency,
    start_date: date | None = None,
    end_date: date | None = None,
    group_by: ApiCostGroup = "model",
    model: str | None = Query(default=None, min_length=1, max_length=256),
    provider_host: str | None = Query(default=None, min_length=1, max_length=256),
    endpoint_id: str | None = Query(default=None, min_length=1, max_length=128),
    user_id: str | None = Query(default=None, min_length=1, max_length=256),
    cursor: int = Query(default=0, ge=0, le=2_147_483_647),
    limit: int = Query(default=25, ge=1, le=100),
) -> ApiCostReportResponse:
    with request.app.state.account_management_service_scope() as service:
        service.require_admin_access(current.user.user_id)
    try:
        report = request.app.state.api_cost_reporting.report(
            start_date=start_date, end_date=end_date, group_by=group_by,
            model=model, provider_host=provider_host, endpoint_id=endpoint_id,
            user_id=user_id, cursor=cursor, limit=limit,
        )
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    response.headers["Cache-Control"] = "no-store"
    return ApiCostReportResponse.model_validate(report)
