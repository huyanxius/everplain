import io
import json
import unittest
import zipfile
from pathlib import Path

from qunxue_api.adapters.import_sources import ImportParseError, parse_import


def fixture(name):
    return (Path(__file__).parent / "fixtures" / "import_sources" / name).read_bytes()


def archive(files):
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as z:
        for name, content in files:
            z.writestr(name, content)
    return output.getvalue()


class ImportSourcesTest(unittest.TestCase):
    def test_markdown_paths_links_metadata_and_stable_identity(self):
        files = [
            (
                "甲/笔记.md",
                (
                    "---\ntags: [中文, 阅读]\ncreated: 2026-01-01\n---\n# 标题\n"
                    "[[双链|别名]] ![[图.png]] [附件](assets/a.pdf)"
                ).encode(),
            ),
            ("乙/笔记.md", b"# other"),
        ]
        items = parse_import("obsidian", files)
        self.assertEqual(items[0]["title"], "标题")
        self.assertEqual(items[0]["wiki_links"], ["双链", "图.png"])
        self.assertEqual(items[0]["relative_path"], "甲/笔记.md")
        self.assertIn("中文", items[0]["metadata"]["tags"])
        self.assertIn(b"assets/a.pdf", items[0]["content"])
        self.assertEqual(
            items[0]["source_key"], parse_import("obsidian", files[::-1])[1]["source_key"]
        )
        self.assertNotEqual(items[0]["source_key"], items[1]["source_key"])

    def test_bookmarks(self):
        items = parse_import(
            "chrome",
            [
                (
                    "Bookmarks.html",
                    b"<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><DT><H3>Folder</H3><DL>"
                    b'<DT><A HREF="https://example.com" ADD_DATE="123" TAGS="read">'
                    b"Example</A></DL></DL>",
                )
            ],
        )
        self.assertEqual(items[0]["source_url"], "https://example.com")
        self.assertEqual(items[0]["content"], b"")
        self.assertEqual(items[0]["metadata"]["created"], "123")

    def test_enex_partial_success_and_entities(self):
        data = fixture("notes.enex")
        items = parse_import("enex", [("notes.enex", data)])
        self.assertEqual(len(items), 2)
        self.assertIn(b"https://example.com", items[0]["content"])
        self.assertEqual(items[0]["metadata"]["tags"], ["read"])
        self.assertIn("error", items[1])
        with self.assertRaises(ImportParseError):
            parse_import("enex", [("bad.enex", b'<!DOCTYPE x [<!ENTITY x "boom">]><en-export/>')])

    def test_notion_zip_and_html_links(self):
        data = archive(
            [
                ("Export/中文 abc.md", "# 中文\n[附件](assets/a.pdf)"),
                (
                    "Export/page.html",
                    "<html><head><title>页面</title></head><body><h1>页面</h1><p>中文 "
                    '<a href="中文%20abc.md">笔记</a><img src="assets/x.png"></p></body></html>',
                ),
                ("Export/assets/a.pdf", b"pdf"),
            ]
        )
        items = parse_import("notion", [("export.zip", data)])
        self.assertEqual(len(items), 2)
        self.assertIn("Export/", items[0]["relative_path"])
        self.assertIn(b"assets/x.png", items[1]["content"])

    def test_flomo_multiple_memos(self):
        data = fixture("flomo.html")
        items = parse_import("flomo", [("flomo.html", data)])
        self.assertEqual(len(items), 2)
        self.assertEqual(items[0]["metadata"]["tags"], ["阅读"])
        self.assertEqual(items[0]["metadata"]["created"], "2026-01-01")

    def test_keep_json_html_duplicate_and_partial(self):
        note = json.dumps(
            {
                "title": "购物",
                "listContent": [{"text": "茶", "isChecked": True}],
                "labels": [{"name": "生活"}],
                "createdTimestampUsec": 123,
                "attachments": [{"filePath": "image.png"}],
            },
            ensure_ascii=False,
        )
        data = archive(
            [
                ("Takeout/Keep/note.json", note),
                (
                    "Takeout/Keep/note.html",
                    '<html><div class="title">购物</div><div class="content">茶</div></html>',
                ),
                ("Takeout/Keep/bad.json", "{"),
            ]
        )
        items = parse_import("keep", [("takeout.zip", data)])
        self.assertEqual(len(items), 2)
        self.assertIn("- [x] 茶", items[0]["content"].decode())
        self.assertEqual(items[0]["metadata"]["tags"], ["生活"])
        self.assertIn("error", items[1])
        html = parse_import(
            "keep",
            [
                (
                    "note.html",
                    '<div class="title">中文</div><div class="content">正文</div>'.encode(),
                )
            ],
        )[0]
        self.assertEqual(html["title"], "中文")

    def test_invalid_and_archive_limits(self):
        for files in [
            [],
            [("bad.md", b"\xff")],
            [("../x.md", b"x")],
            [("a.zip", archive([("../escape.md", b"x")]))],
            [("a.zip", archive([("x.md", b"a" * (17 * 1024 * 1024))]))],
        ]:
            with self.subTest(files=[n for n, _ in files]), self.assertRaises(ImportParseError):
                parse_import("markdown", files)
        with self.assertRaises(ImportParseError):
            parse_import("unknown", [("x.md", b"x")])

    def test_bad_file_does_not_hide_good_file(self):
        items = parse_import("markdown", [("bad.md", b"\xff"), ("good.md", b"# good")])
        self.assertIn("error", items[0])
        self.assertEqual(items[1]["title"], "good")


class AdditionalImportSourcesTest(unittest.TestCase):
    def test_markdown_setext_heading_and_empty_rejection(self):
        item = parse_import("apple_notes", [("note.md", "中文标题\n========\n\n正文".encode())])[0]
        self.assertEqual(item["title"], "中文标题")
        with self.assertRaises(ImportParseError):
            parse_import("markdown", [("empty.md", b"")])

    def test_collision_paths_are_order_independent(self):
        files = [("page.md", b"# Markdown"), ("page.html", b"<h1>HTML</h1>")]
        forward = {i["source_key"]: i["relative_path"] for i in parse_import("notion", files)}
        reverse = {i["source_key"]: i["relative_path"] for i in parse_import("notion", files[::-1])}
        self.assertEqual(forward, reverse)
        self.assertEqual(len(set(forward.values())), 2)

    def test_keep_bad_record_does_not_hide_other_records(self):
        data = json.dumps({"title": "bad", "listContent": [None]})
        items = parse_import(
            "keep",
            [("bad.json", data.encode()), ("good.json", b'{"title":"good","textContent":"hello"}')],
        )
        self.assertIn("error", items[0])
        self.assertEqual(items[1]["title"], "good")

    def test_unsafe_archive_has_no_partial_notes(self):
        data = archive([("good.md", b"# should not escape"), ("../bad.md", b"bad")])
        items = parse_import("markdown", [("unsafe.zip", data), ("safe.md", b"# safe")])
        self.assertEqual(sum("error" not in i for i in items), 1)
        self.assertEqual(items[1]["title"], "safe")

    def test_nested_notion_zip(self):
        data = archive([("Export.zip", archive([("page.md", b"# nested")]))])
        self.assertEqual(parse_import("notion", [("notion.zip", data)])[0]["title"], "nested")


class ExportFixtureTest(unittest.TestCase):
    def test_saved_export_structures(self):

        root = Path(__file__).parent / "fixtures" / "import_sources"
        for source, filename, count in [
            ("chrome", "bookmarks.html", 1),
            ("markdown", "中文.md", 1),
            ("enex", "notes.enex", 2),
            ("notion", "page.html", 1),
            ("flomo", "flomo.html", 2),
            ("keep", "keep.json", 1),
        ]:
            with self.subTest(source=source):
                items = parse_import(source, [(filename, (root / filename).read_bytes())])
                self.assertEqual(len(items), count)
                if source == "notion":
                    self.assertEqual(items[0]["metadata"]["created"], "2026-01-01")
                    self.assertEqual(items[0]["metadata"]["tags"], ["中文"])

    def test_deep_html_is_partial_failure(self):
        items = parse_import(
            "notion", [("deep.html", b"<div>" * 200 + b"hello"), ("ok.md", b"# OK")]
        )
        self.assertIn("error", items[0])
        self.assertEqual(items[1]["title"], "OK")


class KeepFallbackTest(unittest.TestCase):
    def test_bad_json_falls_back_to_html(self):
        items = parse_import(
            "keep", [("note.html", b'<div class="content">saved</div>'), ("note.json", b"{")]
        )
        self.assertEqual(sum("error" not in i for i in items), 1)
        self.assertEqual(sum("error" in i for i in items), 1)

    def test_zip_symlink_rejected(self):
        output = io.BytesIO()
        with zipfile.ZipFile(output, "w") as z:
            info = zipfile.ZipInfo("note.md")
            info.create_system = 3
            info.external_attr = 0o120777 << 16
            z.writestr(info, b"/etc/passwd")
        with self.assertRaises(ImportParseError) as error:
            parse_import("markdown", [("links.zip", output.getvalue())])
        self.assertIn("symlinks", error.exception.items[0]["error"])


if __name__ == "__main__":
    unittest.main()


def test_folder_attachment_resolution_is_local_bounded_and_binary_safe():
    text = (
        "# A\n![[image.png]] [local](../assets/report.pdf#page=2) "
        "![remote](https://example.org/image.png) [private](file:///etc/secret.pdf) "
        "![root](/assets/root.png) [escape](../../../escape.pdf) "
        "\n```md\n![[example.png]]\n```\n`![[example.png]]`"
    )
    files = [
        ("Vault/notes/A.md", text.encode()),
        ("Vault/assets/image.png", b"\xff\x00"),
        ("Vault/assets/report.pdf", b"pdf"),
        ("Vault/assets/example.png", b"code example"),
        ("Vault/.obsidian/config.md", b"# private"),
        ("Vault/.trash/deleted.md", b"# deleted"),
        ("Vault/.env", b"SECRET=do-not-read"),
        ("Vault/node_modules/pkg.md", b"# config"),
        ("Vault/__MACOSX/private.md", b"# system"),
        ("Vault/assets/unused.png", b"unused"),
    ]
    parsed = parse_import("obsidian", files)
    assert len(parsed) == 1 and parsed[0]["content"] == text.encode()
    assets = {asset["relative_path"]: asset for asset in parsed[0]["attachments"]}
    assert set(assets) == {"Vault/assets/image.png", "Vault/assets/report.pdf"}
    assert assets["Vault/assets/image.png"]["content"] == b"\xff\x00"
    assert assets["Vault/assets/report.pdf"]["references"] == ["../assets/report.pdf#page=2"]


def test_zip_fallback_preserves_local_attachments_and_skips_private_paths():
    files = [
        ("A.md", b"# A\n![[image.png]]"),
        ("assets/image.png", b"\xff\x00"),
        (".obsidian/private.md", b"# private"),
        (".git/config.md", b"# config"),
    ]
    parsed = parse_import("obsidian", [("Vault.zip", archive(files))])
    assert len(parsed) == 1 and parsed[0]["relative_path"] == "Vault/A.md"
    assert parsed[0]["attachments"][0]["relative_path"] == "Vault/assets/image.png"
    assert parsed[0]["attachments"][0]["content"] == b"\xff\x00"


def test_ambiguous_wiki_attachment_is_not_guessed():
    parsed = parse_import(
        "obsidian",
        [
            ("Vault/A.md", b"# A\n![[same.png]]"),
            ("Vault/a/same.png", b"one"),
            ("Vault/b/same.png", b"two"),
        ],
    )
    assert parsed[0]["attachments"] == []


def test_attachment_input_limits_apply_to_binary_assets(monkeypatch):
    from qunxue_api.adapters.import_sources import parser

    monkeypatch.setattr(parser, "MAX_FILE_BYTES", 4)
    with unittest.TestCase().assertRaises(ImportParseError):
        parse_import("obsidian", [("Vault/assets/image.png", b"12345")])
    monkeypatch.setattr(parser, "MAX_FILE_BYTES", 100)
    monkeypatch.setattr(parser, "MAX_TOTAL_BYTES", 9)
    parsed = parse_import(
        "obsidian", [("Vault/A.md", b"# A"), ("Vault/assets/image.png", b"1234567")]
    )
    assert (
        next(item["error"] for item in parsed if "error" in item)
        == "import size/count limit exceeded"
    )
    monkeypatch.setattr(parser, "MAX_TOTAL_BYTES", 100)
    monkeypatch.setattr(parser, "MAX_FILES", 1)
    parsed = parse_import("obsidian", [("Vault/A.md", b"# A"), ("Vault/assets/image.png", b"x")])
    assert (
        next(item["error"] for item in parsed if "error" in item)
        == "import size/count limit exceeded"
    )
