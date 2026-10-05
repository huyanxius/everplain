"""Composition of exact, operator-registered native model protocols."""

import httpx
import httpx2
from anthropic import AsyncAnthropic
from google.genai.types import HttpRetryOptions
from pydantic_ai.providers.anthropic import AnthropicProvider
from pydantic_ai.providers.google import GoogleProvider

from qunxue_api.adapters.model.native_models import (
    MeteredNativeAnthropicModel,
    MeteredNativeGoogleModel,
    NativeAnthropicTransport,
    NativeGoogleTransport,
)


def build_native_agent_model(
    *,
    protocol,
    base_url,
    api_key,
    model,
    timeout_seconds,
    extra_headers,
    capacity,
    effort,
    route_executor,
    route_context_factory,
    route_error,
    require_billing,
    cache_omission_is_zero=False,
    native_authentication="native",
    transport=None,
):
    if capacity is None and protocol == "anthropic_messages":
        raise ValueError("Anthropic requires a verified explicit max_tokens capacity")
    settings = {"timeout": timeout_seconds}
    if capacity is not None:
        settings["max_tokens"] = capacity.max_output_tokens
    if protocol == "gemini_generate_content":
        if capacity is not None and capacity.output_token_parameter != "maxOutputTokens":
            raise ValueError("Google capacity must name its native output parameter")
        if effort is not None:
            if effort.google_thinking_level is None:
                raise ValueError("Google native model requires a Google thinking level")
            settings["google_thinking_config"] = {
                "thinking_level": effort.google_thinking_level.upper(),
            }
        wire = NativeGoogleTransport(transport or httpx.AsyncHTTPTransport())
        wire.bearer_authentication = native_authentication == "bearer"
        headers = dict(extra_headers)
        if wire.bearer_authentication:
            headers["Authorization"] = f"Bearer {api_key}"
        http = httpx.AsyncClient(
            transport=wire, timeout=timeout_seconds, headers=headers, follow_redirects=False
        )
        wire.client = http
        provider = GoogleProvider(api_key=api_key, base_url=base_url, http_client=http)
        provider.client._api_client._http_options.retry_options = HttpRetryOptions(attempts=1)
        native = MeteredNativeGoogleModel(model, provider=provider, settings=settings)
    elif protocol == "anthropic_messages":
        if capacity.output_token_parameter != "max_tokens":
            raise ValueError("Anthropic capacity must name its native output parameter")
        if effort is not None:
            if effort.anthropic_effort is None or effort.anthropic_thinking is None:
                raise ValueError(
                    "Anthropic native model requires explicit effort and thinking mode"
                )
            settings.update(
                anthropic_effort=effort.anthropic_effort,
                anthropic_thinking={"type": effort.anthropic_thinking},
            )
        wire = NativeAnthropicTransport(transport or httpx2.AsyncHTTPTransport())
        wire.bearer_authentication = native_authentication == "bearer"
        http = httpx2.AsyncClient(
            transport=wire, timeout=timeout_seconds, headers=extra_headers, follow_redirects=False
        )
        wire.client = http
        native = MeteredNativeAnthropicModel(
            model,
            provider=AnthropicProvider(
                anthropic_client=AsyncAnthropic(
                    api_key=api_key if native_authentication == "native" else "",
                    auth_token=api_key if native_authentication == "bearer" else "",
                    base_url=base_url,
                    http_client=http,
                    max_retries=0,
                ),
            ),
            settings=settings,
        )
        native.install_compatibility()
    else:
        raise ValueError("unsupported native Agent protocol")
    native._configure_native(
        protocol=protocol,
        route_executor=route_executor,
        route_context_factory=route_context_factory,
        route_error=route_error,
        require_billing=require_billing,
        cache_omission_is_zero=cache_omission_is_zero,
    )
    return native
