"""Public-only bookmark transport: resolve, validate, then dial that numeric address.

The original HTTP origin is never rewritten, preserving Host, SNI, certificate
verification and origin-scoped pooling. This boundary applies only to bookmarks.
"""

import ipaddress
import socket
from contextlib import contextmanager
from time import monotonic
from urllib.parse import urlsplit
from urllib.request import getproxies

import httpcore
import httpx


class BookmarkProxyError(ValueError):
    """The configured proxy cannot enforce our destination-address constraint."""


def validate_url(url):
    value = urlsplit(url)
    if (
        value.scheme not in {"http", "https"}
        or not value.hostname
        or value.username
        or value.password
    ):
        raise ValueError("书签需要公开的 HTTP(S) 网页地址")
    if value.port not in (None, 80, 443):
        raise ValueError("不支持此网页端口")
    return value


def public_addresses(host, port):
    rows = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    addresses = tuple(dict.fromkeys(str(ipaddress.ip_address(row[4][0])) for row in rows))
    if not addresses or any(not ipaddress.ip_address(ip).is_global for ip in addresses):
        raise ValueError("不能读取本机、内网或保留地址")
    return addresses


class PublicNetworkBackend(httpcore.NetworkBackend):
    def __init__(self):
        self.backend = httpcore.SyncBackend()

    def connect_tcp(self, host, port, timeout=None, local_address=None, socket_options=None):
        deadline = None if timeout is None else monotonic() + timeout
        # Validate the entire DNS answer before opening any socket. Pass only
        # canonical numeric literals to the standard backend, never the hostname.
        addresses = public_addresses(host, port)
        for address in addresses:
            remaining = None if deadline is None else deadline - monotonic()
            if remaining is not None and remaining <= 0:
                raise httpcore.ConnectTimeout("连接网页超时")
            try:
                return self.backend.connect_tcp(
                    address,
                    port,
                    timeout=remaining,
                    local_address=local_address,
                    socket_options=socket_options,
                )
            except (httpcore.ConnectError, httpcore.ConnectTimeout):
                if address == addresses[-1]:
                    raise


def _no_proxy_match(url, entry):
    # Match HTTPX's documented environment routing, including its distinction
    # between .example.org (subdomains) and example.org (also the parent).
    if "://" in entry:
        pattern = httpx.URL(entry)
    else:
        try:
            address = ipaddress.ip_address(entry.split("/")[0])
        except ValueError:
            host = entry if entry.lower() == "localhost" else f"*{entry}"
        else:
            host = f"[{entry}]" if address.version == 6 else entry
        pattern = httpx.URL(f"all://{host}")
    if pattern.scheme not in ("", "all", url.scheme):
        return False
    if pattern.port is not None and pattern.port != url.port:
        return False
    host = pattern.host
    if host in ("", "*"):
        return True
    if host.startswith("*."):
        return url.host.endswith(host[1:]) and url.host != host[2:]
    if host.startswith("*"):
        return url.host == host[1:] or url.host.endswith("." + host[1:])
    return url.host == host


def require_direct_route(url):
    proxies = getproxies()
    if not (proxies.get(url.scheme) or proxies.get("all")):
        return
    for entry in proxies.get("no", "").split(","):
        entry = entry.strip()
        if entry == "*" or (entry and _no_proxy_match(url, entry)):
            return
    # Never silently bypass an operator's egress proxy. A proxy resolving the
    # original hostname would detach the checked address from the destination.
    raise BookmarkProxyError(
        "当前服务器的网页代理无法保证目标地址安全，请在浏览器打开原网页后收藏当前页面。"
    )


@contextmanager
def _httpx_errors():
    # Only the two categories consumed by fetch_bookmark need translation.
    # This also covers errors raised while streaming the response body.
    try:
        yield
    except httpcore.TimeoutException as exc:
        raise httpx.TimeoutException(str(exc)) from exc
    except (httpcore.NetworkError, httpcore.ProtocolError, httpcore.ProxyError) as exc:
        raise httpx.RequestError(str(exc)) from exc


class _ResponseStream(httpx.SyncByteStream):
    def __init__(self, stream):
        self.stream = stream

    def __iter__(self):
        with _httpx_errors():
            yield from self.stream

    def close(self):
        self.stream.close()


class PublicHTTPTransport(httpx.BaseTransport):
    def __init__(self):
        self.pool = httpcore.ConnectionPool(
            # Keep HTTPX's default certificate roots and SSL_CERT_FILE/DIR.
            ssl_context=httpx.create_ssl_context(),
            network_backend=PublicNetworkBackend(),
        )

    def handle_request(self, request):
        validate_url(str(request.url))
        require_direct_route(request.url)
        with _httpx_errors():
            response = self.pool.handle_request(
                httpcore.Request(
                    method=request.method,
                    url=httpcore.URL(
                        scheme=request.url.raw_scheme,
                        host=request.url.raw_host,
                        port=request.url.port,
                        target=request.url.raw_path,
                    ),
                    headers=request.headers.raw,
                    content=request.stream,
                    extensions=request.extensions,
                )
            )
        return httpx.Response(
            status_code=response.status,
            headers=response.headers,
            stream=_ResponseStream(response.stream),
            extensions=response.extensions,
        )

    def close(self):
        self.pool.close()
