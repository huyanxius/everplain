"""One durable reservation and receipt per actual Tavily SDK request."""

import hashlib
import json
from collections.abc import Mapping

from qunxue_api.adapters.model.metering import current_operation
from qunxue_api.modules.billing import BillingContextMissing


def metered_tavily_search(client, query, options, *, require_billing):
    scope = current_operation(required=require_billing)
    if scope is None:
        return client.search(query, **options)
    if scope.before_network:
        scope.before_network()
    attempt = scope.runtime.before_attempt(
        run_id=scope.run_id, endpoint_id="tavily", provider_host="api.tavily.com",
        model="tavily:basic", input_limit=1, output_limit=0, api_type="tavily_search",
        request_hash=hashlib.sha256(json.dumps(
            {"query": query, **options}, ensure_ascii=False, sort_keys=True,
        ).encode()).hexdigest(),
    )
    try:
        response = client.search(query, **options)
    except BaseException:
        # No automatic retry or invented 1-credit debit after a timeout. Keep
        # the unknown provider cost reserved across restart/recovery.
        scope.runtime.complete_search_attempt(
            attempt_id=attempt, failure_code="search_provider_error",
        )
        raise
    usage = response.get("usage") if isinstance(response, Mapping) else None
    credits = usage.get("credits") if isinstance(usage, Mapping) else None
    receipt = response.get("request_id") if isinstance(response, Mapping) else None
    valid = (
        type(credits) is int and 0 <= credits <= 1_000_000
        and isinstance(receipt, str) and 0 < len(receipt) <= 200
        and receipt == receipt.strip()
    )
    results_valid = isinstance(response, Mapping) and isinstance(response.get("results"), list)
    scope.runtime.complete_search_attempt(
        attempt_id=attempt, credits=credits, receipt=receipt,
        outcome="success" if valid and results_valid else "error",
        failure_code=None if results_valid else "invalid_search_results",
    )
    if not valid:
        raise BillingContextMissing(
            "Tavily response lacks verified credit usage and request receipt"
        )
    return response
