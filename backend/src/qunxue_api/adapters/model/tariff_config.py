"""Translate strictly validated runtime rates into the existing immutable billing snapshot."""

from qunxue_api.modules.billing import STANDARD_TARIFFS, Tariff


def configured_model_tariffs(settings):
    tariffs = dict(STANDARD_TARIFFS)
    for model, entry in settings.billing_model_tariffs.items():
        if not model.strip() or model != model.strip():
            raise ValueError("configured tariff model must be a nonblank exact model ID")
        if model in tariffs or model == "deepseek-flash":
            raise ValueError("additional tariffs cannot override existing model pricing")
        if model in settings.billing_model_aliases:
            raise ValueError("a configured tariff cannot also be redirected by an alias")
        if entry.version != settings.billing_price_version:
            raise ValueError("configured tariff version must match the billing snapshot version")
        base = entry.input, entry.cache_read, entry.cache_write, entry.output
        long_rates = tuple(entry.long_rates) if entry.long_rates is not None else None
        # A lower long-context tier must never lower the pre-request reservation bound.
        reservation = tuple(max(a, b) for a, b in zip(base, long_rates or base, strict=True))
        tariffs[model] = Tariff(
            *base, long_threshold=entry.long_threshold, reservation_rates=reservation,
            currency=entry.currency, service_tier=entry.service_tier, long_rates=long_rates,
            source=entry.source, version=entry.version,
        )
    return tariffs
