"""Bounded public webpage extraction for explicitly imported bookmarks."""

import ipaddress
import socket
from urllib.parse import urljoin, urlsplit

import httpx
import trafilatura


def public_url(url):
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
    addresses = socket.getaddrinfo(
        value.hostname,
        value.port or (443 if value.scheme == "https" else 80),
        type=socket.SOCK_STREAM,
    )
    if not addresses or any(not ipaddress.ip_address(row[4][0]).is_global for row in addresses):
        raise ValueError("不能读取本机、内网或保留地址")
    return url


def fetch_bookmark(url):
    with httpx.Client(timeout=15, follow_redirects=False) as client:
        for _ in range(6):
            public_url(url)
            with client.stream(
                "GET", url, headers={"User-Agent": "EverplainImport/1.0"}
            ) as response:
                if response.is_redirect:
                    url = urljoin(url, response.headers["location"])
                    continue
                response.raise_for_status()
                content = bytearray()
                for chunk in response.iter_bytes():
                    content.extend(chunk)
                    if len(content) > 4_000_000:
                        raise ValueError("网页超过读取上限")
                text = trafilatura.extract(bytes(content), include_links=True, include_tables=True)
                if not text:
                    raise ValueError("网页没有可提取的正文，可能需要登录或已失效")
                return text
    raise ValueError("网页跳转次数过多")
