"""Conservative per-document reservations, in the configured provider currency."""

from dataclasses import dataclass
from decimal import Decimal


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
