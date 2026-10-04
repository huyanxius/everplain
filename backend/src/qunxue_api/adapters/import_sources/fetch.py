"""Bounded public webpage extraction for explicitly imported bookmarks."""

import ipaddress
import socket
from urllib.parse import urljoin, urlsplit

import httpx
import trafilatura


class BookmarkFetchError(ValueError):
    """A classified failure that is safe to persist without page or provider text."""

    def __init__(self, code, message):
        self.code = code
        super().__init__(message)


def extract_bookmark(content, *, url=None):
    # Trafilatura's precision preset skips its broad baseline rescue, which can
    # turn JS/login shells into articles. Keep its maintained content heuristics
    # and readability/jusText fallbacks rather than introducing our own selectors.
    text = trafilatura.extract(
        content,
        url=url,
        favor_precision=True,
        include_comments=False,
        include_links=True,
        include_tables=True,
        output_format="markdown",
    )
    if not text or not text.strip():
        raise BookmarkFetchError(
            "body_unavailable",
            "未读取到网页正文，页面可能需要登录或 JavaScript。"
            "请在浏览器打开原网页，加载完成后用收藏助手“收藏当前页面”。",
        )
    return text


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
    try:
        return _fetch_bookmark(url)
    except httpx.HTTPStatusError as exc:
        status = exc.response.status_code
        if status in (401, 403):
            code, message = (
                "access_denied",
                "网站拒绝后台读取或需要登录，请打开原网页后收藏当前页面。",
            )
        elif status in (404, 410):
            code, message = "not_found", "网页不存在或已被移除，请检查原始书签地址。"
        elif status == 429:
            code, message = "rate_limited", "网站暂时限制访问频率，请稍后单独重试。"
        else:
            code, message = "http_error", f"网站返回 HTTP {status}，请稍后单独重试。"
        raise BookmarkFetchError(code, message) from exc
    except httpx.TimeoutException as exc:
        raise BookmarkFetchError("timeout", "读取网页超时，请稍后单独重试。") from exc
    except (httpx.RequestError, socket.gaierror) as exc:
        raise BookmarkFetchError("network_error", "无法连接原网站，请检查地址后单独重试。") from exc


def _fetch_bookmark(url):
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
                media_type = response.headers.get("content-type", "").split(";", 1)[0].strip()
                if media_type and media_type not in {
                    "text/html",
                    "application/xhtml+xml",
                    "text/plain",
                }:
                    raise BookmarkFetchError(
                        "unsupported_content", "链接不是可读取的网页，请下载文件后使用文件导入。"
                    )
                content = bytearray()
                for chunk in response.iter_bytes():
                    content.extend(chunk)
                    if len(content) > 4_000_000:
                        raise ValueError("网页超过读取上限")
                if media_type == "text/plain":
                    text = (
                        bytes(content)
                        .decode(response.encoding or "utf-8", errors="replace")
                        .strip()
                    )
                    if text:
                        return text
                return extract_bookmark(bytes(content), url=url)
    raise ValueError("网页跳转次数过多")
