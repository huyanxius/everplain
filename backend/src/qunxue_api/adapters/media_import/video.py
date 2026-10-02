"""Subtitle-first text extraction; audio acquisition and ASR require explicit injection."""

from __future__ import annotations

import html
import json
import re
import subprocess
from collections.abc import Callable
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any, Protocol
from urllib.parse import parse_qs, urlsplit

from .types import ImportError, ImportItem, ImportResult


class SubtitleProvider(Protocol):
    def fetch(self, url: str, directory: Path) -> dict[str, Any]: ...


class TemporaryAudioProvider(Protocol):
    """Download audio only inside directory; never fetch video or use login cookies."""

    def download(self, url: str, directory: Path) -> Path: ...


class TranscriptionProvider(Protocol):
    @property
    def available(self) -> bool: ...

    def transcribe(self, *, filename: str, media_type: str, content: bytes) -> Any: ...


class YtDlpSubtitleProvider:
    def __init__(
        self,
        *,
        executable: str = "yt-dlp",
        runner: Callable = subprocess.run,
        timeout_seconds: float = 120,
    ) -> None:
        if timeout_seconds <= 0:
            raise ValueError("positive timeout required")
        self._executable = executable
        self._runner = runner
        self._timeout = timeout_seconds

    def fetch(self, url: str, directory: Path) -> dict[str, Any]:
        command = [
            self._executable,
            "--ignore-config",
            "--no-cookies",
            "--no-cookies-from-browser",
            "--no-plugin-dirs",
            "--no-cache-dir",
            "--no-playlist",
            "--no-simulate",
            "--skip-download",
            "--write-subs",
            "--write-auto-subs",
            "--sub-langs",
            "zh.*,en.*",
            "--sub-format",
            "vtt/srt/json",
            "--dump-json",
            "--no-progress",
            "--no-warnings",
            "--output",
            str(directory / "media.%(ext)s"),
            "--",
            url,
        ]
        result = self._runner(
            command, check=True, capture_output=True, text=True, timeout=self._timeout
        )
        raw = json.loads(result.stdout)
        if not isinstance(raw, dict) or raw.get("_type") in {"playlist", "multi_video"}:
            raise ValueError("expected one video; select an explicit part URL")
        output = {key: raw[key] for key in ("id", "title", "duration", "description") if key in raw}
        files = sorted(
            directory.iterdir(), key=lambda p: (".zh" not in p.name, p.suffix != ".vtt", p.name)
        )
        for path in files:
            if path.suffix.lower() not in {".vtt", ".srt", ".json"}:
                continue
            if path.stat().st_size > 5_000_000:
                raise ValueError("subtitle exceeds size limit")
            text = _subtitle_text(path)
            if text:
                output["subtitle"] = text
                output["language"] = path.name.removeprefix("media.").rsplit(".", 1)[0]
                break
        return output


class VideoImportAdapter:
    def __init__(
        self,
        *,
        subtitles: SubtitleProvider | None = None,
        audio: TemporaryAudioProvider | None = None,
        transcription: TranscriptionProvider | None = None,
        max_audio_bytes: int = 25_000_000,
    ) -> None:
        if max_audio_bytes < 1:
            raise ValueError("positive audio limit required")
        self._subtitles = subtitles or YtDlpSubtitleProvider()
        self._audio = audio
        self._transcription = transcription
        self._max_audio_bytes = max_audio_bytes

    def import_video(self, url: str) -> ImportResult:
        if not validate_video_url(url):
            return _error(url, "invalid_video_url", "An HTTPS Bilibili video URL is required.")
        parsed = urlsplit(url)
        try:
            with TemporaryDirectory(prefix="everplain-media-") as temporary:
                directory = Path(temporary)
                data = self._subtitles.fetch(url, directory)
                text = str(data.get("subtitle") or "").strip()
                source = "subtitles"
                if not text:
                    if self._transcription is None or not self._transcription.available:
                        return _error(
                            url,
                            "transcription_not_configured",
                            "No subtitles; a dedicated transcription provider is not configured.",
                        )
                    if self._audio is None:
                        return _error(
                            url,
                            "audio_not_configured",
                            "No subtitles; a temporary audio provider is not configured.",
                        )
                    path = self._audio.download(url, directory).resolve()
                    if (
                        not path.is_relative_to(directory.resolve())
                        or not path.is_file()
                        or path.suffix.lower()
                        not in {".mp3", ".m4a", ".wav", ".ogg", ".flac", ".aac"}
                        or path.stat().st_size > self._max_audio_bytes
                    ):
                        raise ValueError("invalid temporary audio")
                    mime = {
                        ".mp3": "audio/mpeg",
                        ".m4a": "audio/mp4",
                        ".wav": "audio/wav",
                        ".ogg": "audio/ogg",
                        ".flac": "audio/flac",
                        ".aac": "audio/aac",
                    }[path.suffix.lower()]
                    transcript = self._transcription.transcribe(
                        filename=path.name, media_type=mime, content=path.read_bytes()
                    )
                    text = "\n".join(segment.text for segment in transcript.segments).strip()
                    source = "transcription"
                if not text:
                    return _error(
                        url, "empty_transcript", "No usable transcript text was returned."
                    )
                video_id = parsed.path.strip("/").split("/")[-1]
                part = parse_qs(parsed.query).get("p", ["1"])[0]
                if part != "1":
                    video_id += "-p" + part
                title = str(data.get("title") or video_id)
                return ImportResult(
                    item=ImportItem(
                        source_key=f"bilibili:{video_id}",
                        title=title,
                        filename=f"{video_id}.txt",
                        content=text.encode("utf-8"),
                        source_url=url,
                        relative_path=f"bilibili/{video_id}.txt",
                        metadata={
                            **{
                                k: data[k]
                                for k in ("duration", "description", "language")
                                if k in data
                            },
                            "text_source": source,
                        },
                    )
                )
        except FileNotFoundError:
            return _error(url, "yt_dlp_not_configured", "The yt-dlp executable is not installed.")
        except Exception:
            # Never expose subprocess stderr, signed media URLs, or provider secrets.
            return _error(
                url, "video_import_failed", "Subtitle or temporary audio processing failed."
            )


def _error(key: str, code: str, message: str) -> ImportResult:
    return ImportResult(error=ImportError(key, code, message))


def _subtitle_text(path: Path) -> str:
    text = path.read_text(encoding="utf-8-sig")
    if path.suffix == ".json":
        payload = json.loads(text)
        return "\n".join(
            str(line["content"])
            for line in payload.get("body", [])
            if isinstance(line, dict) and line.get("content")
        )
    lines: list[str] = []
    for block in re.split(r"\n\s*\n", text.replace("\r\n", "\n")):
        block_lines = block.splitlines()
        time_index = next((i for i, line in enumerate(block_lines) if "-->" in line), None)
        if time_index is None:
            continue
        caption = "\n".join(block_lines[time_index + 1 :])
        caption = html.unescape(re.sub(r"<[^>]*>", "", caption)).strip()
        if caption and (not lines or lines[-1] != caption):
            lines.append(caption)
    return "\n".join(lines)


def validate_video_url(url: str) -> bool:
    try:
        parsed = urlsplit(url)
        query = parse_qs(parsed.query, keep_blank_values=True)
        return (
            parsed.scheme == "https"
            and parsed.hostname in {"www.bilibili.com", "bilibili.com"}
            and not parsed.username
            and not parsed.password
            and parsed.port in {None, 443}
            and bool(re.fullmatch(r"/video/(BV[0-9A-Za-z]{10}|av[1-9][0-9]*)/?", parsed.path))
            and set(query) <= {"p"}
            and (
                not query
                or (len(query["p"]) == 1 and bool(re.fullmatch(r"[1-9][0-9]*", query["p"][0])))
            )
        )
    except (ValueError, TypeError):
        return False
