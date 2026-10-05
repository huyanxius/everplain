from __future__ import annotations

import hashlib
import io
import json
import re
import stat
import zipfile
from dataclasses import dataclass, field
from html.parser import HTMLParser
from pathlib import PurePosixPath
from urllib.parse import urlsplit
from xml.etree import ElementTree as ET

from markdown_it import MarkdownIt

MAX_FILE_BYTES = 16 * 1024 * 1024
MAX_TOTAL_BYTES = 64 * 1024 * 1024
MAX_FILES = 2000
MAX_ZIP_DEPTH = 2


class ImportParseError(ValueError):
    """No valid notes, unknown format, or unsafe input; items retain diagnostics."""

    def __init__(self, message: str, items: list[dict] | None = None):
        super().__init__(message)
        self.items = items or []


@dataclass
class Node:
    tag: str = ""
    attrs: dict = field(default_factory=dict)
    children: list = field(default_factory=list)

    def text(self):
        return "".join(c.text() if isinstance(c, Node) else c for c in self.children)

    def find(self, predicate):
        for child in self.children:
            if isinstance(child, Node):
                if predicate(child):
                    yield child
                yield from child.find(predicate)


class Tree(HTMLParser):
    def __init__(self, value):
        super().__init__(convert_charrefs=True)
        self.root = Node()
        self.stack = [self.root]
        self.feed(value)
        self.close()

    def handle_starttag(self, tag, attrs):
        if len(self.stack) > 128:
            raise ValueError("HTML nesting limit exceeded")
        node = Node(tag, dict(attrs))
        self.stack[-1].children.append(node)
        if tag not in {"img", "br", "hr", "meta", "link", "input", "en-media", "en-todo", "dt"}:
            self.stack.append(node)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        self.handle_endtag(tag)

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, 0, -1):
            if self.stack[i].tag == tag:
                del self.stack[i:]
                return

    def handle_data(self, data):
        self.stack[-1].children.append(data)


def _class(node, name):
    return name in node.attrs.get("class", "").split()


def _first(node, predicate):
    return next(node.find(predicate), None)


def _markdown(node):
    if isinstance(node, str):
        return node
    if node.tag in {"script", "style", "head", "title"}:
        return ""
    text = "".join(_markdown(c) for c in node.children)
    if node.tag == "a":
        return f"[{text}]({node.attrs.get('href', '')})"
    if node.tag == "img":
        return f"![{node.attrs.get('alt', '')}]({node.attrs.get('src', '')})"
    if node.tag == "en-media":
        return f"![attachment](enex-resource:{node.attrs.get('hash', '')})"
    if node.tag in {"en-todo", "input"}:
        checked = node.attrs.get("checked") in {"true", "checked", ""}
        return "[x] " if checked else "[ ] "
    if node.tag in {"h1", "h2", "h3", "h4", "h5", "h6"}:
        return "\n" + "#" * int(node.tag[1]) + " " + text.strip() + "\n\n"
    if node.tag in {"strong", "b"}:
        return "**" + text + "**"
    if node.tag in {"em", "i"}:
        return "*" + text + "*"
    if node.tag == "pre":
        return "\n```\n" + node.text() + "\n```\n"
    if node.tag == "code":
        return "`" + text + "`"
    if node.tag == "li":
        return "\n- " + text.strip() + "\n"
    if node.tag == "br":
        return "\n"
    if node.tag in {"div", "p", "section", "article", "tr", "blockquote"}:
        return "\n" + text.strip() + "\n\n"
    if node.tag in {"td", "th"}:
        return text + " | "
    return text


def _html(value):
    root = Tree(value).root
    body = _first(root, lambda n: n.tag == "body") or root
    content = re.sub(r"\n{3,}", "\n\n", _markdown(body)).strip()
    title_node = _first(root, lambda n: n.tag == "h1") or _first(root, lambda n: n.tag == "title")
    return content, title_node.text().strip() if title_node else None, root


def _path(name):
    name = name.replace("\\", "/")
    if "\x00" in name or name.startswith("/") or re.match(r"^[A-Za-z]:", name):
        raise ValueError("unsafe absolute input path")
    if ".." in name.split("/"):
        raise ValueError("unsafe parent traversal input path")
    path = str(PurePosixPath(name))
    if path in {"", "."}:
        raise ValueError("empty input path")
    return path


def _key(source, identity):
    return hashlib.sha256((source + "\0" + identity).encode()).hexdigest()


def _item(source, path, content="", title=None, metadata=None, identity=None, source_url=None):
    output = str(PurePosixPath(path).with_suffix(".md"))
    title = title or PurePosixPath(path).stem
    return dict(
        source_key=_key(source, identity or path),
        title=title,
        filename=PurePosixPath(output).name,
        content=content.encode("utf-8"),
        media_type="text/markdown",
        source_url=source_url,
        relative_path=output,
        wiki_links=list(dict.fromkeys(re.findall(r"\[\[([^\]|#]+)(?:[^\]]*)\]\]", content))),
        metadata=metadata or {},
    )


def _error(source, path, exc):
    # Unsafe paths must never become an output path, even in diagnostics.
    item = _item(source, "invalid.md", identity=path)
    item.update(input_path=path, error=str(exc))
    return item


def _metadata(markdown):
    metadata = {}
    match = re.match(r"\A---\s*\n(.*?)\n---\s*(?:\n|$)", markdown, re.S)
    if match:
        metadata["frontmatter"] = match[1]
        for line in match[1].splitlines():
            field_match = re.match(r"^(tags|created|updated|date):\s*(.*)$", line)
            if field_match:
                key, value = field_match.groups()
                metadata[key] = (
                    re.findall(r'[^\s,\[\]"\']+', value) if key == "tags" else value.strip("\"'")
                )
    return metadata


def _notes(source, path, data):
    value = data.decode("utf-8-sig")
    suffix = PurePosixPath(path).suffix.lower()
    if source == "chrome":
        root = Tree(value).root
        for i, node in enumerate(root.find(lambda n: n.tag == "a"), 1):
            url = node.attrs.get("href", "")
            entry_path = str(PurePosixPath(path).with_suffix("")) + f"/bookmark-{i}.md"
            if urlsplit(url).scheme not in {"http", "https"} or not urlsplit(url).netloc:
                yield _error(source, entry_path, ValueError("bookmark requires HTTP(S) URL"))
                continue
            item = _item(
                source,
                entry_path,
                title=node.text().strip(),
                source_url=url,
                identity=url,
                metadata={
                    "created": node.attrs.get("add_date"),
                    "updated": node.attrs.get("last_modified"),
                    "tags": node.attrs.get("tags", "").split(","),
                },
            )
            # Keep source identity/path stable while displaying the bookmark title.
            filename = re.sub(r'[\\/:*?"<>|\x00-\x1f]', "_", item["title"]).strip(" .")[:120]
            item["filename"] = (filename or f"bookmark-{i}") + ".md"
            yield item
    elif source == "enex":
        # ElementTree does not fetch external DTDs; reject internal entity declarations.
        if re.search(r"<!ENTITY\b|<!DOCTYPE[^>]*\[", value, re.I):
            raise ValueError("ENEX entity declarations/internal DTDs are forbidden")
        root = ET.fromstring(value)
        if root.tag != "en-export":
            raise ValueError("expected en-export root")
        for i, note in enumerate(root.findall("note"), 1):
            note_path = str(PurePosixPath(path).with_suffix("")) + f"/note-{i}.md"
            try:
                enml = note.findtext("content")
                if not enml:
                    raise ValueError("ENEX note missing content")
                if re.search(r"<!ENTITY\b", enml, re.I):
                    raise ValueError("ENML entity declarations are forbidden")
                content, _, _ = _html(enml)
                metadata = {
                    "tags": [t.text or "" for t in note.findall("tag")],
                    "created": note.findtext("created"),
                    "updated": note.findtext("updated"),
                    "resources": [
                        {
                            "hash": r.find("data").get("hash")
                            if r.find("data") is not None
                            else None,
                            "mime": r.findtext("mime"),
                            "filename": r.findtext("resource-attributes/file-name"),
                        }
                        for r in note.findall("resource")
                    ],
                }
                title = note.findtext("title")
                identity = (
                    path
                    + "\0"
                    + (title or "")
                    + "\0"
                    + (note.findtext("created") or "")
                    + "\0"
                    + enml
                )
                yield _item(
                    source,
                    note_path,
                    content,
                    title,
                    metadata,
                    identity,
                    note.findtext("note-attributes/source-url"),
                )
            except (ValueError, ET.ParseError) as exc:
                yield _error(source, note_path, exc)
    elif source == "flomo":
        root = Tree(value).root
        for i, memo in enumerate(root.find(lambda n: _class(n, "memo")), 1):
            note_path = str(PurePosixPath(path).with_suffix("")) + f"/memo-{i}.md"
            body = _first(memo, lambda n: _class(n, "content"))
            time = _first(memo, lambda n: _class(n, "time"))
            if body is None or not body.text().strip():
                yield _error(source, note_path, ValueError("flomo memo missing content"))
                continue
            content = _markdown(body).strip()
            created = time.text().strip() if time else None
            yield _item(
                source,
                note_path,
                content,
                body.text().strip()[:80],
                {"created": created, "tags": re.findall(r"(?:^|\s)#([^\s#]+)", content)},
                path + "\0" + str(created) + "\0" + content,
            )
    elif source == "keep" and suffix == ".json":
        note = json.loads(value)
        if not isinstance(note, dict) or not any(
            k in note for k in ("textContent", "listContent", "title")
        ):
            raise ValueError("expected Google Keep note object")
        content = note.get("textContent", "")
        for entry in note.get("listContent", []):
            content += "\n- [" + ("x" if entry.get("isChecked") else " ") + "] " + entry["text"]
        for entry in note.get("attachments", []):
            content += f"\n[attachment]({entry.get('filePath', '')})"
        metadata = {
            k: note[k]
            for k in (
                "createdTimestampUsec",
                "userEditedTimestampUsec",
                "isArchived",
                "isTrashed",
                "isPinned",
                "attachments",
            )
            if k in note
        }
        metadata["tags"] = [label["name"] for label in note.get("labels", [])]
        yield _item(source, path, content.strip(), note.get("title"), metadata)
    elif suffix in {".md", ".markdown", ".txt"}:
        if not value.strip():
            raise ValueError("empty Markdown note")
        tokens = MarkdownIt("commonmark").parse(value)
        title = next(
            (
                tokens[i + 1].content
                for i, token in enumerate(tokens)
                if token.type == "heading_open" and token.tag == "h1"
            ),
            None,
        )
        yield _item(source, path, value, title, _metadata(value))
    elif suffix in {".html", ".htm"}:
        content, title, root = _html(value)
        metadata = {}
        if source == "notion":
            metadata["properties"] = {}
            for row in root.find(lambda n: n.tag == "tr"):
                label = _first(row, lambda n: n.tag == "th")
                cell = _first(row, lambda n: n.tag == "td")
                if label and cell:
                    metadata["properties"][label.text().strip()] = cell.text().strip()
                for css, key in [
                    ("property-row-created_time", "created"),
                    ("property-row-last_edited_time", "updated"),
                ]:
                    if _class(row, css):
                        time = _first(row, lambda n: n.tag == "time")
                        if time:
                            metadata[key] = time.attrs.get("datetime") or time.text().strip()
                if _class(row, "property-row-multi_select"):
                    metadata.setdefault("tags", []).extend(
                        n.text().strip() for n in row.find(lambda n: _class(n, "selected-value"))
                    )
        if source == "keep":
            title_node = _first(root, lambda n: _class(n, "title"))
            body = _first(root, lambda n: _class(n, "content"))
            title = title_node.text().strip() if title_node else title
            if body:
                content = _markdown(body).strip()
            metadata["tags"] = [n.text().strip() for n in root.find(lambda n: _class(n, "label"))]
        if not content:
            raise ValueError("HTML has no note content")
        yield _item(source, path, content, title, metadata)
    else:
        raise ValueError("unsupported note extension")


def parse_import(source_type: str, files: list[tuple[str, bytes]]) -> list[dict]:
    """Parse provided bytes; partial failures carry error; all-invalid raises with items.

    Source keys identify source namespace + original relative path (or native record
    identity), independent of input order. ZIPs are inspected/read only in memory.
    """
    aliases = {
        "bookmarks": "chrome",
        "chrome_bookmarks": "chrome",
        "obsidian": "markdown",
        "apple_notes": "markdown",
        "google_keep": "keep",
        "evernote": "enex",
    }
    source = aliases.get(source_type, source_type)
    if source not in {"chrome", "markdown", "enex", "notion", "flomo", "keep"}:
        raise ImportParseError(f"unsupported import source: {source_type}")
    items = []
    expanded = []
    budget = [0, 0]

    def expand(name, data, depth=0):
        path = _path(name)
        budget[0] += 1
        budget[1] += len(data)
        if budget[0] > MAX_FILES or len(data) > MAX_FILE_BYTES or budget[1] > MAX_TOTAL_BYTES:
            raise ValueError("import size/count limit exceeded")
        if PurePosixPath(path).suffix.lower() != ".zip":
            expanded.append((path, data))
            return
        if depth >= MAX_ZIP_DEPTH:
            raise ValueError("nested ZIP depth limit exceeded")
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            members = z.infolist()
            if len(members) + budget[0] > MAX_FILES:
                raise ValueError("archive entry count limit exceeded")
            total = 0
            for member in members:
                _path(member.filename)
                if stat.S_ISLNK(member.external_attr >> 16):
                    raise ValueError("archive symlinks forbidden")
                if member.flag_bits & 1:
                    raise ValueError("encrypted archive unsupported")
                total += member.file_size
                if member.file_size > MAX_FILE_BYTES or total + budget[1] > MAX_TOTAL_BYTES:
                    raise ValueError("archive expanded size limit exceeded")
            prefix = str(PurePosixPath(path).with_suffix(""))
            for member in members:
                if member.is_dir():
                    continue
                expand(prefix + "/" + member.filename, z.read(member), depth + 1)

    for name, data in files:
        checkpoint = len(expanded)
        try:
            expand(name, data)
        except (ValueError, OSError, zipfile.BadZipFile, RuntimeError, NotImplementedError) as exc:
            del expanded[checkpoint:]
            items.append(_error(source, name, exc))
    successful_json = set()
    if source == "keep":
        expanded.sort(key=lambda entry: PurePosixPath(entry[0]).suffix.lower() != ".json")
    allowed = {
        "chrome": {".html", ".htm"},
        "markdown": {".md", ".markdown", ".txt"},
        "notion": {".md", ".markdown", ".html", ".htm", ".txt"},
        "enex": {".enex"},
        "keep": {".json", ".html", ".htm"},
        "flomo": {".html", ".htm"},
    }
    for path, data in expanded:
        suffix = PurePosixPath(path).suffix.lower()
        if suffix not in allowed[source]:
            continue  # Export attachments remain linked; never decode binary assets.
        if (
            source == "keep"
            and suffix in {".html", ".htm"}
            and str(PurePosixPath(path).with_suffix(".json")) in successful_json
        ):
            continue  # Takeout emits two representations of the same note.
        try:
            parsed = list(_notes(source, path, data))
            items.extend(parsed)
            if source == "keep" and suffix == ".json" and any("error" not in i for i in parsed):
                successful_json.add(path)
        except (ValueError, ET.ParseError, KeyError, TypeError, AttributeError) as exc:
            items.append(_error(source, path, exc))
    if not any("error" not in item for item in items):
        raise ImportParseError("no valid import items", items)
    # Disambiguate same-folder conversion collisions without flattening directories.
    outputs = {}
    for item in items:
        outputs.setdefault(item["relative_path"], set()).add(item["source_key"])
    for item in items:
        path = item["relative_path"]
        if len(outputs[path]) > 1:
            p = PurePosixPath(path)
            item["relative_path"] = str(p.with_name(p.stem + "-" + item["source_key"] + p.suffix))
            item["filename"] = PurePosixPath(item["relative_path"]).name
    return items
