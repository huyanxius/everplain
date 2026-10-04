# ruff: noqa: F811
"""Operator-configured prices are synthetic; these are not real Gemini rates."""

import json
from dataclasses import replace

import pytest
from pydantic import ValidationError
from test_durable_billing import wallet  # noqa: F401

from qunxue_api.adapters.model.tariff_config import configured_model_tariffs
from qunxue_api.adapters.sqlite.durable_billing import DurableBilling
from qunxue_api.modules.billing import PriceBook, UnknownPrice
from qunxue_api.modules.billing.pricing import STANDARD_TARIFFS
from qunxue_api.settings import ModelTariffSettings, Settings


def tariff(**overrides):
    return dict(version="synthetic-v2", source="synthetic-test-fixture-not-provider-pricing",
                currency="USD", unit="usd_micro_per_million_tokens", service_tier="standard",
                input=200, cache_read=20, cache_write=100, output=601,
                long_threshold=None, **overrides)


def config(entry=None, **overrides):
    return Settings(_env_file=None, billing_price_version="synthetic-v2",
                    billing_model_tariffs={"gemini-3.5-flash": entry or tariff()}, **overrides)


def book(settings):
    return PriceBook(credits_per_usd=10000, version=settings.billing_price_version,
                     tariffs=configured_model_tariffs(settings))


@pytest.mark.parametrize("missing", ["currency", "unit", "service_tier", "input", "cache_read",
                                    "cache_write", "output", "long_threshold", "version", "source"])
def test_all_price_semantics_are_required(missing):
    value = tariff()
    del value[missing]
    with pytest.raises(ValidationError):
        ModelTariffSettings(**value)


@pytest.mark.parametrize("field,value", [
    ("input", 1.5), ("output", "9.00"), ("cache_read", True), ("cache_write", -1),
    ("currency", "CNY"), ("unit", "usd_per_token"), ("service_tier", "priority"),
    ("version", " "), ("source", ""), ("long_threshold", 100),
    ("long_rates", [1, 2, 3, 4]),
])
def test_ambiguous_or_partial_rates_are_rejected(field, value):
    payload = tariff()
    payload[field] = value
    with pytest.raises(ValidationError):
        ModelTariffSettings(**payload)


def test_empty_config_still_rejects_gemini_and_preserves_luna():
    settings = Settings(_env_file=None)
    assert configured_model_tariffs(settings) == STANDARD_TARIFFS
    default = PriceBook(credits_per_usd=10000, version="synthetic")
    with pytest.raises(UnknownPrice):
        default.tariff("gemini-3.5-flash")


def test_exact_flat_cost_does_not_inherit_luna_long_context_multiplier():
    prices = book(config())
    assert prices.cost_pico_usd("gemini-3.5-flash", 1000, 100, 100, 200) == 222100
    assert prices.tariff("gemini-3.5-flash").rates(500000) == (200, 20, 100, 601)
    assert prices.tariff("gpt-6-luna") == STANDARD_TARIFFS["gpt-6-luna"]


def test_explicit_tier_and_reservation_are_safe_even_for_lower_long_rates():
    payload = tariff()
    payload.update(long_threshold=100, long_rates=[100, 10, 50, 400])
    prices = book(config(payload))
    assert prices.tariff("gemini-3.5-flash").rates(101) == (100, 10, 50, 400)
    assert prices.maximum_cost("gemini-3.5-flash", 200, 20) == 52020


def test_config_cannot_override_luna_redirect_gemini_or_mix_versions():
    for settings in [
        Settings(_env_file=None, billing_price_version="synthetic-v2",
                 billing_model_tariffs={"gpt-6-luna": tariff()}),
        config(billing_model_aliases={"gemini-3.5-flash": "gpt-6-luna"}),
        config({**tariff(), "version": "stale"}),
    ]:
        with pytest.raises(ValueError):
            configured_model_tariffs(settings)


def test_tariff_snapshot_retains_evidence_version_and_old_price_after_config_changes(wallet):
    runtime, _ = wallet
    runtime.book = book(config())
    encoded = runtime._snapshot(runtime.book)
    snapshot = json.loads(encoded)
    assert snapshot["tariffs"]["gemini-3.5-flash"]["source"] == tariff()["source"]
    runtime.book = replace(runtime.book, version="later", tariffs=STANDARD_TARIFFS)
    restored = DurableBilling._book(encoded)
    assert restored.version == "synthetic-v2"
    assert restored.tariff("gemini-3.5-flash").output == 601
    assert restored.maximum_cost("gemini-3.5-flash", 1000, 100) == 260100


def test_all_zero_model_price_is_rejected():
    with pytest.raises(ValidationError):
        ModelTariffSettings(**{**tariff(), "input": 0, "cache_read": 0,
                              "cache_write": 0, "output": 0})


def test_bootstrap_wires_additional_rates_without_replacing_default_prices(wallet):
    from types import SimpleNamespace

    from qunxue_api.bootstrap import _billing_runtime

    _, engine = wallet
    settings = config(billing_credits_per_usd=10000,
                      billing_max_attempt_usd_micro=100000,
                      billing_max_operation_usd_micro=100000,
                      billing_daily_budget_usd_micro=1000000)
    runtime = _billing_runtime(settings, SimpleNamespace(engine=engine))
    assert runtime.book.tariff("gemini-3.5-flash").output == 601
    assert runtime.book.tariff("gpt-6-luna") == STANDARD_TARIFFS["gpt-6-luna"]
