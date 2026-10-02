"""Public API for media adapters; root owns orchestration and persistence."""

from .audio import BilibiliTemporaryAudioProvider
from .bilibili import BilibiliFavoritesAdapter
from .image import ImageImportAdapter, OpenAICompatibleVisionProvider, VisionProvider
from .types import FavoritesReport, ImportError, ImportItem, ImportResult
from .video import (
    SubtitleProvider,
    TemporaryAudioProvider,
    TranscriptionProvider,
    VideoImportAdapter,
    YtDlpSubtitleProvider,
)

__all__ = [
    "BilibiliTemporaryAudioProvider",
    "BilibiliFavoritesAdapter",
    "FavoritesReport",
    "ImageImportAdapter",
    "ImportError",
    "ImportItem",
    "ImportResult",
    "OpenAICompatibleVisionProvider",
    "SubtitleProvider",
    "TemporaryAudioProvider",
    "TranscriptionProvider",
    "VideoImportAdapter",
    "VisionProvider",
    "YtDlpSubtitleProvider",
]
