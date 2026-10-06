"""Validate production configuration without printing credentials or calling providers."""

import argparse
import json
import os
from urllib.parse import urlsplit
from urllib.request import getproxies

import httpx
from dotenv import load_dotenv
from pydantic import ValidationError
from pydantic_settings import SettingsError
from qunxue_api.settings import (
    SILICONFLOW_EMBEDDING_MODELS,
    SILICONFLOW_RERANKER_MODELS,
    Settings,
    is_sqlite_memory_url,
)


def credential(value):
    return bool(
        value
        and value.strip()
        and not value.lower().startswith(("replace", "changeme", "your-", "your_", "<"))
    )


def https_url(value):
    try:
        url = urlsplit(value or "")
        return (
            url.scheme == "https"
            and bool(url.hostname)
            and not url.hostname.startswith("your-")
            and not url.username
            and not url.password
        )
    except ValueError:
        return False


def bookmark_proxy_state():
    """Prove direct routing for arbitrary bookmarks, without dialing or exposing values."""
    proxies = getproxies()
    remaining = {scheme for scheme in ("http", "https")
                 if proxies.get(scheme) or proxies.get("all")}
    configured = bool(remaining)
    for entry in proxies.get("no", "").split(","):
        entry = entry.strip()
        if entry == "*":
            return configured, True
        if not entry:
            continue
        # Only universal host/port bypasses establish deployment compatibility.
        # Per-host NO_PROXY entries still work at runtime but cannot prove every
        # future user bookmark avoids an unsupported proxy.
        try:
            pattern = httpx.URL(entry if "://" in entry else f"all://*{entry}")
        except (httpx.InvalidURL, ValueError):
            continue
        if pattern.host not in ("", "*") or pattern.port is not None:
            continue
        remaining = {scheme for scheme in remaining
                     if pattern.scheme not in ("", "all", scheme)}
    return configured, not remaining


def check_configuration():
    invalid = set()
    env = os.environ
    proxy_configured, proxy_compatible = bookmark_proxy_state()
    if not proxy_compatible:
        invalid.add("EVERPLAIN_BOOKMARK_PROXY_COMPATIBILITY")
    fallback = env.get("EVERPLAIN_ALLOW_MODEL_FALLBACK", "").lower() in {"true", "1", "yes", "on"}
    required = (
        "MODEL_BASE_URL",
        "MODEL_NAME",
        "MODEL_API_KEY",
        "EMBEDDING_BASE_URL",
        "EMBEDDING_MODEL",
        "EMBEDDING_API_KEY",
        "RERANKER_BASE_URL",
        "RERANKER_MODEL",
        "RERANKER_API_KEY",
        "WEB_SEARCH_API_KEY",
        "ACCOUNT_INITIAL_ADMIN_EMAIL",
        "ACCOUNT_INITIAL_ADMIN_PASSWORD",
    )
    if fallback:
        required = tuple(
            f"{prefix}_{suffix}"
            for prefix in ("MODEL", "EMBEDDING", "RERANKER")
            if credential(env.get(f"EVERPLAIN_{prefix}_API_KEY"))
            for suffix in ("BASE_URL", "NAME" if prefix == "MODEL" else "MODEL", "API_KEY")
        )
    for suffix in required:
        name = f"EVERPLAIN_{suffix}"
        if not credential(env.get(name)):
            invalid.add(name)
    for name in env:
        if name.startswith("QUNXUE_"):
            invalid.add(name)
    if env.get("EVERPLAIN_RUNTIME_MODE") != "base":
        invalid.add("EVERPLAIN_RUNTIME_MODE")
    for suffix in ("MODEL_BASE_URL", "EMBEDDING_BASE_URL", "RERANKER_BASE_URL"):
        if fallback and not credential(
            env.get("EVERPLAIN_" + suffix.replace("BASE_URL", "API_KEY"))
        ):
            continue
        if not https_url(env.get(f"EVERPLAIN_{suffix}")):
            invalid.add(f"EVERPLAIN_{suffix}")
    admin_configured = bool(
        env.get("EVERPLAIN_ACCOUNT_INITIAL_ADMIN_EMAIL")
        or env.get("EVERPLAIN_ACCOUNT_INITIAL_ADMIN_PASSWORD")
    )
    if (not fallback or admin_configured) and len(
        env.get("EVERPLAIN_ACCOUNT_INITIAL_ADMIN_PASSWORD", "")
    ) < 12:
        invalid.add("EVERPLAIN_ACCOUNT_INITIAL_ADMIN_PASSWORD")
    if (not fallback or admin_configured) and "@" not in env.get(
        "EVERPLAIN_ACCOUNT_INITIAL_ADMIN_EMAIL", ""
    ):
        invalid.add("EVERPLAIN_ACCOUNT_INITIAL_ADMIN_EMAIL")

    optional = {"email": "not_configured", "transcription": "not_configured"}
    if env.get("EVERPLAIN_RESEND_API_KEY") or env.get("EVERPLAIN_EMAIL_FROM"):
        optional["email"] = "configured_not_verified"
        if not credential(env.get("EVERPLAIN_RESEND_API_KEY")):
            invalid.add("EVERPLAIN_RESEND_API_KEY")
        sender = env.get("EVERPLAIN_EMAIL_FROM", "")
        if "@" not in sender or "resend.dev" in sender:
            invalid.add("EVERPLAIN_EMAIL_FROM")
    voice_fields = (
        "TRANSCRIPTION_API_KEY",
        "TRANSCRIPTION_BASE_URL",
        "TRANSCRIPTION_MODEL",
    )
    if (not fallback or credential(env.get("EVERPLAIN_TRANSCRIPTION_API_KEY"))) and any(
        env.get(f"EVERPLAIN_{suffix}") for suffix in voice_fields
    ):
        optional["transcription"] = "configured_not_verified"
        for suffix in voice_fields:
            if not credential(env.get(f"EVERPLAIN_{suffix}")):
                invalid.add(f"EVERPLAIN_{suffix}")
        if not https_url(env.get("EVERPLAIN_TRANSCRIPTION_BASE_URL")):
            invalid.add("EVERPLAIN_TRANSCRIPTION_BASE_URL")
    try:
        settings = Settings(_env_file=None)
        if settings.billing_model_tariffs or settings.agent_selectable_models:
            from qunxue_api.adapters.model.tariff_config import configured_model_tariffs
            from qunxue_api.adapters.research_agent.model_selection import (
                registered_agent_models,
            )

            try:
                tariffs = configured_model_tariffs(settings)
            except ValueError:
                invalid.add("EVERPLAIN_BILLING_MODEL_TARIFFS")
                tariffs = {}
            try:
                choices, _ = registered_agent_models(settings)
                if len(choices) != len(settings.agent_selectable_models):
                    invalid.add("EVERPLAIN_AGENT_PROVIDER_CREDENTIALS")
            except ValueError:
                invalid.add("EVERPLAIN_AGENT_SELECTABLE_MODELS")
            for entry in settings.agent_selectable_models:
                provider = settings.agent_providers.get(entry.provider)
                if provider and not https_url(provider.base_url):
                    invalid.add("EVERPLAIN_AGENT_PROVIDERS")
                if entry.model not in tariffs:
                    invalid.add("EVERPLAIN_BILLING_MODEL_TARIFFS")
            if settings.agent_selectable_models:
                for suffix in ("PRICE_VERSION", "MAX_ATTEMPT_USD_MICRO",
                               "MAX_OPERATION_USD_MICRO", "DAILY_BUDGET_USD_MICRO"):
                    if getattr(settings, "billing_" + suffix.lower()) is None:
                        invalid.add("EVERPLAIN_BILLING_" + suffix)
                fx = (settings.billing_fx_cny_per_usd_micro, settings.billing_fx_snapshot_id,
                      settings.billing_fx_as_of, settings.billing_fx_source)
                if (any(value is not None for value in fx) and not all(fx)) or (
                    not all(fx) and settings.billing_credits_per_usd is None
                ):
                    invalid.add("EVERPLAIN_BILLING_CONVERSION")
        if not settings.session_cookie_secure:
            invalid.add("EVERPLAIN_SESSION_COOKIE_SECURE")
        if settings.session_cookie_name != "everplain_session":
            invalid.add("EVERPLAIN_SESSION_COOKIE_NAME")
        if not settings.database_url.startswith("sqlite:///") or is_sqlite_memory_url(
            settings.database_url
        ):
            invalid.add("EVERPLAIN_DATABASE_URL")
        if not settings.cors_allowed_origins or any(
            not https_url(origin) for origin in settings.cors_allowed_origins
        ):
            invalid.add("EVERPLAIN_CORS_ALLOWED_ORIGINS")
        if (not fallback or settings.embedding_model) and (
            (settings.embedding_model or "").strip() not in SILICONFLOW_EMBEDDING_MODELS
        ):
            invalid.add("EVERPLAIN_EMBEDDING_MODEL")
        if (not fallback or settings.reranker_model) and (
            (settings.reranker_model or "").strip() not in SILICONFLOW_RERANKER_MODELS
        ):
            invalid.add("EVERPLAIN_RERANKER_MODEL")
        if settings.web_search_profile != "generic":
            invalid.add("EVERPLAIN_WEB_SEARCH_PROFILE")
        if settings.web_search_provider == "custom" and not https_url(settings.web_search_base_url):
            invalid.add("EVERPLAIN_WEB_SEARCH_BASE_URL")
        for endpoint in settings.model_fallbacks:
            if not https_url(endpoint.base_url) or not credential(
                endpoint.api_key.get_secret_value()
            ):
                invalid.add("EVERPLAIN_MODEL_FALLBACKS")
    except ValidationError as error:
        invalid.update(
            "EVERPLAIN_" + str(item["loc"][0]).upper()
            for item in error.errors(include_input=False)
            if item["loc"]
        )
    except (SettingsError, TypeError, ValueError):
        # Settings-source errors can include raw environment values in their message.
        invalid.add("EVERPLAIN_SETTINGS_FORMAT")
    return {
        "status": "configuration_invalid" if invalid else "configuration_ready",
        "ai_mode": "model_fallback"
        if fallback and not credential(env.get("EVERPLAIN_MODEL_API_KEY"))
        else "real",
        "backend_mode": "real",
        "web_search": "configured_not_verified"
        if credential(env.get("EVERPLAIN_WEB_SEARCH_API_KEY"))
        or env.get("EVERPLAIN_WEB_SEARCH_PROVIDER") == "custom"
        else "not_configured",
        "registration_email": optional["email"],
        "administrator": "configured" if admin_configured else "not_provisioned",
        "invalid_fields": sorted(invalid),
        "optional_services": optional,
        "provider_connectivity": "not_checked",
        "bookmark_proxy_configured": proxy_configured,
        "bookmark_proxy_compatible": proxy_compatible,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--env-file", help="Explicit private environment file; never loaded implicitly"
    )
    args = parser.parse_args()
    if args.env_file and not load_dotenv(args.env_file, override=False):
        print(json.dumps({"status": "configuration_invalid", "invalid_fields": ["ENV_FILE"]}))
        return 1
    result = check_configuration()
    print(json.dumps(result, ensure_ascii=False))
    return 1 if result["invalid_fields"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
