from fractions import Fraction

from test_account_management_api import client  # noqa: F401

from qunxue_api.modules.subscriptions import (
    MEMBERSHIP_PLANS,
    TOP_UP_POINTS,
    TOP_UP_PRICE_CNY_FEN,
)


def test_four_week_plans_and_top_up_unit_prices():
    assert [plan.id for plan in MEMBERSHIP_PLANS] == ["plus", "pro", "max"]
    top_up_unit_price = Fraction(TOP_UP_PRICE_CNY_FEN, TOP_UP_POINTS)
    for plan in MEMBERSHIP_PLANS:
        assert plan.period_days == 28
        assert plan.period_points == plan.weekly_points * 4
        unit_price = Fraction(plan.price_cny_fen, plan.period_points)
        assert unit_price < top_up_unit_price <= unit_price * 2


def test_public_catalog_requires_no_login_and_discloses_no_route_credentials(client):  # noqa: F811
    response = client.get("/api/product-catalog")
    assert response.status_code == 200
    data = response.json()
    assert data["free_weekly_points"] == 30
    assert data["reset_days"] == 7
    assert data["payments_enabled"] is False
    assert len(data["plans"]) == 3
    assert all(plan["period_points"] == 4 * plan["weekly_points"] for plan in data["plans"])
    assert data["agent_models"] == [
        {
            "model_id": choice.model_id,
            "label": choice.label,
            "reasoning_efforts": list(choice.reasoning_efforts),
            "default_reasoning_effort": choice.default_reasoning_effort,
        }
        for choice in client.app.state.agent_model_choices
    ]
    for model in data["agent_models"]:
        assert set(model) == {
            "model_id", "label", "reasoning_efforts", "default_reasoning_effort"
        }
    assert "base_url" not in response.text
    assert "api_key" not in response.text
