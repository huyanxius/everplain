"""Conservative per-document reservations, in the configured provider currency."""

from dataclasses import dataclass, replace
from decimal import Decimal

from qunxue_api.modules.billing import PICO_USD, UnknownPrice


@dataclass(frozen=True, slots=True)
class CourseCostLimits:
    input_tokens: int = 32000
    output_tokens: int = 3000
    batch_chars: int = 5000
    max_batches: int = 24
    concurrency: int = 1
    retries: int = 0
    budget: Decimal | None = None
    input_rate: Decimal | None = None
    output_rate: Decimal | None = None
    currency: str | None = None

    def with_billing_defaults(self, runtime, endpoints):
        """Reuse an explicit global cash policy only when all legacy fields are absent.

        A partial override still fails closed. Unknown/dynamic tariffs are never guessed.
        The actual request retains the independent wire, operation and daily guards.
        """
        if (
            runtime is None
            or not endpoints
            or any(
                value is not None
                for value in (self.budget, self.input_rate, self.output_rate, self.currency)
            )
        ):
            return self
        try:
            tariffs = [runtime.book.tariff(endpoint.model) for endpoint in endpoints]
        except UnknownPrice:
            return self
        rates = [tariff.reservation_rates or tariff.rates(self.input_tokens) for tariff in tariffs]
        return replace(
            self,
            budget=Decimal(runtime.max_operation_pico) / Decimal(PICO_USD),
            input_rate=Decimal(max(max(rate[:3]) for rate in rates)) / Decimal(1000000),
            output_rate=Decimal(max(rate[3] for rate in rates)) / Decimal(1000000),
            currency="USD",
        )

    @property
    def configured(self):
        return (
            bool(self.currency)
            and self.budget is not None
            and self.budget > 0
            and self.input_rate is not None
            and self.input_rate > 0
            and self.output_rate is not None
            and self.output_rate > 0
        )

    @property
    def reservation(self):
        return (
            self.input_tokens * self.input_rate + self.output_tokens * self.output_rate
        ) / Decimal(1000000)
