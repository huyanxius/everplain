"""OpenAI-compatible embedding adapter for remote or self-hosted encoders."""

import json
import math
from collections.abc import Sequence
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


class EmbeddingProviderError(RuntimeError):
    """The configured embedding service returned an unusable response."""

    def __init__(self, message, *, code="invalid_response", status_code=None):
        super().__init__(message)
        self.code = code
        self.status_code = status_code


def index_error_message(error):
    messages = {
        "not_configured": "语义索引服务尚未配置，请联系站点维护者。",
        "authentication": "语义索引服务拒绝授权，请联系站点维护者检查服务凭据与权限。",
        "access_denied": "语义索引请求被服务拒绝（HTTP 403），请联系站点维护者检查访问策略。",
        "endpoint_unavailable": "语义索引接口或模型不可用，请联系站点维护者检查配置。",
        "rate_limited": "语义索引服务限流，请稍后重试。",
        "request_rejected": "语义索引请求被服务拒绝，请联系站点维护者检查模型与请求配置。",
        "timeout": "语义索引服务响应超时，请稍后重试。",
        "network_error": "无法连接语义索引服务，请稍后重试。",
        "service_error": "语义索引服务暂时异常，请稍后重试。",
        "invalid_response": "语义索引服务返回了无效向量，请联系站点维护者。",
    }
    return messages.get(
        getattr(error, "code", None), "语义索引未完成，请稍后重试；持续失败请联系站点维护者。"
    )


class OpenAICompatibleEmbeddingProvider:
    """Call a hosted or self-hosted ``/embeddings`` endpoint.

    The adapter intentionally speaks the small OpenAI-compatible contract so the
    same application code can use a managed API in early deployment and a local
    BGE-M3/vLLM service on the production server later.
    """

    def __init__(
        self,
        *,
        base_url: str,
        api_key: str | None,
        model: str,
        timeout_seconds: float,
    ) -> None:
        self._endpoint = _embeddings_endpoint(base_url)
        self._api_key = api_key
        self._model = model
        self._timeout_seconds = timeout_seconds

    def embed_query(self, text: str) -> list[float]:
        values = self.embed_documents([text])
        if not values:
            raise EmbeddingProviderError("embedding service returned no vector")
        return values[0]

    def embed_documents(self, texts: Sequence[str]) -> list[list[float]]:
        inputs = list(texts)
        if not inputs:
            return []
        body = json.dumps({"input": inputs, "model": self._model}).encode("utf-8")
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "Everplain/1.0",
        }
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"
        request = Request(self._endpoint, data=body, headers=headers, method="POST")
        try:
            with urlopen(request, timeout=self._timeout_seconds) as response:
                payload = json.loads(response.read())
        except HTTPError as error:
            code = (
                "authentication"
                if error.code == 401
                else "access_denied"
                if error.code == 403
                else "endpoint_unavailable"
                if error.code == 404
                else "rate_limited"
                if error.code == 429
                else "request_rejected"
                if 400 <= error.code < 500
                else "service_error"
            )
            raise EmbeddingProviderError(
                "embedding service request failed", code=code, status_code=error.code
            ) from error
        except (TimeoutError, URLError, OSError) as error:
            code = (
                "timeout"
                if isinstance(error.reason if isinstance(error, URLError) else error, TimeoutError)
                else "network_error"
            )
            raise EmbeddingProviderError("embedding service request failed", code=code) from error
        except (json.JSONDecodeError, UnicodeDecodeError) as error:
            raise EmbeddingProviderError("embedding response is invalid") from error
        return _parse_embeddings(payload, expected_count=len(inputs))


def _embeddings_endpoint(base_url: str) -> str:
    normalized = base_url.rstrip("/")
    return normalized if normalized.endswith("/embeddings") else f"{normalized}/embeddings"


def _parse_embeddings(payload: object, *, expected_count: int) -> list[list[float]]:
    if not isinstance(payload, dict) or not isinstance(payload.get("data"), list):
        raise EmbeddingProviderError("embedding response is missing data")
    parsed: list[tuple[object, list[float]]] = []
    for item in payload["data"]:
        if not isinstance(item, dict) or not isinstance(item.get("embedding"), list):
            raise EmbeddingProviderError("embedding response contains an invalid vector")
        vector = item["embedding"]
        if not vector or not all(
            isinstance(value, (int, float))
            and not isinstance(value, bool)
            and math.isfinite(float(value))
            for value in vector
        ):
            raise EmbeddingProviderError("embedding response contains an invalid vector")
        parsed.append((item.get("index"), [float(value) for value in vector]))
    if len(parsed) != expected_count:
        raise EmbeddingProviderError("embedding response count does not match request")
    if not any(index is not None for index, _vector in parsed):
        return [vector for _index, vector in parsed]

    ordered: list[list[float] | None] = [None] * expected_count
    for index, vector in parsed:
        if (
            not isinstance(index, int)
            or isinstance(index, bool)
            or not 0 <= index < expected_count
            or ordered[index] is not None
        ):
            raise EmbeddingProviderError("embedding response contains an invalid index")
        ordered[index] = vector
    if any(vector is None for vector in ordered):
        raise EmbeddingProviderError("embedding response indexes do not match request")
    return [vector for vector in ordered if vector is not None]
