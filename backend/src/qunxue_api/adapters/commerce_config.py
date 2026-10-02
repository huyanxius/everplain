"""Isolated EVERPLAIN_ model catalogue and optional Stripe configuration."""

from typing import Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from qunxue_api.modules.model_catalog import CatalogModel
from qunxue_api.modules.subscriptions import SubscriptionPlan


class ModelCatalogEntry(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1, max_length=80, pattern=r"^[a-zA-Z0-9:_-]+$")
    source: str = Field(
        pattern=r"^(chat:(primary|fallback-[1-9][0-9]*)|embedding|reranker|transcription)$"
    )
    display_name: str = Field(min_length=1, max_length=120)
    provider: str = Field(default="openai-compatible", min_length=1, max_length=80)
    capabilities: list[
        Literal["chat", "reasoning", "tools", "vision", "embedding", "reranking", "transcription"]
    ] = Field(min_length=1, max_length=7)


class SubscriptionPlanSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1, max_length=64, pattern=r"^[a-zA-Z0-9_-]+$")
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=1000)
    price_id: str = Field(pattern=r"^price_[a-zA-Z0-9]+$")


class CommerceSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="EVERPLAIN_",
        extra="ignore",
        hide_input_in_errors=True,
    )
    model_catalog: list[ModelCatalogEntry] = Field(default_factory=list)
    subscription_plans: list[SubscriptionPlanSettings] = Field(default_factory=list)
    stripe_enabled: bool = False
    stripe_secret_key: SecretStr | None = None
    stripe_webhook_secret: SecretStr | None = None
    stripe_success_url: str = ""
    stripe_cancel_url: str = ""
    stripe_portal_return_url: str = ""
    stripe_live_mode: bool = False
    stripe_timeout_seconds: float = Field(default=10, gt=0, le=30)
    stripe_webhook_tolerance_seconds: int = Field(default=300, ge=1, le=600)

    @field_validator("stripe_success_url", "stripe_cancel_url", "stripe_portal_return_url")
    @classmethod
    def validate_redirect(cls, value: str) -> str:
        if not value:
            return value
        parsed = urlsplit(value)
        local = parsed.hostname in {"localhost", "127.0.0.1", "::1"}
        if (parsed.scheme != "https" and not (parsed.scheme == "http" and local)) or (
            not parsed.netloc or parsed.username or parsed.password or parsed.fragment
        ):
            raise ValueError("checkout redirects require HTTPS (HTTP allowed only for localhost)")
        return value

    @model_validator(mode="after")
    def unique_ids(self):
        for entries in (self.model_catalog, self.subscription_plans):
            if len({entry.id for entry in entries}) != len(entries):
                raise ValueError("catalogue and plan identifiers must be unique")
        prices = [entry.price_id for entry in self.subscription_plans]
        if len(set(prices)) != len(prices):
            raise ValueError("subscription prices must identify exactly one plan")
        return self

    @property
    def unavailable_reason(self) -> str | None:
        if not self.stripe_enabled:
            return "订阅支付尚未启用"
        if not all(
            (
                self.stripe_secret_key and self.stripe_secret_key.get_secret_value().strip(),
                self.stripe_webhook_secret
                and self.stripe_webhook_secret.get_secret_value().strip(),
                self.stripe_success_url,
                self.stripe_cancel_url,
                self.subscription_plans,
            )
        ):
            return "订阅支付配置不完整"
        mode = "live" if self.stripe_live_mode else "test"
        secret = self.stripe_secret_key.get_secret_value()
        if not secret.startswith((f"sk_{mode}_", f"rk_{mode}_")):
            return "订阅支付密钥与运行模式不一致"
        if not self.stripe_webhook_secret.get_secret_value().startswith("whsec_"):
            return "订阅支付通知密钥无效"
        return None

    def plans(self) -> tuple[SubscriptionPlan, ...]:
        return tuple(SubscriptionPlan(**plan.model_dump()) for plan in self.subscription_plans)


def build_model_catalog(runtime, config: CommerceSettings) -> tuple[CatalogModel, ...]:
    """Advertise only actual runtime model names, with configuration-only availability."""
    sources: dict[str, tuple[str, bool, str]] = {}
    for endpoint in runtime.resolved_model_endpoints():
        sources[f"chat:{endpoint.endpoint_id}"] = (
            endpoint.model,
            runtime.runtime_mode != "mock"
            and bool(endpoint.api_key and endpoint.api_key.get_secret_value().strip()),
            "chat",
        )
    for source, capability in (
        ("embedding", "embedding"),
        ("reranker", "reranking"),
        ("transcription", "transcription"),
    ):
        model = getattr(runtime, f"{source}_model", None)
        key = getattr(runtime, f"{source}_api_key", None)
        base = getattr(runtime, f"{source}_base_url", None)
        if model:
            sources[source] = (
                model,
                bool(base and key and key.get_secret_value().strip()),
                capability,
            )
    entries = config.model_catalog or [
        ModelCatalogEntry(id=source, source=source, display_name=model, capabilities=[capability])
        for source, (model, _ready, capability) in sources.items()
    ]
    result = []
    for entry in entries:
        if entry.source not in sources:
            # No invented models, even when a display descriptor was supplied.
            continue
        model, ready, _capability = sources[entry.source]
        result.append(
            CatalogModel(
                id=entry.id,
                display_name=entry.display_name,
                provider=entry.provider,
                model=model,
                capabilities=tuple(dict.fromkeys(entry.capabilities)),
                availability="configured" if ready else "unavailable",
                unavailable_reason=None if ready else "模型未配置完整或当前为演示模式",
            )
        )
    return tuple(result)
