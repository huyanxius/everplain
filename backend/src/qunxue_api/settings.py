from dataclasses import dataclass, field
from decimal import Decimal
from functools import lru_cache
from pathlib import Path
from typing import Literal, cast
from urllib.parse import parse_qs, urlsplit

from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import make_url

BACKEND_ROOT = Path(__file__).resolve().parents[2]
KNOWLEDGE_ROOT = BACKEND_ROOT.parent / "knowledge"
DEFAULT_DATABASE_URL = f"sqlite:///{BACKEND_ROOT / 'var' / 'everplain.db'}"
DEFAULT_RETRIEVAL_INDEX_PATH = BACKEND_ROOT / "var" / "everplain-retrieval.db"
SILICONFLOW_EMBEDDING_MODEL = "Pro/BAAI/bge-m3"
SILICONFLOW_RERANKER_MODEL = "Pro/BAAI/bge-reranker-v2-m3"
SILICONFLOW_EMBEDDING_MODELS = (SILICONFLOW_EMBEDDING_MODEL, "BAAI/bge-m3")
SILICONFLOW_RERANKER_MODELS = (SILICONFLOW_RERANKER_MODEL, "BAAI/bge-reranker-v2-m3")
DEFAULT_MODEL_BASE_URL = "https://api.deepseek.com"
DEFAULT_MODEL_NAME = "deepseek-v4-flash"


def _normalize_model_base_url(value: str) -> str:
    parsed = urlsplit(value)
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.netloc
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError("model base URL must be an HTTP(S) URL without credentials")
    return value.rstrip("/")


def _normalize_model_name(value: str) -> str:
    if not value.strip():
        raise ValueError("model name must not be empty")
    return value.strip()


@dataclass(frozen=True, slots=True)
class RetrievalConfig:
    index_path: Path
    embedding_base_url: str
    embedding_api_key: SecretStr
    embedding_model: str
    embedding_timeout_seconds: float
    embedding_batch_size: int
    reranker_base_url: str
    reranker_api_key: SecretStr
    reranker_model: str
    reranker_timeout_seconds: float
    min_rerank_score: float
    min_lexical_score: float
    recall_limit: int


@dataclass(frozen=True, slots=True)
class ResolvedModelEndpointSettings:
    """Validated model endpoint configuration without adapter dependencies."""

    endpoint_id: str
    base_url: str
    model: str
    api_key: SecretStr | None = field(repr=False)
    timeout_seconds: float


class ModelFallbackSettings(BaseModel):
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)

    base_url: str
    api_key: SecretStr
    model: str | None = None

    @field_validator("base_url")
    @classmethod
    def validate_base_url(cls, value: str) -> str:
        return _normalize_model_base_url(value)

    @field_validator("model")
    @classmethod
    def validate_model(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return _normalize_model_name(value)


class TavilyPriceSettings(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    usd_micro_per_credit: int = Field(gt=0, le=1_000_000)
    retail_rate_ppm: int = Field(gt=0, le=100_000_000)
    source: str = Field(min_length=1, max_length=500)

    @field_validator("source")
    @classmethod
    def validate_source(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Tavily price source must not be blank")
        return value.strip()


def is_sqlite_memory_url(database_url: str) -> bool:
    url = make_url(database_url)
    if url.get_backend_name() != "sqlite":
        return False
    return (
        url.database
        in {
            None,
            "",
            ":memory:",
            "file::memory:",
        }
        or url.query.get("mode") == "memory"
    )


class ChannelGatewayDisplay(BaseModel):
    """Public operator-verified bot metadata; never contains an authentication secret."""

    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)
    name: str = Field(min_length=1, max_length=80)
    bot_url: str | None = Field(default=None, max_length=500)

    @field_validator("bot_url")
    @classmethod
    def validate_bot_url(cls, value):
        if value is None:
            return None
        url = urlsplit(value)
        if (
            url.scheme != "https"
            or url.username
            or url.password
            or url.fragment
            or url.port not in {None, 443}
            or url.hostname not in {"t.me", "applink.feishu.cn", "applink.larksuite.com"}
        ):
            raise ValueError("bot_url must be an official HTTPS Telegram or Feishu bot link")
        if url.hostname == "t.me":
            handle = url.path.removeprefix("/")
            if (
                url.query
                or not 5 <= len(handle) <= 32
                or not handle[:1].isalpha()
                or not handle.lower().endswith("bot")
                or not all(char.isascii() and (char.isalnum() or char == "_") for char in handle)
            ):
                raise ValueError("Telegram bot_url must be a plain bot username link")
        elif url.path != "/client/bot/open" or set(parse_qs(url.query)) != {"appId"}:
            raise ValueError("Feishu bot_url must be a bot-open app link")
        return value


class Settings(BaseSettings):
    app_name: str = "Everplain API"
    contract_version: str = "2026-07-foundation"
    release_revision: str = Field(
        default="unreleased",
        min_length=1,
        max_length=128,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]*$",
    )
    runtime_mode: Literal["mock", "base", "sft"] = "mock"
    allow_model_fallback: bool = False
    database_url: str = DEFAULT_DATABASE_URL
    channel_gateway_credentials: dict[str, SecretStr] = Field(default_factory=dict)
    channel_gateway_display: dict[str, ChannelGatewayDisplay] = Field(default_factory=dict)

    @field_validator("channel_gateway_credentials")
    @classmethod
    def validate_channel_gateway_credentials(cls, value):
        for identity, secret in value.items():
            parts = identity.split(":")
            valid = (parts[0] == "telegram" and len(parts) == 2) or (
                parts[0] == "feishu" and len(parts) == 3
            )
            if not valid or not all(parts) or len(identity) > 200:
                raise ValueError("gateway identity must be telegram:bot or feishu:app:tenant")
            if len(secret.get_secret_value().strip()) < 32:
                raise ValueError("gateway credentials require at least 32 characters")
        return value

    @model_validator(mode="after")
    def validate_channel_display(self):
        for identity, display in self.channel_gateway_display.items():
            if identity not in self.channel_gateway_credentials:
                raise ValueError("channel display needs matching configured gateway credentials")
            if display.bot_url:
                url = urlsplit(display.bot_url)
                platform, bot_id, *_ = identity.split(":")
                if platform == "telegram" and url.hostname != "t.me":
                    raise ValueError("Telegram gateway needs a Telegram bot link")
                if platform == "feishu" and (
                    url.hostname == "t.me" or parse_qs(url.query).get("appId") != [bot_id]
                ):
                    raise ValueError("Feishu bot link must match the configured app ID")
        return self

    memory_learning_enabled: bool = True
    memory_learning_idle_seconds: int = Field(default=600, ge=60)
    memory_learning_daily_calls: int = Field(default=8, ge=0, le=32)
    memory_learning_daily_tokens: int = Field(default=64000, ge=0, le=256000)
    session_cookie_name: str = "everplain_session"
    session_ttl_seconds: int = 60 * 60 * 24 * 7
    session_cookie_secure: bool = False
    session_cookie_samesite: Literal["lax", "strict", "none"] = "lax"
    account_initial_admin_email: str = ""
    account_initial_admin_password: SecretStr | None = None
    resend_api_key: SecretStr | None = None
    email_from: str = "Everplain <onboarding@resend.dev>"
    cors_allowed_origins: tuple[str, ...] = (
        "http://127.0.0.1:5196",
        "http://localhost:5196",
    )
    billing_credits_per_usd: int | None = Field(default=None, gt=0)
    billing_price_version: str | None = None
    billing_tavily_price: TavilyPriceSettings | None = None
    billing_fx_cny_per_usd_micro: int | None = Field(default=None, gt=0)
    billing_fx_snapshot_id: str | None = None
    billing_fx_as_of: str | None = None
    billing_fx_source: str | None = None
    billing_model_aliases: dict[str, str] = Field(default_factory=dict)
    billing_usage_policies: dict[str, Literal["omitted_cache_subsets_are_zero"]] = Field(
        default_factory=dict
    )
    billing_phase_policies: dict[str, Literal["user", "operator"]] = Field(default_factory=dict)
    billing_max_attempt_usd_micro: int | None = Field(default=None, gt=0)
    billing_max_operation_usd_micro: int | None = Field(default=None, gt=0)
    billing_daily_budget_usd_micro: int | None = Field(default=None, gt=0)
    billing_deepseek_time_basis: Literal["server_dispatch_at"] | None = None
    billing_calendar_version: str | None = None
    billing_max_attempts: int = Field(default=64, gt=0, le=256)
    model_base_url: str | None = None
    model_api_key: SecretStr | None = None
    model_fallbacks: list[ModelFallbackSettings] = Field(default_factory=list)
    model_name: str | None = None
    model_reasoning_effort: (
        Literal["none", "minimal", "low", "medium", "high", "xhigh", "max"] | None
    ) = None
    # Explicit per-turn model choices are opt-in; legacy calls keep the old route.
    agent_model_protocol: Literal["chat_completions", "responses"] = "chat_completions"
    agent_model_supported_efforts: tuple[
        Literal["none", "low", "medium", "high", "xhigh", "max"], ...
    ] = ()
    model_timeout_seconds: float = Field(default=30, gt=0)
    model_max_input_tokens: int = Field(default=32000, gt=0)
    model_max_output_tokens: int = Field(default=3000, gt=0)
    model_max_retries: int = Field(default=0, ge=0, le=10)
    organization_max_input_tokens: int = Field(default=32000, gt=0)
    organization_max_output_tokens: int = Field(default=3000, gt=0)
    organization_batch_chars: int = Field(default=5000, gt=0, le=120000)
    organization_max_batches: int = Field(default=24, gt=0)
    organization_max_concurrency: int = Field(default=1, ge=1, le=8)
    organization_max_retries: int = Field(default=0, ge=0, le=10)
    organization_budget: Decimal | None = Field(default=None, gt=0, allow_inf_nan=False)
    organization_input_rate_per_million: Decimal | None = Field(
        default=None, gt=0, allow_inf_nan=False
    )
    organization_output_rate_per_million: Decimal | None = Field(
        default=None, gt=0, allow_inf_nan=False
    )
    organization_cost_currency: str | None = Field(
        default=None, pattern=r"^[A-Za-z][A-Za-z0-9_-]{1,15}$"
    )
    model_probe_interval_seconds: float = Field(default=300, gt=0)
    model_extra_headers: dict[str, SecretStr] = Field(default_factory=dict)
    web_search_provider: Literal["tavily", "custom"] = "tavily"
    web_search_api_key: SecretStr | None = None
    web_search_base_url: str | None = None
    web_search_profile: Literal["generic", "sociology"] = "generic"
    web_search_allowed_domains: tuple[str, ...] = ()
    web_search_timeout_seconds: float = Field(default=12, gt=0)
    model_sft_resource_header: str = "X-LoRA-ID"
    model_sft_resource_id: SecretStr | None = None
    vision_base_url: str | None = None
    vision_model: str | None = None
    vision_api_key: SecretStr | None = None
    transcription_base_url: str | None = None
    transcription_api_key: SecretStr | None = None
    transcription_model: str | None = None
    transcription_processing_location: Literal["local", "external"] = "external"
    transcription_timeout_seconds: float = Field(default=180, gt=0)
    embedding_base_url: str | None = None
    embedding_api_key: SecretStr | None = None
    embedding_model: str | None = None
    embedding_timeout_seconds: float = Field(default=15, gt=0)
    reranker_base_url: str | None = None
    reranker_api_key: SecretStr | None = None
    reranker_model: str | None = None
    reranker_timeout_seconds: float = Field(default=15, gt=0)
    retrieval_index_path: Path = DEFAULT_RETRIEVAL_INDEX_PATH
    retrieval_embedding_batch_size: int = Field(default=32, gt=0)
    retrieval_min_rerank_score: float = Field(default=0.01, ge=0, le=1)
    retrieval_min_lexical_score: float = Field(default=0.12, ge=0, le=1)
    retrieval_recall_limit: int = Field(default=30, gt=0)

    max_file_bytes: int = Field(default=20 * 1024 * 1024, ge=1024)
    max_storage_bytes: int = Field(default=500 * 1024 * 1024, ge=1024)
    max_libraries: int = Field(default=10, ge=1, le=1000)
    max_documents_per_library: int = Field(default=100, ge=1, le=10000)

    model_config = SettingsConfigDict(
        env_prefix="EVERPLAIN_",
        env_file=BACKEND_ROOT / ".env",
        extra="ignore",
        hide_input_in_errors=True,
    )

    @model_validator(mode="before")
    @classmethod
    def normalize_unconfigured_models(cls, values):
        """Only absent model credentials opt into fallback; other services stay real."""
        if not isinstance(values, dict) or str(
            values.get("allow_model_fallback", False)
        ).lower() not in {
            "true",
            "1",
            "yes",
            "on",
        }:
            return values
        values = dict(values)
        for prefix in ("model", "embedding", "reranker", "vision", "transcription"):
            key = values.get(f"{prefix}_api_key")
            raw = key.get_secret_value() if hasattr(key, "get_secret_value") else key
            if raw and str(raw).strip():
                continue
            for suffix in ("base_url", "api_key", "model"):
                name = f"{prefix}_{suffix}"
                if name in cls.model_fields:
                    values[name] = None
            if prefix == "model":
                values.update(model_name=None, model_fallbacks=[], model_extra_headers={})
        return values

    @model_validator(mode="after")
    def validate_model_fallback_runtime(self):
        if self.allow_model_fallback and self.runtime_mode != "base":
            raise ValueError("model fallback requires runtime_mode=base")
        return self

    @field_validator("model_base_url")
    @classmethod
    def validate_model_base_url(cls, value: str | None) -> str | None:
        return _normalize_model_base_url(value) if value is not None else None

    @field_validator("model_name")
    @classmethod
    def validate_model_name(cls, value: str | None) -> str | None:
        return _normalize_model_name(value) if value is not None else None

    @property
    def has_model_api_key(self) -> bool:
        """Treat an empty SecretStr like an absent key at runtime boundaries."""
        return self.model_api_key is not None and bool(
            self.model_api_key.get_secret_value().strip()
        )

    @property
    def has_resend_api_key(self) -> bool:
        return self.resend_api_key is not None and bool(
            self.resend_api_key.get_secret_value().strip()
        )

    @property
    def has_transcription_provider(self) -> bool:
        return bool(
            self.transcription_base_url
            and self.transcription_base_url.strip()
            and self.transcription_api_key
            and self.transcription_api_key.get_secret_value().strip()
            and self.transcription_model
            and self.transcription_model.strip()
        )

    def resolved_model_endpoints(self) -> tuple[ResolvedModelEndpointSettings, ...]:
        primary_base_url = self.model_base_url or (
            DEFAULT_MODEL_BASE_URL if self.has_model_api_key else None
        )
        primary_model = self.model_name or (DEFAULT_MODEL_NAME if self.has_model_api_key else None)
        if primary_base_url is None and primary_model is None and not self.model_fallbacks:
            return ()
        if primary_base_url is None or primary_model is None:
            raise ValueError("model_base_url and model_name must be configured together")
        endpoints = [
            ResolvedModelEndpointSettings(
                endpoint_id="primary",
                base_url=primary_base_url,
                api_key=self.model_api_key,
                model=primary_model,
                timeout_seconds=self.model_timeout_seconds,
            )
        ]
        endpoints.extend(
            ResolvedModelEndpointSettings(
                endpoint_id=f"fallback-{index}",
                base_url=fallback.base_url,
                api_key=fallback.api_key,
                model=fallback.model or primary_model,
                timeout_seconds=self.model_timeout_seconds,
            )
            for index, fallback in enumerate(self.model_fallbacks, start=1)
        )
        return tuple(endpoints)

    def require_retrieval_config(self) -> RetrievalConfig:
        text_fields = {
            "embedding_base_url": self.embedding_base_url,
            "embedding_model": self.embedding_model,
            "reranker_base_url": self.reranker_base_url,
            "reranker_model": self.reranker_model,
        }
        secret_fields = {
            "embedding_api_key": self.embedding_api_key,
            "reranker_api_key": self.reranker_api_key,
        }
        missing = [
            name for name, value in text_fields.items() if value is None or not value.strip()
        ]
        missing.extend(
            name
            for name, value in secret_fields.items()
            if value is None or not value.get_secret_value().strip()
        )
        if missing:
            raise ValueError(
                "retrieval configuration requires non-empty values for: "
                + ", ".join(sorted(missing))
            )
        if self.embedding_model.strip() not in SILICONFLOW_EMBEDDING_MODELS:
            raise ValueError(
                "embedding_model must be one of: " + ", ".join(SILICONFLOW_EMBEDDING_MODELS)
            )
        if self.reranker_model.strip() not in SILICONFLOW_RERANKER_MODELS:
            raise ValueError(
                "reranker_model must be one of: " + ", ".join(SILICONFLOW_RERANKER_MODELS)
            )
        return RetrievalConfig(
            index_path=self.retrieval_index_path,
            embedding_base_url=cast(str, self.embedding_base_url).strip(),
            embedding_api_key=cast(SecretStr, self.embedding_api_key),
            embedding_model=cast(str, self.embedding_model).strip(),
            embedding_timeout_seconds=self.embedding_timeout_seconds,
            embedding_batch_size=self.retrieval_embedding_batch_size,
            reranker_base_url=cast(str, self.reranker_base_url).strip(),
            reranker_api_key=cast(SecretStr, self.reranker_api_key),
            reranker_model=cast(str, self.reranker_model).strip(),
            reranker_timeout_seconds=self.reranker_timeout_seconds,
            min_rerank_score=self.retrieval_min_rerank_score,
            min_lexical_score=self.retrieval_min_lexical_score,
            recall_limit=self.retrieval_recall_limit,
        )

    @field_validator("database_url")
    @classmethod
    def resolve_sqlite_database_path(cls, database_url: str) -> str:
        url = make_url(database_url)
        if (
            url.get_backend_name() != "sqlite"
            or is_sqlite_memory_url(database_url)
            or url.database is None
        ):
            return database_url

        database_path = Path(url.database).expanduser()
        if not database_path.is_absolute():
            database_path = BACKEND_ROOT / database_path
        return url.set(database=str(database_path.resolve())).render_as_string(hide_password=False)

    @field_validator("retrieval_index_path")
    @classmethod
    def resolve_retrieval_index_path(cls, value: Path) -> Path:
        path = value.expanduser()
        if not path.is_absolute():
            path = BACKEND_ROOT / path
        return path.resolve()


@lru_cache
def get_settings() -> Settings:
    return Settings()
