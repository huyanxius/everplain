import json

import pytest

import qunxue_api.adapters.research_agent.embedding as embedding
from qunxue_api.adapters.research_agent.embedding import (
    EmbeddingProviderError,
    OpenAICompatibleEmbeddingProvider,
)


def test_openai_compatible_embedding_provider_posts_documents_to_configured_model(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, object] = {}

    class Response:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def read(self):
            return json.dumps(
                {"data": [{"embedding": [1.0, 0.0]}, {"embedding": [0.0, 1.0]}]}
            ).encode()

    def fake_urlopen(request, *, timeout):
        captured["url"] = request.full_url
        captured["headers"] = dict(request.headers)
        captured["timeout"] = timeout
        captured["body"] = json.loads(request.data)
        return Response()

    monkeypatch.setattr(embedding, "urlopen", fake_urlopen)
    provider = OpenAICompatibleEmbeddingProvider(
        base_url="http://embedding.internal/v1",
        api_key="test-key",
        model="BAAI/bge-m3",
        timeout_seconds=2,
    )

    assert provider.embed_documents(["问题一", "问题二"]) == [[1.0, 0.0], [0.0, 1.0]]
    assert captured["url"] == "http://embedding.internal/v1/embeddings"
    assert captured["body"] == {"input": ["问题一", "问题二"], "model": "BAAI/bge-m3"}
    assert captured["headers"]["User-agent"] == "Everplain/1.0"


def test_embedding_provider_restores_vectors_by_provider_index(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class Response:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def read(self):
            return json.dumps(
                {
                    "data": [
                        {"index": 1, "embedding": [0.0, 1.0]},
                        {"index": 0, "embedding": [1.0, 0.0]},
                    ]
                }
            ).encode()

    monkeypatch.setattr(embedding, "urlopen", lambda *_args, **_kwargs: Response())
    provider = OpenAICompatibleEmbeddingProvider(
        base_url="http://embedding.internal/v1",
        api_key="test-key",
        model="BAAI/bge-m3",
        timeout_seconds=2,
    )

    assert provider.embed_documents(["问题一", "问题二"]) == [[1.0, 0.0], [0.0, 1.0]]


@pytest.mark.parametrize(
    "data",
    (
        [
            {"index": 0, "embedding": [1.0, 0.0]},
            {"index": 0, "embedding": [0.0, 1.0]},
        ],
        [
            {"index": 0, "embedding": [1.0, 0.0]},
            {"embedding": [0.0, 1.0]},
        ],
        [
            {"index": 2, "embedding": [1.0, 0.0]},
            {"index": 0, "embedding": [0.0, 1.0]},
        ],
    ),
)
def test_embedding_provider_rejects_ambiguous_provider_indexes(
    monkeypatch: pytest.MonkeyPatch,
    data: list[dict[str, object]],
) -> None:
    class Response:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def read(self):
            return json.dumps({"data": data}).encode()

    monkeypatch.setattr(embedding, "urlopen", lambda *_args, **_kwargs: Response())
    provider = OpenAICompatibleEmbeddingProvider(
        base_url="http://embedding.internal/v1",
        api_key="test-key",
        model="BAAI/bge-m3",
        timeout_seconds=2,
    )

    with pytest.raises(EmbeddingProviderError):
        provider.embed_documents(["问题一", "问题二"])


@pytest.mark.parametrize(
    "payload",
    (
        b"{invalid-json",
        b'{"data":[{"embedding":[NaN,0.0]}]}',
    ),
)
def test_embedding_provider_rejects_unusable_provider_payloads(
    monkeypatch: pytest.MonkeyPatch,
    payload: bytes,
) -> None:
    class Response:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def read(self):
            return payload

    monkeypatch.setattr(embedding, "urlopen", lambda *_args, **_kwargs: Response())
    provider = OpenAICompatibleEmbeddingProvider(
        base_url="http://embedding.internal/v1",
        api_key="test-key",
        model="BAAI/bge-m3",
        timeout_seconds=2,
    )

    with pytest.raises(EmbeddingProviderError):
        provider.embed_query("问题")


@pytest.mark.parametrize(
    "status,code",
    [
        (401, "authentication"),
        (403, "access_denied"),
        (404, "endpoint_unavailable"),
        (429, "rate_limited"),
        (400, "request_rejected"),
        (422, "request_rejected"),
        (502, "service_error"),
    ],
)
def test_embedding_http_errors_have_safe_codes(monkeypatch, status, code):
    from urllib.error import HTTPError

    def fail(*args, **kwargs):
        raise HTTPError("https://private.invalid/secret", status, "private-provider-key", {}, None)

    monkeypatch.setattr(embedding, "urlopen", fail)
    provider = OpenAICompatibleEmbeddingProvider(
        base_url="https://example.invalid/v1", api_key="secret", model="test", timeout_seconds=1
    )
    with pytest.raises(EmbeddingProviderError) as caught:
        provider.embed_documents(["synthetic fixture"])
    assert caught.value.code == code
    assert caught.value.status_code == status
    assert "private" not in str(caught.value)
    assert "secret" not in embedding.index_error_message(caught.value)


@pytest.mark.parametrize("wrapped", [False, True])
def test_embedding_timeouts_are_distinct_from_configuration(monkeypatch, wrapped):
    from urllib.error import URLError

    def fail(*args, **kwargs):
        error = TimeoutError("private-details")
        raise URLError(error) if wrapped else error

    monkeypatch.setattr(embedding, "urlopen", fail)
    provider = OpenAICompatibleEmbeddingProvider(
        base_url="https://example.invalid/v1", api_key=None, model="test", timeout_seconds=1
    )
    with pytest.raises(EmbeddingProviderError) as caught:
        provider.embed_query("test")
    assert caught.value.code == "timeout"
    assert "超时" in embedding.index_error_message(caught.value)
    assert "配置" not in embedding.index_error_message(caught.value)
