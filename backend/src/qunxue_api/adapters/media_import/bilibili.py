"""Anonymous public favorites enumeration. No login, cookie store, or video downloads."""

from __future__ import annotations

import re
from collections.abc import Callable
from typing import Any

import httpx

from .types import FavoritesReport, ImportError, ImportItem

_FOLDER_PATH = "/x/v3/fav/folder/created/list-all"
_RESOURCE_PATH = "/x/v3/fav/resource/list"


def metadata_content(title: str, url: str, description: str = "") -> bytes:
    text = f"# {title}\n\n来源：{url}\n\n资料范围：视频标题与简介\n"
    if description.strip():
        text += f"\n## 简介\n\n{description.strip()}\n"
    return text.encode("utf-8")


class BilibiliFavoritesAdapter:
    def __init__(
        self,
        *,
        request: Callable[[str, dict[str, Any]], dict[str, Any]] | None = None,
        transport: httpx.BaseTransport | None = None,
        max_pages: int = 500,
        timeout_seconds: float = 20,
    ) -> None:
        if max_pages < 1 or timeout_seconds <= 0:
            raise ValueError("positive page limit and timeout required")
        self._request_override = request
        self._transport = transport
        self._max_pages = max_pages
        self._timeout = timeout_seconds

    def _request(self, path: str, params: dict[str, Any]) -> dict[str, Any]:
        if self._request_override is not None:
            return self._request_override(path, params)
        # Fresh client per request: Set-Cookie cannot leak into the next page.
        with httpx.Client(
            transport=self._transport,
            timeout=self._timeout,
            follow_redirects=False,
            trust_env=False,
        ) as client:
            response = client.get(
                "https://api.bilibili.com" + path,
                params=params,
                headers={
                    "User-Agent": "Everplain-public-import/1.0",
                    "Referer": "https://www.bilibili.com/",
                },
            )
            response.raise_for_status()
            payload = response.json()
        if not isinstance(payload, dict):
            raise ValueError("invalid API response")
        return payload

    def enumerate_public_favorites(self, uid: str | int) -> FavoritesReport:
        uid_text = str(uid)
        if not re.fullmatch(r"[1-9][0-9]{0,19}", uid_text):
            return FavoritesReport(
                errors=(
                    ImportError(uid_text, "invalid_uid", "A positive numeric UID is required."),
                )
            )
        errors: list[ImportError] = []
        items: list[ImportItem] = []
        folders: list[dict[str, Any]] = []
        seen: set[str] = set()
        try:
            payload = self._request(_FOLDER_PATH, {"up_mid": uid_text})
            data = _data(payload, f"bilibili:uid:{uid_text}", errors)
            if data is None:
                return FavoritesReport(errors=tuple(errors))
            raw_folders = data.get("list") or []
            if not isinstance(raw_folders, list):
                raise ValueError("invalid folder list")
            for folder in raw_folders:
                if not isinstance(folder, dict) or not str(folder.get("id", "")).isdigit():
                    errors.append(
                        ImportError(uid_text, "invalid_folder", "Malformed folder metadata.")
                    )
                    continue
                folders.append(
                    {k: folder[k] for k in ("id", "title", "attr", "media_count") if k in folder}
                )
                folder_id = int(folder["id"])
                folder_key = f"bilibili:folder:{folder_id}"
                if int(folder.get("attr", 0)) & 1:
                    errors.append(
                        ImportError(folder_key, "private_folder", "Private folder is excluded.")
                    )
                    continue
                try:
                    for page in range(1, self._max_pages + 1):
                        resource = self._request(
                            _RESOURCE_PATH,
                            {
                                "media_id": folder_id,
                                "pn": page,
                                "ps": 20,
                                "order": "mtime",
                                "type": 0,
                                "platform": "web",
                            },
                        )
                        page_data = _data(resource, folder_key, errors)
                        if page_data is None:
                            break
                        medias = page_data.get("medias") or []
                        if not isinstance(medias, list) or "has_more" not in page_data:
                            raise ValueError("invalid page data")
                        for media in medias:
                            _append_media(media, folder_id, uid_text, items, errors, seen)
                        if not page_data["has_more"]:
                            break
                        if page == self._max_pages:
                            errors.append(
                                ImportError(
                                    folder_key,
                                    "pagination_limit",
                                    "Partial result: page limit reached.",
                                )
                            )
                except (httpx.HTTPError, ValueError, TypeError, KeyError):
                    errors.append(
                        ImportError(
                            folder_key,
                            "favorites_request_failed",
                            "Partial result: folder request failed.",
                        )
                    )
        except (httpx.HTTPError, ValueError, TypeError, KeyError):
            errors.append(
                ImportError(
                    f"bilibili:uid:{uid_text}",
                    "favorites_request_failed",
                    "Public favorites request failed.",
                )
            )
        return FavoritesReport(tuple(folders), tuple(items), tuple(errors))


def _data(payload: dict[str, Any], key: str, errors: list[ImportError]) -> dict | None:
    code = payload.get("code")
    if code != 0:
        error_code = "private_or_inaccessible" if code in {-403, -101} else "bilibili_api_error"
        errors.append(
            ImportError(
                key, error_code, "Public API denied or failed the request.", {"api_code": code}
            )
        )
        return None
    if not isinstance(payload.get("data"), dict):
        raise ValueError("missing API data")
    return payload["data"]


def _append_media(
    media: Any,
    folder_id: int,
    uid: str,
    items: list[ImportItem],
    errors: list[ImportError],
    seen: set[str],
) -> None:
    if not isinstance(media, dict):
        errors.append(
            ImportError(
                f"bilibili:folder:{folder_id}", "invalid_media", "Malformed media metadata."
            )
        )
        return
    bvid = str(media.get("bvid") or media.get("bv_id") or "")
    avid = str(media.get("id", ""))
    key = f"bilibili:{bvid or avid}"
    if media.get("attr", 0) != 0:
        errors.append(
            ImportError(
                key,
                "unavailable_media",
                "Deleted or unavailable media.",
                {"folder_id": folder_id, "attr": media.get("attr")},
            )
        )
        return
    if media.get("type") != 2:
        errors.append(ImportError(key, "unsupported_media", "Only video entries are supported."))
        return
    video_id = (
        bvid
        if re.fullmatch(r"BV[0-9A-Za-z]{10}", bvid)
        else (f"av{avid}" if re.fullmatch(r"[1-9][0-9]*", avid) else None)
    )
    if video_id is None:
        errors.append(ImportError(key, "invalid_media", "Missing valid video identifier."))
        return
    key = f"bilibili:{video_id}"
    if key in seen:
        # Retain collection memberships while deduplicating documents.
        for item in items:
            if item.source_key == key and folder_id not in item.metadata["folder_ids"]:
                item.metadata["folder_ids"].append(folder_id)
        return
    seen.add(key)
    title = str(media.get("title") or video_id)
    url = f"https://www.bilibili.com/video/{video_id}"
    description = str(media.get("intro") or "")
    items.append(
        ImportItem(
            key,
            title,
            f"{video_id}.txt",
            metadata_content(title, url, description),
            source_url=url,
            relative_path=f"bilibili/{video_id}.txt",
            metadata={
                "uid": uid,
                "folder_ids": [folder_id],
                "text_source": "metadata",
                "description": description,
                "duration": media.get("duration"),
                "pages": media.get("page"),
            },
        )
    )
