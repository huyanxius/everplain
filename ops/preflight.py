"""Validate production configuration without printing credentials or calling providers."""

import argparse
import json
import os
from urllib.parse import urlsplit

from dotenv import load_dotenv
from pydantic import ValidationError
from pydantic_settings import SettingsError
from qunxue_api.settings import Settings, is_sqlite_memory_url


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


def check_configuration():
    invalid = set()
    env = os.environ
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
        if not https_url(env.get(f"EVERPLAIN_{suffix}")):
            invalid.add(f"EVERPLAIN_{suffix}")
    if len(env.get("EVERPLAIN_ACCOUNT_INITIAL_ADMIN_PASSWORD", "")) < 12:
        invalid.add("EVERPLAIN_ACCOUNT_INITIAL_ADMIN_PASSWORD")
    if "@" not in env.get("EVERPLAIN_ACCOUNT_INITIAL_ADMIN_EMAIL", ""):
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
    if any(env.get(f"EVERPLAIN_{suffix}") for suffix in voice_fields):
        optional["transcription"] = "configured_not_verified"
        for suffix in voice_fields:
            if not credential(env.get(f"EVERPLAIN_{suffix}")):
                invalid.add(f"EVERPLAIN_{suffix}")
        if not https_url(env.get("EVERPLAIN_TRANSCRIPTION_BASE_URL")):
            invalid.add("EVERPLAIN_TRANSCRIPTION_BASE_URL")
    try:
        settings = Settings(_env_file=None)
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
        if settings.embedding_model != "Pro/BAAI/bge-m3":
            invalid.add("EVERPLAIN_EMBEDDING_MODEL")
        if settings.reranker_model != "Pro/BAAI/bge-reranker-v2-m3":
            invalid.add("EVERPLAIN_RERANKER_MODEL")
        if settings.web_search_profile != "generic":
            invalid.add("EVERPLAIN_WEB_SEARCH_PROFILE")
        if settings.web_search_provider == "custom" and not https_url(
            settings.web_search_base_url
        ):
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
        "invalid_fields": sorted(invalid),
        "optional_services": optional,
        "provider_connectivity": "not_checked",
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--env-file", help="Explicit private environment file; never loaded implicitly"
    )
    args = parser.parse_args()
    if args.env_file and not load_dotenv(args.env_file, override=False):
        print(
            json.dumps(
                {"status": "configuration_invalid", "invalid_fields": ["ENV_FILE"]}
            )
        )
        return 1
    result = check_configuration()
    print(json.dumps(result, ensure_ascii=False))
    return 1 if result["invalid_fields"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
