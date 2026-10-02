"""Connect media adapters to the existing durable import item contract."""

import hashlib
import mimetypes
from dataclasses import asdict
from html import escape

from qunxue_api.adapters.import_sources import parse_import

MESSAGES = {
    "vision_not_configured": "尚未配置 Everplain 专用图像模型，请配置后重试",
    "transcription_not_configured": "此视频没有字幕，尚未配置专用转写服务",
    "yt_dlp_not_configured": "字幕读取组件尚未安装",
    "empty_transcript": "视频没有可读取的字幕或转写正文",
}


def parse_files(source_type, files):
    if source_type != "image":
        return parse_import(source_type, files)
    return [
        {
            "source_key": hashlib.sha256(data).hexdigest(),
            "title": name,
            "filename": name,
            "content": data,
            "media_type": mimetypes.guess_type(name)[0] or "",
            "source_url": None,
            "relative_path": name,
            "wiki_links": [],
            "metadata": {"original_media_type": mimetypes.guess_type(name)[0] or ""},
        }
        for name, data in files
    ]


def discovery_item(uid):
    return {
        "source_key": hashlib.sha256(("bilibili-uid:" + uid).encode()).hexdigest(),
        "title": "正在读取公开收藏夹",
        "filename": "favorites.txt",
        "content": b"",
        "media_type": "text/plain",
        "source_url": None,
        "relative_path": uid,
        "wiki_links": [],
        "metadata": {"enumerate_uid": uid},
    }


class MediaImportGateway:
    def __init__(self, favorites, video, image):
        self.favorites, self.video, self.image = favorites, video, image

    def clip(self, url, title, html):
        bookmarks = f'<DL><DT><A HREF="{escape(url, quote=True)}">{escape(title)}</A></DL>'
        source = parse_import("chrome", [("clip.html", bookmarks.encode())])[0]
        parsed = parse_import("notion", [("page.html", html.encode())])[0]
        if parsed.get("error"):
            raise ValueError(parsed["error"])
        return source | {
            "content": parsed["content"],
            "filename": (title or "网页收藏")[:100].replace("/", "_") + ".md",
            "relative_path": url,
            "media_type": "text/markdown",
        }

    def discovery(self, uid):
        return discovery_item(uid)

    def enumerate(self, uid):
        report = self.favorites.enumerate_public_favorites(uid)
        result = []
        for item in report.items:
            value = asdict(item)
            value["content"] = b""
            value["relative_path"] = value["relative_path"] or value["filename"]
            result.append(value)
        for error in report.errors:
            result.append(
                {
                    "source_key": error.source_key,
                    "title": "无法读取的收藏",
                    "filename": "unavailable.txt",
                    "content": b"",
                    "media_type": "text/plain",
                    "source_url": None,
                    "relative_path": error.source_key,
                    "wiki_links": [],
                    "metadata": error.metadata,
                    "error": error.message,
                }
            )
        if not result:
            raise ValueError("没有找到可读取的公开收藏；私密收藏不会被导入")
        return result

    def convert(self, item):
        if item["source_type"] == "image":
            result = self.image.import_image(
                filename=item["filename"],
                media_type=item["media_type"],
                content=item["content"],
                relative_path=item["relative_path"],
            )
        else:
            result = self.video.import_video(item["source_url"])
        if result.error:
            raise ValueError(MESSAGES.get(result.error.code, result.error.message))
        return asdict(result.item)
