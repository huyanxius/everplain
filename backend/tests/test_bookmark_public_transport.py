"""Synthetic DNS and sockets exercise the real HTTPX/httpcore connection path.

No test dials a public or private network endpoint.
"""

import ipaddress
import os
import socket
import ssl

import httpcore
import httpx
import pytest

from qunxue_api.adapters.import_sources import fetch as fetcher
from qunxue_api.adapters.import_sources import public_http

PUBLIC_V4 = "93.184.216.34"
PUBLIC_V6 = "2606:4700:4700::1111"
OK = (
    b"HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 6\r\n"
    b"Connection: close\r\n\r\npublic"
)


@pytest.fixture(autouse=True)
def no_environment_proxy(monkeypatch):
    for name in os.environ:
        if name.lower() in {"http_proxy", "https_proxy", "all_proxy", "no_proxy"}:
            monkeypatch.delenv(name)


@pytest.fixture
def wire(monkeypatch):
    class Wire:
        lookups = []
        connects = []
        requests = []
        closed = []
        responses = [OK]
        addresses = [PUBLIC_V4]
        failures = set()
        timeouts = []

        def resolve(self, host, port, *args, **kwargs):
            self.lookups.append(host)
            try:
                ipaddress.ip_address(host)
            except ValueError:
                addresses = self.addresses(host) if callable(self.addresses) else self.addresses
            else:
                # Numeric getaddrinfo never performs a DNS hostname lookup.
                addresses = [host]
            return [
                (
                    socket.AF_INET6 if ":" in ip else socket.AF_INET,
                    socket.SOCK_STREAM,
                    socket.IPPROTO_TCP,
                    "",
                    (ip, port, 0, 0) if ":" in ip else (ip, port),
                )
                for ip in addresses
            ]

    wire = Wire()

    class Socket:
        def __init__(self, *args, **kwargs):
            self.response = b""

        def settimeout(self, timeout):
            wire.timeouts.append(timeout)

        def setsockopt(self, *args):
            pass

        def connect(self, address):
            wire.connects.append(address)
            if address[0] in wire.failures:
                raise OSError("synthetic unreachable address")
            self.response = wire.responses.pop(0)

        def send(self, data):
            wire.requests.append(bytes(data))
            return len(data)

        def recv(self, length):
            content, self.response = self.response[:length], self.response[length:]
            return content

        def close(self):
            wire.closed.append(self)

    monkeypatch.setattr(socket, "getaddrinfo", wire.resolve)
    monkeypatch.setattr(socket, "socket", Socket)
    return wire


def test_rebinding_cannot_replace_checked_address_at_dial(wire):
    def rebind(host):
        return [PUBLIC_V4] if wire.lookups.count(host) == 1 else ["127.0.0.1"]

    wire.addresses = rebind
    assert fetcher.fetch_bookmark("http://public.example/article?x=1") == "public"
    assert wire.lookups == ["public.example", PUBLIC_V4]
    assert wire.connects == [(PUBLIC_V4, 80)]
    request = b"".join(wire.requests)
    assert b"Host: public.example\r\n" in request
    assert b"GET /article?x=1 HTTP/1.1\r\n" in request
    assert wire.closed


@pytest.mark.parametrize(
    "addresses",
    [
        [],
        ["127.0.0.1"],
        ["10.0.0.1"],
        ["169.254.169.254"],
        ["::1"],
        ["fc00::1"],
        ["fe80::1"],
        ["::ffff:127.0.0.1"],
        [PUBLIC_V4, "::1"],
        [PUBLIC_V6, "192.168.1.1"],
    ],
)
def test_entire_dns_answer_must_be_public_before_any_connection(wire, addresses):
    wire.addresses = addresses
    with pytest.raises(ValueError, match="内网"):
        fetcher.fetch_bookmark("http://public.example")
    assert wire.connects == []


@pytest.mark.parametrize("addresses", [[PUBLIC_V6, PUBLIC_V4], [PUBLIC_V4, PUBLIC_V6]])
def test_public_ipv4_ipv6_fallback_preserves_resolver_order(wire, addresses):
    wire.addresses = addresses
    wire.failures.add(addresses[0])
    assert fetcher.fetch_bookmark("http://public.example") == "public"
    assert [address[0] for address in wire.connects] == addresses
    assert all(timeout <= 15 for timeout in wire.timeouts)
    assert len(wire.closed) >= 2


@pytest.mark.parametrize("host", [PUBLIC_V4, f"[{PUBLIC_V6}]"])
def test_public_numeric_urls_keep_host_header(wire, host):
    assert fetcher.fetch_bookmark(f"http://{host}/article") == "public"
    assert f"Host: {host}\r\n".encode() in b"".join(wire.requests)


@pytest.mark.parametrize("location", ["http://internal.example/secret", "/next"])
def test_redirect_revalidates_on_new_connection_including_same_host(wire, location):
    wire.responses = [
        b"HTTP/1.1 302 Found\r\nLocation: "
        + location.encode()
        + b"\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
    ]
    resolutions = []

    def rebind(host):
        resolutions.append(host)
        return [PUBLIC_V4] if len(resolutions) == 1 else ["127.0.0.1"]

    wire.addresses = rebind
    with pytest.raises(ValueError, match="内网"):
        fetcher.fetch_bookmark("http://public.example")
    assert len(resolutions) == 2
    assert wire.connects == [(PUBLIC_V4, 80)]
    assert wire.closed


def test_public_redirect_remains_readable(wire):
    wire.responses = [
        b"HTTP/1.1 302 Found\r\nLocation: http://next.example/article\r\n"
        b"Content-Length: 0\r\nConnection: close\r\n\r\n",
        OK,
    ]
    assert fetcher.fetch_bookmark("http://public.example") == "public"
    assert wire.lookups == ["public.example", PUBLIC_V4, "next.example", PUBLIC_V4]
    assert b"Host: next.example\r\n" in b"".join(wire.requests)


@pytest.mark.parametrize("proxy", ["HTTP_PROXY", "http_proxy", "ALL_PROXY"])
def test_proxy_fails_closed_without_dialing_or_disclosing_settings(wire, monkeypatch, proxy):
    monkeypatch.setenv(proxy, "http://username:secret@proxy.example:8080")
    with pytest.raises(fetcher.BookmarkFetchError) as error:
        fetcher.fetch_bookmark("http://public.example")
    assert error.value.code == "proxy_unsupported"
    assert "proxy.example" not in str(error.value) and "secret" not in str(error.value)
    assert wire.lookups == [] and wire.connects == []


def test_https_proxy_does_not_block_unproxied_http(wire, monkeypatch):
    monkeypatch.setenv("HTTPS_PROXY", "http://proxy.example:8080")
    assert fetcher.fetch_bookmark("http://public.example") == "public"


@pytest.mark.parametrize(
    "entry,url,allowed",
    [
        ("*", "https://example.org", True),
        ("other.org", "https://example.org", False),
        ("example.org", "https://example.org", True),
        ("example.org", "https://sub.example.org", True),
        (".example.org", "https://example.org", False),
        (".example.org", "https://sub.example.org", True),
        ("example.org", "https://notexample.org", False),
        ("example.org:8443", "https://example.org:8443", True),
        ("example.org:8443", "https://example.org", False),
        ("https://example.org", "http://example.org", False),
        ("https://example.org", "https://sub.example.org", False),
        ("https://example.org", "https://example.org", True),
        ("EXAMPLE.ORG", "https://example.org", True),
        ("localhost", "http://sub.localhost", False),
        (PUBLIC_V4, f"http://{PUBLIC_V4}", True),
        (PUBLIC_V6, f"https://[{PUBLIC_V6}]", True),
        (PUBLIC_V6, "https://[2606:4700:4700::1001]", False),
    ],
)
def test_no_proxy_matches_httpx_routing(monkeypatch, entry, url, allowed):
    monkeypatch.setenv("ALL_PROXY", "http://proxy.example:8080")
    monkeypatch.setenv("NO_PROXY", entry)
    if allowed:
        public_http.require_direct_route(httpx.URL(url))
    else:
        with pytest.raises(public_http.BookmarkProxyError):
            public_http.require_direct_route(httpx.URL(url))


def test_no_proxy_direct_route_keeps_address_validation(wire, monkeypatch):
    monkeypatch.setenv("HTTP_PROXY", "http://proxy.example:8080")
    monkeypatch.setenv("NO_PROXY", "public.example")
    wire.addresses = ["127.0.0.1"]
    with pytest.raises(ValueError, match="内网"):
        fetcher.fetch_bookmark("http://public.example")
    assert wire.connects == []


def test_redirect_cannot_bypass_proxy_selection(wire, monkeypatch):
    monkeypatch.setenv("HTTP_PROXY", "http://proxy.example:8080")
    monkeypatch.setenv("NO_PROXY", "public.example")
    wire.responses = [
        b"HTTP/1.1 302 Found\r\nLocation: http://other.example/article\r\n"
        b"Content-Length: 0\r\nConnection: close\r\n\r\n"
    ]
    with pytest.raises(fetcher.BookmarkFetchError) as error:
        fetcher.fetch_bookmark("http://public.example")
    assert error.value.code == "proxy_unsupported"
    assert wire.connects == [(PUBLIC_V4, 80)]


@pytest.mark.parametrize("stage", ["connect", "body"])
@pytest.mark.parametrize(
    "error,code",
    [
        (httpcore.ConnectTimeout, "timeout"),
        (httpcore.ReadTimeout, "timeout"),
        (httpcore.ReadError, "network_error"),
        (httpcore.RemoteProtocolError, "network_error"),
    ],
)
def test_transport_errors_keep_fetch_classification(monkeypatch, stage, error, code):
    closed = []

    class Stream(httpcore.MockStream):
        def read(self, max_bytes, timeout=None):
            if not self._buffer:
                raise error("private-url-or-provider-text")
            return super().read(max_bytes, timeout)

        def close(self):
            closed.append(True)
            super().close()

    class Backend(httpcore.NetworkBackend):
        def connect_tcp(self, *args, **kwargs):
            if stage == "connect":
                raise error("private-url-or-provider-text")
            return Stream([b"HTTP/1.1 200 OK\r\nContent-Length: 6\r\n\r\n"])

    monkeypatch.setattr(public_http, "PublicNetworkBackend", Backend)
    with pytest.raises(fetcher.BookmarkFetchError) as failure:
        fetcher.fetch_bookmark("http://public.example")
    assert failure.value.code == code
    assert "private" not in str(failure.value)
    if stage == "body":
        assert closed


def test_tls_uses_original_sni_and_verifies_certificates(monkeypatch):
    observed = []

    class Stream(httpcore.MockStream):
        def start_tls(self, ssl_context, server_hostname=None, timeout=None):
            observed.append((server_hostname, ssl_context.check_hostname, ssl_context.verify_mode))
            return self

    monkeypatch.setattr(public_http, "public_addresses", lambda host, port: [PUBLIC_V4])
    monkeypatch.setattr(httpcore.SyncBackend, "connect_tcp", lambda *args, **kwargs: Stream([OK]))
    assert fetcher.fetch_bookmark("https://public.example") == "public"
    assert observed == [("public.example", True, ssl.CERT_REQUIRED)]


def test_all_address_attempts_share_one_connect_budget(monkeypatch):
    clock = iter([10.0, 11.0, 14.0])
    monkeypatch.setattr(public_http, "monotonic", lambda: next(clock))
    monkeypatch.setattr(public_http, "public_addresses", lambda *args: [PUBLIC_V6, PUBLIC_V4])
    attempts = []

    def dial(self, host, port, **kwargs):
        attempts.append((host, kwargs["timeout"]))
        if host == PUBLIC_V6:
            raise httpcore.ConnectError("synthetic failure")
        return httpcore.MockStream([OK])

    monkeypatch.setattr(httpcore.SyncBackend, "connect_tcp", dial)
    public_http.PublicNetworkBackend().connect_tcp("public.example", 443, timeout=15)
    assert attempts == [(PUBLIC_V6, 14.0), (PUBLIC_V4, 11.0)]


def test_exhausted_connect_budget_does_not_try_another_address(monkeypatch):
    clock = iter([10.0, 11.0, 26.0])
    monkeypatch.setattr(public_http, "monotonic", lambda: next(clock))
    monkeypatch.setattr(public_http, "public_addresses", lambda *args: [PUBLIC_V6, PUBLIC_V4])
    attempts = []

    def dial(self, host, port, **kwargs):
        attempts.append(host)
        raise httpcore.ConnectTimeout("synthetic timeout")

    monkeypatch.setattr(httpcore.SyncBackend, "connect_tcp", dial)
    with pytest.raises(httpcore.ConnectTimeout):
        public_http.PublicNetworkBackend().connect_tcp("public.example", 443, timeout=15)
    assert attempts == [PUBLIC_V6]


def test_body_limit_still_closes_connection(wire):
    body = b"a" * 4_000_001
    wire.responses = [
        b"HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 4000001\r\n"
        b"Connection: close\r\n\r\n" + body
    ]
    with pytest.raises(ValueError, match="读取上限"):
        fetcher.fetch_bookmark("http://public.example")
    assert wire.closed


def test_redirect_limit_still_closes_each_connection(wire):
    wire.responses = [
        b"HTTP/1.1 302 Found\r\nLocation: /next\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
    ] * 6
    with pytest.raises(ValueError, match="跳转次数"):
        fetcher.fetch_bookmark("http://public.example")
    assert len(wire.connects) == len(wire.closed) == 6
