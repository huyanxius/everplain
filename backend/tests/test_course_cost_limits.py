from decimal import Decimal
from uuid import uuid4

import pytest

from qunxue_api.adapters.model.routing import ModelEndpoint
from qunxue_api.adapters.research_agent.course_knowledge import (
    CourseKnowledgeGenerator,
    CourseOrganizationError,
)
from qunxue_api.modules.shared_knowledge import SharedDocument
from qunxue_api.settings import Settings


def document(text="原文"):
    return SharedDocument(
        uuid4(),
        uuid4(),
        "source.txt",
        "text/plain",
        "hash",
        1,
        uuid4(),
        "ready",
        segments=({"segment_id": "s0", "text": text},),
    )


class Controlled(CourseKnowledgeGenerator):
    calls = 0

    async def _generate_at_endpoint(self, endpoint, batch):
        self.calls += 1
        return {
            "summary": "摘要",
            "topics": [{"title": "主题", "summary": "内容", "segment_ids": ["s0"]}],
            "relations": [],
        }


def test_unconfigured_budget_refuses_before_external_invocation():
    gen = Controlled((ModelEndpoint("primary", "https://provider.invalid", "model", None, 30),))
    with pytest.raises(CourseOrganizationError) as error:
        gen(document())
    assert error.value.code == "model_cost_unconfigured"
    assert gen.calls == 0


def limits(**overrides):
    from qunxue_api.adapters.research_agent.course_cost import CourseCostLimits

    values = dict(
        input_tokens=32000,
        output_tokens=3000,
        batch_chars=5000,
        max_batches=30,
        concurrency=1,
        retries=1,
        budget=Decimal("1"),
        input_rate=Decimal("10"),
        output_rate=Decimal("20"),
        currency="USD",
    )
    return CourseCostLimits(**(values | overrides))


def generator(policy, count=2, cls=Controlled):
    return cls(
        tuple(
            ModelEndpoint(str(i), "https://provider.invalid", "model", None, 30)
            for i in range(count)
        ),
        cost_limits=policy,
    )


@pytest.mark.parametrize(
    "option,value,code",
    [
        ("input_tokens", 10, "model_input_limit"),
        ("max_batches", 1, "model_batch_limit"),
    ],
)
def test_input_and_batch_limits_reject_without_calls(option, value, code):
    gen = generator(limits(**{option: value}))
    with pytest.raises(CourseOrganizationError) as error:
        gen(document("甲" * 6000))
    assert error.value.code == code
    assert gen.calls == 0


def test_failed_attempt_reservation_survives_restart_and_blocks_retry():
    class Timeout(Controlled):
        async def _generate_at_endpoint(self, endpoint, batch):
            self.calls += 1
            raise TimeoutError

    saved = {}
    policy = limits(budget=Decimal("0.38"))
    gen = generator(policy, cls=Timeout)
    with pytest.raises(CourseOrganizationError) as error:
        gen(document(), on_checkpoint=lambda value: saved.update(value))
    assert error.value.code == "model_budget_exceeded"
    assert gen.calls == 1
    resumed = generator(policy, cls=Timeout)
    with pytest.raises(CourseOrganizationError) as error:
        resumed(document(), checkpoints=saved, on_checkpoint=lambda value: saved.update(value))
    assert error.value.code == "model_budget_exceeded"
    assert resumed.calls == 0
    assert Decimal(saved["cost"]["reserved"]) > 0


def test_retry_limit_survives_new_generator_even_with_remaining_budget():
    class Timeout(Controlled):
        async def _generate_at_endpoint(self, endpoint, batch):
            self.calls += 1
            raise TimeoutError

    policy = limits(retries=0)
    saved = {}
    gen = generator(policy, cls=Timeout)
    with pytest.raises(CourseOrganizationError) as error:
        gen(document(), on_checkpoint=lambda value: saved.update(value))
    assert error.value.code == "model_retry_limit"
    assert gen.calls == 1
    resumed = generator(policy, cls=Timeout)
    with pytest.raises(CourseOrganizationError) as error:
        resumed(document(), checkpoints=saved)
    assert error.value.code == "model_retry_limit"
    assert resumed.calls == 0


def test_parallel_batches_cannot_overreserve_total_budget():
    gen = generator(limits(concurrency=2, budget=Decimal("0.38")), count=1)
    with pytest.raises(CourseOrganizationError) as error:
        gen(document("甲" * 6000))
    assert error.value.code == "model_budget_exceeded"
    assert gen.calls == 1


def test_missing_rate_remains_disabled_with_budget():
    gen = generator(limits(input_rate=None))
    with pytest.raises(CourseOrganizationError) as error:
        gen(document())
    assert error.value.code == "model_cost_unconfigured"
    assert gen.calls == 0


def test_settings_load_configurable_limits_and_reject_invalid_values(monkeypatch):
    monkeypatch.setenv("EVERPLAIN_ORGANIZATION_MAX_OUTPUT_TOKENS", "700")
    monkeypatch.setenv("EVERPLAIN_ORGANIZATION_MAX_CONCURRENCY", "2")
    settings = Settings(_env_file=None)
    assert settings.organization_max_output_tokens == 700
    assert settings.organization_max_concurrency == 2
    with pytest.raises(ValueError):
        Settings(_env_file=None, organization_max_retries=-1)
    with pytest.raises(ValueError):
        Settings(_env_file=None, organization_input_rate_per_million="NaN")


@pytest.mark.parametrize("policy", [limits(currency=None), limits(output_rate=None)])
def test_missing_currency_or_output_rate_refuses_calls(policy):
    gen = generator(policy)
    with pytest.raises(CourseOrganizationError) as error:
        gen(document())
    assert error.value.code == "model_cost_unconfigured"
    assert gen.calls == 0


@pytest.mark.parametrize(
    "cost",
    [
        {"currency": "USD", "reserved": "NaN", "attempts": {}},
        {"currency": "USD", "reserved": "-1", "attempts": {}},
        {"currency": "CNY", "reserved": "1", "attempts": {}},
    ],
)
def test_invalid_cost_checkpoint_fails_closed(cost):
    gen = generator(limits())
    with pytest.raises(CourseOrganizationError) as error:
        gen(document(), checkpoints={"cost": cost})
    assert error.value.code == "model_cost_checkpoint_invalid"
    assert gen.calls == 0


def test_successful_attempt_usage_reaches_existing_recorder():
    from qunxue_api.adapters.model.routing import InMemoryModelAttemptRecorder, ModelAttemptResult

    class Measured(Controlled):
        async def _generate_at_endpoint(self, endpoint, batch):
            return ModelAttemptResult(await super()._generate_at_endpoint(endpoint, batch), 120, 30)

    gen = generator(limits(), count=1, cls=Measured)
    recorder = InMemoryModelAttemptRecorder()
    gen.router._recorder = recorder
    gen(document())
    (attempt,) = recorder.list_all()
    assert attempt.input_tokens == 120
    assert attempt.output_tokens == 30


def test_output_over_limit_is_terminal_and_retains_reservation():
    from qunxue_api.adapters.model.routing import ModelAttemptResult

    class Oversized(Controlled):
        async def _generate_at_endpoint(self, endpoint, batch):
            return ModelAttemptResult(
                await super()._generate_at_endpoint(endpoint, batch), 120, 301
            )

    gen = generator(limits(output_tokens=300), cls=Oversized)
    saved = {}
    with pytest.raises(CourseOrganizationError) as error:
        gen(document(), on_checkpoint=lambda value: saved.update(value))
    assert error.value.code == "model_output_limit"
    assert gen.calls == 1
    assert Decimal(saved["cost"]["reserved"]) > 0
