"""Public DASH audio downloader: no yt-dlp video downloads or persistent media."""

from __future__ import annotations

from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import httpx

from .video import validate_video_url


class BilibiliTemporaryAudioProvider:
    def __init__(
        self,
        *,
        transport: httpx.BaseTransport | None = None,
        max_audio_bytes: int = 25_000_000,
        timeout_seconds: float = 60,
    ) -> None:
        if max_audio_bytes < 1 or timeout_seconds <= 0:
            raise ValueError("positive size limit and timeout required")
        self._transport = transport
        self._max_bytes = max_audio_bytes
        self._timeout = timeout_seconds

    def _client(self) -> httpx.Client:
        return httpx.Client(
            transport=self._transport,
            timeout=self._timeout,
            trust_env=False,
            follow_redirects=False,
            headers={
                "Referer": "https://www.bilibili.com/",
                "User-Agent": "Everplain-public-import/1.0",
            },
        )

    def _get_json(self, path: str, params: dict) -> dict:
        with self._client() as client:
            response = client.get("https://api.bilibili.com" + path, params=params)
            response.raise_for_status()
            payload = response.json()
        if payload.get("code") != 0 or not isinstance(payload.get("data"), dict):
            raise ValueError("public audio metadata unavailable")
        return payload["data"]

    def download(self, url: str, directory: Path) -> Path:
        if not validate_video_url(url):
            raise ValueError("invalid public Bilibili video URL")
        parsed = urlsplit(url)
        video_id = parsed.path.strip("/").split("/")[-1]
        params = {"bvid": video_id} if video_id.startswith("BV") else {"aid": video_id[2:]}
        view = self._get_json("/x/web-interface/view", params)
        part = int(parse_qs(parsed.query).get("p", ["1"])[0])
        if part > 1:
            cid = next(
                (page["cid"] for page in view.get("pages", []) if page.get("page") == part), None
            )
        else:
            cid = view.get("cid")
        if cid is None:
            raise ValueError("video part unavailable")
        play = self._get_json("/x/player/playurl", {**params, "cid": cid, "fnval": 16})
        tracks = play.get("dash", {}).get("audio") or []
        tracks = [track for track in tracks if track.get("mimeType") == "audio/mp4"]
        if not tracks:
            raise ValueError("public audio-only track unavailable")
        track = min(tracks, key=lambda item: item.get("bandwidth", 0))
        audio_url = track.get("baseUrl") or track.get("base_url")
        audio = urlsplit(audio_url or "")
        if (
            audio.scheme != "https"
            or audio.username
            or audio.password
            or audio.port not in {None, 443}
            or not audio.hostname
            or not any(
                audio.hostname.endswith("." + domain)
                for domain in ("bilivideo.com", "bilivideo.cn")
            )
        ):
            raise ValueError("unsupported audio CDN URL")
        target = directory / "audio.m4a"
        try:
            with self._client() as client, client.stream("GET", audio_url) as response:
                response.raise_for_status()
                if response.headers.get("content-type", "").split(";")[0] not in {
                    "audio/mp4",
                    "audio/x-m4a",
                    "application/octet-stream",
                }:
                    raise ValueError("unexpected audio media type")
                total = 0
                with target.open("wb") as output:
                    for chunk in response.iter_bytes():
                        total += len(chunk)
                        if total > self._max_bytes:
                            raise ValueError("audio exceeds size limit")
                        output.write(chunk)
                if total == 0:
                    raise ValueError("empty audio")
            return target
        except Exception:
            target.unlink(missing_ok=True)
            raise
