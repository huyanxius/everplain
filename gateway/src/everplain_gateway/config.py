from pathlib import Path
from urllib.parse import urlsplit

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="EVERPLAIN_GATEWAY_", env_file=None, hide_input_in_errors=True, extra="ignore"
    )
    database_path: Path = Path("var/everplain-gateway.db")
    backend_url: str = "http://127.0.0.1:8297"
    max_pending: int = Field(default=10000, ge=1, le=100000)
    max_attempts: int = Field(default=8, ge=1, le=20)
    release_revision: str = ""
    pilot_only: bool = False
    telegram_allowed_subject_ids: list[str] = Field(default_factory=list)
    feishu_allowed_subject_ids: list[str] = Field(default_factory=list)
    telegram_token: SecretStr | None = None
    telegram_webhook_secret: SecretStr | None = None
    telegram_backend_secret: SecretStr | None = None
    feishu_app_id: str = ""
    feishu_app_secret: SecretStr | None = None
    feishu_encrypt_key: SecretStr | None = None
    feishu_verification_token: SecretStr | None = None
    feishu_tenant_key: str = ""
    feishu_backend_secret: SecretStr | None = None

    @model_validator(mode="after")
    def validate_configuration(self):
        url = urlsplit(self.backend_url)
        if (
            url.scheme not in {"http", "https"}
            or not url.hostname
            or url.username
            or url.password
            or url.query
            or url.fragment
            or url.path not in {"", "/"}
        ):
            raise ValueError("backend_url must be an HTTP(S) origin without credentials")
        if url.scheme == "http" and url.hostname not in {"127.0.0.1", "localhost", "::1"}:
            raise ValueError("non-loopback backend connections require HTTPS")
        self.backend_url = self.backend_url.rstrip("/")
        telegram = [self.telegram_token, self.telegram_webhook_secret, self.telegram_backend_secret]
        feishu = [
            self.feishu_app_id,
            self.feishu_app_secret,
            self.feishu_encrypt_key,
            self.feishu_verification_token,
            self.feishu_tenant_key,
            self.feishu_backend_secret,
        ]
        for name, values in (("telegram", telegram), ("feishu", feishu)):
            if any(values) and not all(values):
                raise ValueError(f"{name} configuration is incomplete")
        if not any(telegram) and not any(feishu):
            raise ValueError("configure at least one platform before starting the gateway")
        if self.pilot_only and (
            (self.telegram_token and not self.telegram_allowed_subject_ids)
            or (self.feishu_app_id and not self.feishu_allowed_subject_ids)
        ):
            raise ValueError("pilot mode requires an explicit subject allowlist for each platform")
        for secret in (
            self.telegram_webhook_secret,
            self.telegram_backend_secret,
            self.feishu_backend_secret,
        ):
            if secret is not None and len(secret.get_secret_value().strip()) < 32:
                raise ValueError("gateway and webhook secrets require at least 32 characters")
        if self.telegram_webhook_secret and not all(
            c.isascii() and (c.isalnum() or c in "_-")
            for c in self.telegram_webhook_secret.get_secret_value()
        ):
            raise ValueError("Telegram webhook secret must use A-Z, a-z, 0-9, _ or -")
        return self

    @property
    def telegram_bot_id(self):
        return self.telegram_token.get_secret_value().split(":", 1)[0]

    def backend_headers(self, platform):
        if platform == "telegram":
            identity, secret = f"telegram:{self.telegram_bot_id}", self.telegram_backend_secret
        else:
            identity, secret = (
                f"feishu:{self.feishu_app_id}:{self.feishu_tenant_key}",
                self.feishu_backend_secret,
            )
        return {
            "X-Everplain-Gateway": identity,
            "Authorization": f"Bearer {secret.get_secret_value()}",
        }

    def permits_subject(self, platform, subject_id):
        allowed = (self.telegram_allowed_subject_ids if platform == "telegram"
                   else self.feishu_allowed_subject_ids)
        return subject_id in allowed if self.pilot_only or allowed else True
