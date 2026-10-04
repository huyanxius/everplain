"""Synthetic web responses reproduce navigation-only imports without user content."""

import httpx
import pytest
import trafilatura

from qunxue_api.adapters.import_sources import fetch as fetcher
from qunxue_api.adapters.import_sources import parse_import

SHELL = """<html><head><title>Dictionary</title></head><body>
<noscript>JavaScript must be activated for this page to work properly.
If you do not know how to activate JavaScript in your browser, please consult
one of the available guides on the internet. For example, see: www.enable-javascript.com
</noscript><nav>Account Log in English Deutsch 中文 Menu Home Collection Application
Pricing Register News &amp; Updates Contact</nav><div id="app"></div></body></html>"""
BODY = (
    "This paragraph explains how a dictionary represents useful concepts, "
    "with definitions and examples that readers can apply in practice. "
) * 4


def test_js_shell_reproduces_old_extraction_but_is_not_imported_as_body():
    assert "JavaScript must be activated" in trafilatura.extract(SHELL)
    with pytest.raises(fetcher.BookmarkFetchError) as error:
        fetcher.extract_bookmark(SHELL)
    assert error.value.code == "body_unavailable"
    assert "收藏当前页面" in str(error.value)


def test_article_preserves_main_body_and_links_without_navigation():
    article = (
        f"<article><h1>A definition</h1><p>{BODY} "
        '<a href="https://example.org/ref">Source reference</a>'
        " with further examples.</p></article>"
    )
    text = fetcher.extract_bookmark(SHELL.replace('<div id="app"></div>', article))
    assert "A definition" in text and BODY.strip() in text
    assert "https://example.org/ref" in text
    assert "JavaScript must be activated" not in text
    assert "Pricing" not in text


def test_short_chinese_definition_is_preserved_without_a_length_gate():
    definition = (
        "兼收并蓄：把不同内容、不同性质的东西都吸收进来。"
        "形容能包容不同意见和学术观点，取其所长，互相补充。"
        "例句：学术研究应当兼收并蓄。"
    )
    assert len(definition) == 63
    text = fetcher.extract_bookmark(
        "<html><head><title>兼收并蓄</title></head><body><article>"
        f"<h1>兼收并蓄</h1><p>{definition}</p></article></body></html>"
    )
    assert definition in text


def fake_web(monkeypatch, handler):
    client = httpx.Client
    monkeypatch.setattr(
        fetcher.httpx,
        "Client",
        lambda **kwargs: client(transport=httpx.MockTransport(handler), **kwargs),
    )
    monkeypatch.setattr(fetcher, "public_url", lambda url: url)


@pytest.mark.parametrize(
    "status,code",
    [
        (401, "access_denied"),
        (403, "access_denied"),
        (404, "not_found"),
        (410, "not_found"),
        (429, "rate_limited"),
        (502, "http_error"),
    ],
)
def test_http_errors_keep_safe_actionable_classification(monkeypatch, status, code):
    fake_web(monkeypatch, lambda request: httpx.Response(status, text="private-provider-token"))
    with pytest.raises(fetcher.BookmarkFetchError) as error:
        fetcher.fetch_bookmark("https://example.org/article?secret=private-query")
    assert error.value.code == code
    assert "private" not in str(error.value)


def test_network_timeout_is_distinct(monkeypatch):
    def timeout(request):
        raise httpx.ReadTimeout("private-url")

    fake_web(monkeypatch, timeout)
    with pytest.raises(fetcher.BookmarkFetchError) as error:
        fetcher.fetch_bookmark("https://example.org")
    assert error.value.code == "timeout"
    assert "private" not in str(error.value)


def test_pdf_link_does_not_create_fake_article(monkeypatch):
    fake_web(
        monkeypatch,
        lambda request: httpx.Response(
            200, content=b"%PDF-secret", headers={"Content-Type": "application/pdf"}
        ),
    )
    with pytest.raises(fetcher.BookmarkFetchError) as error:
        fetcher.fetch_bookmark("https://example.org/file.pdf")
    assert error.value.code == "unsupported_content"


def test_plain_text_link_preserves_body(monkeypatch):
    fake_web(
        monkeypatch,
        lambda request: httpx.Response(
            200, text=BODY, headers={"Content-Type": "text/plain; charset=utf-8"}
        ),
    )
    assert fetcher.fetch_bookmark("https://example.org/note.txt") == BODY.strip()


def test_every_redirect_still_checks_public_destination(monkeypatch):
    fake_web(
        monkeypatch,
        lambda request: httpx.Response(302, headers={"location": "http://127.0.0.1/internal"}),
    )
    checked = []

    def validate(url):
        checked.append(url)
        if "127.0.0.1" in url:
            raise ValueError("不能读取本机、内网或保留地址")

    monkeypatch.setattr(fetcher, "public_url", validate)
    with pytest.raises(ValueError, match="内网"):
        fetcher.fetch_bookmark("https://example.org")
    assert checked == ["https://example.org", "http://127.0.0.1/internal"]


def test_nested_bookmark_batch_preserves_all_50_items_and_titles():
    data = (
        "<DL><DT><H3>Folder</H3><DL>"
        + "".join(f'<DT><A HREF="https://example.org/{i}">Useful title {i}</A>' for i in range(50))
        + "</DL></DL>"
    )
    items = parse_import("chrome", [("bookmarks.html", data.encode())])
    assert len(items) == 50
    assert len({item["source_key"] for item in items}) == 50
    assert items[-1]["filename"] == "Useful title 49.md"
    assert items[-1]["relative_path"].endswith("bookmark-50.md")


def test_bookmark_display_filename_is_safe():
    item = parse_import(
        "chrome",
        [("bookmarks.html", b'<DL><A HREF="https://example.org">../path: title?</A></DL>')],
    )[0]
    assert "/" not in item["filename"] and ":" not in item["filename"]
    assert item["source_url"] == "https://example.org"
