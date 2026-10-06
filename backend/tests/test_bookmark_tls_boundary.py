"""Independent controlled TLS check. No network sockets are opened.

Application HTTPX/HTTPCore paths run unchanged. Only DNS and the physical dial
return a test stream; its start_tls performs a real OpenSSL MemoryBIO handshake.
"""

import os
import socket
import ssl
import subprocess

import httpcore
import pytest

from qunxue_api.adapters.import_sources import fetch as fetcher


@pytest.fixture(autouse=True)
def clean_proxy_environment(monkeypatch):
    for key in os.environ:
        if key.lower() in {
            "http_proxy",
            "https_proxy",
            "all_proxy",
            "no_proxy",
            "ssl_cert_file",
            "ssl_cert_dir",
        }:
            monkeypatch.delenv(key, raising=False)


@pytest.fixture
def tls_material(tmp_path):
    key = tmp_path / "generated-test-only.key"
    cert = tmp_path / "generated-test-only.pem"
    subprocess.run(
        [
            "openssl",
            "req",
            "-x509",
            "-newkey",
            "rsa:2048",
            "-sha256",
            "-nodes",
            "-keyout",
            str(key),
            "-out",
            str(cert),
            "-days",
            "1",
            "-subj",
            "/CN=public.example",
            "-addext",
            "subjectAltName=DNS:public.example",
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    return key, cert


def handshake(client_context, server_context, server_hostname):
    client_in, client_out = ssl.MemoryBIO(), ssl.MemoryBIO()
    server_in, server_out = ssl.MemoryBIO(), ssl.MemoryBIO()
    client = client_context.wrap_bio(client_in, client_out, server_hostname=server_hostname)
    server = server_context.wrap_bio(server_in, server_out, server_side=True)
    client_done = server_done = False
    for _ in range(20):
        try:
            client.do_handshake()
            client_done = True
        except ssl.SSLWantReadError:
            pass
        outbound = client_out.read()
        if outbound:
            server_in.write(outbound)
        try:
            server.do_handshake()
            server_done = True
        except ssl.SSLWantReadError:
            pass
        outbound = server_out.read()
        if outbound:
            client_in.write(outbound)
        if client_done and server_done:
            return client
    raise AssertionError("TLS MemoryBIO handshake did not finish")


class TLSFixtureStream(httpcore.NetworkStream):
    def __init__(self, server_context, observations):
        self.server_context = server_context
        self.observations = observations
        self.ssl_object = None
        self.response = (
            b"HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 6\r\n"
            b"Connection: close\r\n\r\npublic"
        )

    def read(self, max_bytes, timeout=None):
        chunk, self.response = self.response[:max_bytes], self.response[max_bytes:]
        return chunk

    def write(self, buffer, timeout=None):
        self.observations["writes"].append(bytes(buffer))

    def close(self):
        self.observations["closed"] = True

    def start_tls(self, ssl_context, server_hostname=None, timeout=None):
        self.observations["tls"] = {
            "server_hostname": server_hostname,
            "check_hostname": ssl_context.check_hostname,
            "verify_mode": ssl_context.verify_mode,
        }
        try:
            self.ssl_object = handshake(ssl_context, self.server_context, server_hostname)
        except ssl.SSLError as exc:
            self.close()
            raise httpcore.ConnectError(str(exc)) from exc
        return self

    def get_extra_info(self, info):
        if info == "ssl_object":
            return self.ssl_object
        return None


def install_test_network(monkeypatch, tls_material):
    key, cert = tls_material
    observations = {"dials": [], "writes": [], "sni": [], "closed": False}
    server = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    server.load_cert_chain(cert, key)
    server.set_servername_callback(lambda obj, name, context: observations["sni"].append(name))
    stream = TLSFixtureStream(server, observations)

    def resolve(host, port, *args, **kwargs):
        return [
            (socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", ("93.184.216.34", port))
        ]

    def dial(self, host, port, **kwargs):
        observations["dials"].append((host, port))
        return stream

    monkeypatch.setattr(socket, "getaddrinfo", resolve)
    monkeypatch.setattr(httpcore.SyncBackend, "connect_tcp", dial)
    return observations, cert


def test_pinned_dial_preserves_sni_host_and_real_certificate_validation(monkeypatch, tls_material):
    observations, cert = install_test_network(monkeypatch, tls_material)
    monkeypatch.setenv("SSL_CERT_FILE", str(cert))
    assert fetcher.fetch_bookmark("https://public.example/article") == "public"
    assert observations["dials"] == [("93.184.216.34", 443)]
    assert observations["sni"] == ["public.example"]
    assert observations["tls"] == {
        "server_hostname": "public.example",
        "check_hostname": True,
        "verify_mode": ssl.CERT_REQUIRED,
    }
    assert b"Host: public.example\r\n" in b"".join(observations["writes"])
    assert observations["closed"]


@pytest.mark.parametrize(
    "url,trust_cert",
    [
        ("https://wrong.example/article", True),
        ("https://public.example/article", False),
    ],
)
def test_real_tls_rejects_wrong_hostname_and_untrusted_cert(
    monkeypatch, tls_material, url, trust_cert
):
    observations, cert = install_test_network(monkeypatch, tls_material)
    if trust_cert:
        monkeypatch.setenv("SSL_CERT_FILE", str(cert))
    with pytest.raises(fetcher.BookmarkFetchError) as error:
        fetcher.fetch_bookmark(url)
    assert error.value.code == "network_error"
    assert observations["writes"] == []
    assert observations["closed"]
