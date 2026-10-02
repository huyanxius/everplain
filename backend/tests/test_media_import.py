import json
import subprocess
import unittest
from pathlib import Path
from types import SimpleNamespace

import httpx

from qunxue_api.adapters.media_import import (
    BilibiliFavoritesAdapter,
    BilibiliTemporaryAudioProvider,
    ImageImportAdapter,
    OpenAICompatibleVisionProvider,
    VideoImportAdapter,
    YtDlpSubtitleProvider,
)


class MediaImportTests(unittest.TestCase):
    def test_folders_pagination_private_invalid_and_duplicate(self):
        calls = []

        def request(path, params):
            calls.append((path, params))
            if "folder" in path:
                return {
                    "code": 0,
                    "data": {
                        "list": [
                            {"id": 10, "title": "公开", "attr": 0},
                            {"id": 11, "title": "私密", "attr": 1},
                        ]
                    },
                }
            media = {"id": 100, "bvid": "BV1234567890", "title": "视频", "type": 2, "attr": 0}
            if params["pn"] == 1:
                return {"code": 0, "data": {"medias": [media], "has_more": True}}
            return {
                "code": 0,
                "data": {
                    "medias": [
                        media,
                        {
                            "id": 101,
                            "title": "已失效",
                            "type": 2,
                            "attr": 9,
                        },
                    ],
                    "has_more": False,
                },
            }

        report = BilibiliFavoritesAdapter(request=request).enumerate_public_favorites("123")
        self.assertEqual(len(report.items), 1)
        self.assertEqual(
            report.items[0].content.decode(),
            "# 视频\n\nhttps://www.bilibili.com/video/BV1234567890\n",
        )
        self.assertCountEqual(
            [e.code for e in report.errors], ["private_folder", "unavailable_media"]
        )
        self.assertEqual([c[1]["pn"] for c in calls if "resource" in c[0]], [1, 2])
        self.assertIn("private", report.notices[0])

    def test_permission_failure_continues_other_folder(self):
        def request(path, params):
            if "folder" in path:
                return {"code": 0, "data": {"list": [{"id": 1}, {"id": 2}]}}
            if params["media_id"] == 1:
                return {"code": -403, "message": "denied"}
            return {"code": 0, "data": {"medias": [], "has_more": False}}

        report = BilibiliFavoritesAdapter(request=request).enumerate_public_favorites(12)
        self.assertEqual(report.errors[0].code, "private_or_inaccessible")
        self.assertEqual(len(report.folders), 2)

    def test_page_limit_reports_partial_result(self):
        def request(path, params):
            if "folder" in path:
                return {"code": 0, "data": {"list": [{"id": 1}]}}
            return {"code": 0, "data": {"medias": [], "has_more": True}}

        result = BilibiliFavoritesAdapter(request=request, max_pages=1).enumerate_public_favorites(
            12
        )
        self.assertEqual(result.errors[0].code, "pagination_limit")

    def test_cookie_not_sent_or_retained(self):
        requests = []

        def handle(request):
            requests.append(request)
            return httpx.Response(
                200,
                json={"code": 0, "data": {"list": []}},
                headers={"set-cookie": "SESSDATA=forbidden"},
            )

        adapter = BilibiliFavoritesAdapter(transport=httpx.MockTransport(handle))
        adapter.enumerate_public_favorites(12)
        adapter.enumerate_public_favorites(12)
        self.assertTrue(all("cookie" not in r.headers for r in requests))

    def test_subtitle_priority_and_utf8_contract(self):
        provider = SimpleNamespace(
            fetch=lambda url, directory: {
                "id": "BV1234567890",
                "title": "字幕视频",
                "subtitle": "字幕文字",
                "language": "zh",
            }
        )
        result = VideoImportAdapter(subtitles=provider).import_video(
            "https://www.bilibili.com/video/BV1234567890"
        )
        self.assertIsNone(result.error)
        self.assertEqual(result.item.content, "字幕文字".encode())
        self.assertEqual(result.item.metadata["text_source"], "subtitles")

    def test_unconfigured_transcription_never_downloads_audio(self):
        provider = SimpleNamespace(fetch=lambda url, directory: {"id": "id", "title": "title"})
        result = VideoImportAdapter(subtitles=provider).import_video(
            "https://www.bilibili.com/video/BV1234567890"
        )
        self.assertEqual(result.error.code, "transcription_not_configured")

    def test_temporary_audio_cleanup_on_success_and_failure(self):
        paths = []

        def download(url, directory):
            path = directory / "audio.mp3"
            path.write_bytes(b"fake audio")
            paths.append(path)
            return path

        class Transcriber:
            available = True

            def transcribe(self, **kwargs):
                self.content = kwargs["content"]
                return SimpleNamespace(segments=[SimpleNamespace(text="转写文字")])

        provider = SimpleNamespace(fetch=lambda url, directory: {"id": "id", "title": "title"})
        transcriber = Transcriber()
        adapter = VideoImportAdapter(
            subtitles=provider, audio=SimpleNamespace(download=download), transcription=transcriber
        )
        self.assertEqual(
            adapter.import_video("https://www.bilibili.com/video/BV1234567890").item.content,
            "转写文字".encode(),
        )
        self.assertEqual(transcriber.content, b"fake audio")
        self.assertFalse(paths[0].exists())
        transcriber.transcribe = lambda **kwargs: (_ for _ in ()).throw(RuntimeError("secret"))
        self.assertEqual(
            adapter.import_video("https://www.bilibili.com/video/BV1234567890").error.code,
            "video_import_failed",
        )
        self.assertFalse(paths[1].exists())

    def test_yt_dlp_only_subtitles_metadata_no_config_cookie_or_video(self):
        commands = []

        def run(command, **kwargs):
            commands.append(command)
            target = Path(command[command.index("--output") + 1]).parent
            (target / "media.zh.vtt").write_text("WEBVTT\n\n00:00:00.000 --> 00:00:01.000\n字幕\n")
            return subprocess.CompletedProcess(
                command, 0, json.dumps({"id": "id", "title": "title"}), ""
            )

        result = VideoImportAdapter(subtitles=YtDlpSubtitleProvider(runner=run)).import_video(
            "https://www.bilibili.com/video/BV1234567890"
        )
        self.assertEqual(result.item.content.decode(), "字幕")
        self.assertIn("--skip-download", commands[0])
        self.assertIn("--no-simulate", commands[0])
        self.assertIn("--no-plugin-dirs", commands[0])
        self.assertNotIn("--no-netrc", commands[0])
        self.assertIn("--ignore-config", commands[0])
        self.assertIn("--no-cookies", commands[0])
        self.assertNotIn("--cookies-from-browser", commands[0])

    def test_image_unconfigured_and_vision_content_parts(self):
        self.assertEqual(
            ImageImportAdapter()
            .import_image(filename="x.png", media_type="image/png", content=b"x")
            .error.code,
            "vision_not_configured",
        )
        requests = []

        def handle(request):
            requests.append(json.loads(request.content))
            return httpx.Response(
                200,
                json={
                    "choices": [
                        {
                            "message": {
                                "content": json.dumps(
                                    {"text": "图片文字", "description": "内容描述"}
                                )
                            }
                        }
                    ]
                },
            )

        provider = OpenAICompatibleVisionProvider(
            base_url="https://vision.example/v1",
            model="fixture",
            api_key="fixture-only",
            transport=httpx.MockTransport(handle),
        )
        result = ImageImportAdapter(provider=provider).import_image(
            filename="x.png", media_type="image/png", content=b"fake-png"
        )
        self.assertEqual(result.item.content.decode(), "图片文字\n\n内容描述")
        parts = requests[0]["messages"][1]["content"]
        self.assertEqual([p["type"] for p in parts], ["text", "image_url"])
        self.assertEqual(parts[1]["image_url"]["url"], "data:image/png;base64,ZmFrZS1wbmc=")

    def test_image_provider_failure_is_single_error(self):
        provider = OpenAICompatibleVisionProvider(
            base_url="https://vision.example/v1",
            model="fixture",
            transport=httpx.MockTransport(lambda r: httpx.Response(429)),
        )
        result = ImageImportAdapter(provider=provider).import_image(
            filename="x.png", media_type="image/png", content=b"x"
        )
        self.assertEqual(result.error.code, "image_import_failed")
        self.assertIsNone(result.item)

    def test_audio_download_uses_dash_audio_and_enforces_limit(self):
        requests = []

        def handle(request):
            requests.append(request)
            if request.url.path == "/x/web-interface/view":
                return httpx.Response(
                    200, json={"code": 0, "data": {"cid": 5, "pages": [{"page": 2, "cid": 6}]}}
                )
            if request.url.path == "/x/player/playurl":
                return httpx.Response(
                    200,
                    json={
                        "code": 0,
                        "data": {
                            "dash": {
                                "audio": [
                                    {
                                        "baseUrl": "https://fixture.bilivideo.com/audio",
                                        "mimeType": "audio/mp4",
                                        "bandwidth": 100,
                                    },
                                ]
                            }
                        },
                    },
                )
            return httpx.Response(200, content=b"audio", headers={"content-type": "audio/mp4"})

        from tempfile import TemporaryDirectory

        with TemporaryDirectory() as temporary:
            provider = BilibiliTemporaryAudioProvider(transport=httpx.MockTransport(handle))
            path = provider.download(
                "https://www.bilibili.com/video/BV1234567890?p=2", Path(temporary)
            )
            self.assertEqual(path.read_bytes(), b"audio")
            self.assertEqual(requests[1].url.params["cid"], "6")
            self.assertTrue(all("cookie" not in r.headers for r in requests))
            small = BilibiliTemporaryAudioProvider(
                transport=httpx.MockTransport(handle), max_audio_bytes=2
            )
            with self.assertRaises(ValueError):
                small.download("https://www.bilibili.com/video/BV1234567890", Path(temporary))
            self.assertFalse(path.exists())

    def test_malformed_port_is_single_error(self):
        self.assertEqual(
            VideoImportAdapter()
            .import_video("https://www.bilibili.com:bad/video/BV1234567890")
            .error.code,
            "invalid_video_url",
        )

    def test_rejects_non_bilibili_url_and_invalid_uid(self):
        self.assertEqual(
            VideoImportAdapter().import_video("http://127.0.0.1").error.code, "invalid_video_url"
        )
        self.assertEqual(
            BilibiliFavoritesAdapter().enumerate_public_favorites("../x").errors[0].code,
            "invalid_uid",
        )


if __name__ == "__main__":
    unittest.main()
