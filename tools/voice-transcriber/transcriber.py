"""Local voice transcription core module for Laundry.

Runs fully locally using faster-whisper on CPU with small/int8 quantization.
Enforces file format, size, duration, and symlink safety limits.
"""

from __future__ import annotations

import logging
import os
import shutil
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol

logger = logging.getLogger("laundry.transcriber")

# Sane limits
MAX_AUDIO_SIZE_BYTES = 10 * 1024 * 1024  # 10 MB
MAX_AUDIO_DURATION_SEC = 120.0  # 120 seconds
PROBE_TIMEOUT_SEC = 15.0  # 15 seconds ffprobe timeout
ALLOWED_EXTENSIONS = {".wav", ".ogg", ".oga", ".opus", ".m4a"}

SENSITIVE_PATH_PREFIXES = (
    "/etc",
    "/proc",
    "/sys",
    "/dev",
    "/root",
    "/boot",
    "/var/run",
)


class AudioValidationError(Exception):
    """Raised when an audio file fails safety, format, size, or duration checks."""

    def __init__(self, message: str, code: str):
        super().__init__(message)
        self.message = message
        self.code = code

    def to_dict(self) -> dict[str, Any]:
        return {
            "error": self.message,
            "code": self.code,
            "text": "",
            "language": None,
            "uncertainSpans": [],
        }


class DependencyMissingError(Exception):
    """Raised when faster-whisper or required dependencies are not installed."""

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message
        self.code = "DEPENDENCY_MISSING"

    def to_dict(self) -> dict[str, Any]:
        return {
            "error": self.message,
            "code": self.code,
            "text": "",
            "language": None,
            "uncertainSpans": [],
        }


@dataclass
class TranscriptionResult:
    """Transcription outcome compatible with Laundry contracts."""

    text: str
    language: str
    uncertain_spans: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "text": self.text,
            "language": self.language,
            "uncertainSpans": self.uncertain_spans,
        }


class TranscriberProtocol(Protocol):
    """Protocol for pluggable and testable speech transcribers."""

    def transcribe(self, audio_path: Path, language: str | None = None) -> TranscriptionResult:
        ...


class AudioValidator:
    """Validates audio files for format, size, duration, and path safety."""

    def __init__(
        self,
        max_size_bytes: int = MAX_AUDIO_SIZE_BYTES,
        max_duration_sec: float = MAX_AUDIO_DURATION_SEC,
        allowed_extensions: set[str] | None = None,
        probe_timeout_sec: float = PROBE_TIMEOUT_SEC,
    ):
        self.max_size_bytes = max_size_bytes
        self.max_duration_sec = max_duration_sec
        self.allowed_extensions = allowed_extensions or ALLOWED_EXTENSIONS
        self.probe_timeout_sec = probe_timeout_sec

    def validate_path_safety(self, raw_path: Path | str) -> Path:
        """Enforces path safety and rejects unsafe or sensitive symlinks."""
        path = Path(raw_path)

        # Check for symlink before resolving
        if path.is_symlink():
            try:
                target = path.resolve(strict=True)
            except (FileNotFoundError, RuntimeError, OSError):
                raise AudioValidationError(
                    f"Unsafe symlink: Target of '{path.name}' cannot be resolved or does not exist",
                    code="UNSAFE_SYMLINK",
                )

            # Check if target is a regular file
            if not target.is_file():
                raise AudioValidationError(
                    f"Unsafe symlink: Target '{target}' is not a regular file",
                    code="UNSAFE_SYMLINK",
                )

            # Check if target points to sensitive system paths
            target_str = str(target)
            for sensitive_prefix in SENSITIVE_PATH_PREFIXES:
                if target_str == sensitive_prefix or target_str.startswith(sensitive_prefix + "/"):
                    raise AudioValidationError(
                        f"Unsafe symlink: Symlink points to restricted system location '{target_str}'",
                        code="UNSAFE_SYMLINK",
                    )
            resolved_path = target
        else:
            if not path.exists():
                raise AudioValidationError(
                    f"Audio file '{path}' does not exist",
                    code="FILE_NOT_FOUND",
                )
            if not path.is_file():
                raise AudioValidationError(
                    f"Path '{path}' is not a regular file",
                    code="INVALID_PATH",
                )
            resolved_path = path

        return resolved_path

    def validate_extension(self, path: Path) -> None:
        ext = path.suffix.lower()
        if ext not in self.allowed_extensions:
            allowed_list = ", ".join(sorted(self.allowed_extensions))
            raise AudioValidationError(
                f"Unsupported audio format '{ext}'. Allowed extensions: {allowed_list}",
                code="UNSUPPORTED_FORMAT",
            )

    def validate_size(self, path: Path) -> None:
        try:
            size_bytes = path.stat().st_size
        except OSError as e:
            raise AudioValidationError(f"Cannot inspect file size: {e}", code="FILE_ACCESS_ERROR")

        if size_bytes == 0:
            raise AudioValidationError("Audio file is empty (0 bytes)", code="EMPTY_FILE")

        if size_bytes > self.max_size_bytes:
            max_mb = self.max_size_bytes / (1024 * 1024)
            actual_mb = size_bytes / (1024 * 1024)
            raise AudioValidationError(
                f"File size {actual_mb:.2f}MB exceeds the maximum allowed limit of {max_mb:.0f}MB",
                code="FILE_TOO_LARGE",
            )

    def probe_duration(self, path: Path) -> float:
        """Extracts audio duration in seconds via ffprobe with sane timeout."""
        ffprobe_bin = shutil.which("ffprobe")
        if not ffprobe_bin:
            raise AudioValidationError(
                "ffprobe executable not found on system PATH. Install ffmpeg to inspect audio.",
                code="FFPROBE_MISSING",
            )

        cmd = [
            ffprobe_bin,
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(path),
        ]

        try:
            proc = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=self.probe_timeout_sec,
                check=False,
            )
        except subprocess.TimeoutExpired:
            raise AudioValidationError(
                f"ffprobe timed out after {self.probe_timeout_sec}s inspecting audio",
                code="PROBE_TIMEOUT",
            )
        except OSError as e:
            raise AudioValidationError(f"Failed to execute ffprobe: {e}", code="PROBE_EXEC_ERROR")

        if proc.returncode != 0:
            logger.debug("ffprobe error on file %s: %s", path.name, proc.stderr.strip())
            raise AudioValidationError(
                f"Malformed audio file or unreadable audio format: {proc.stderr.strip() or 'Unknown error'}",
                code="MALFORMED_AUDIO",
            )

        duration_raw = proc.stdout.strip()
        try:
            duration = float(duration_raw)
        except ValueError:
            raise AudioValidationError(
                f"Malformed audio duration output '{duration_raw}' from ffprobe",
                code="MALFORMED_AUDIO",
            )

        if duration <= 0:
            raise AudioValidationError(
                f"Invalid audio duration {duration}s",
                code="MALFORMED_AUDIO",
            )

        return duration

    def validate(self, path: Path | str) -> Path:
        """Runs the complete suite of validations and returns the safe Path."""
        safe_path = self.validate_path_safety(path)
        self.validate_extension(safe_path)
        self.validate_size(safe_path)
        duration = self.probe_duration(safe_path)

        if duration > self.max_duration_sec:
            raise AudioValidationError(
                f"Audio duration {duration:.2f}s exceeds maximum limit of {self.max_duration_sec:.0f}s",
                code="DURATION_EXCEEDED",
            )

        return safe_path


class FasterWhisperTranscriber:
    """Lazy-loaded faster-whisper transcriber running on CPU with int8 quantization.

    Never logs raw audio content. Model weights are cached locally.
    """

    def __init__(
        self,
        model_name: str = "small",
        device: str = "cpu",
        compute_type: str = "int8",
        cache_dir: str | Path | None = None,
    ):
        self.model_name = model_name
        self.device = device
        self.compute_type = compute_type
        self.cache_dir = Path(
            cache_dir
            or os.environ.get("WHISPER_CACHE_DIR")
            or Path.home() / ".cache" / "laundry" / "whisper"
        )
        self._model: Any = None

    def load_model(self) -> Any:
        """Lazily imports faster_whisper and initializes WhisperModel."""
        if self._model is not None:
            return self._model

        try:
            import faster_whisper
        except (ImportError, ModuleNotFoundError) as err:
            raise DependencyMissingError(
                "faster-whisper is not installed. To use local voice transcription, install dependencies via:\n"
                "  pip install -r tools/voice-transcriber/requirements.txt\n"
                f"Details: {err}"
            ) from err

        self.cache_dir.mkdir(parents=True, exist_ok=True)
        logger.info(
            "Loading local whisper model '%s' (device=%s, compute_type=%s, cache=%s)",
            self.model_name,
            self.device,
            self.compute_type,
            self.cache_dir,
        )

        self._model = faster_whisper.WhisperModel(
            self.model_name,
            device=self.device,
            compute_type=self.compute_type,
            download_root=str(self.cache_dir),
        )
        return self._model

    def transcribe(self, audio_path: Path, language: str | None = None) -> TranscriptionResult:
        """Transcribes validated audio and flags low-confidence spans."""
        model = self.load_model()

        kwargs: dict[str, Any] = {
            "beam_size": 5,
            "word_timestamps": True,
        }
        if language:
            kwargs["language"] = language

        # Ensure safe path string passed to faster-whisper without shell interpolation
        segments_gen, info = model.transcribe(str(audio_path), **kwargs)

        text_segments: list[str] = []
        uncertain_spans: list[str] = []

        for segment in segments_gen:
            segment_text = segment.text.strip()
            if segment_text:
                text_segments.append(segment_text)

            # Detect uncertain spans based on segment logprob or word probability
            is_segment_uncertain = (
                getattr(segment, "avg_logprob", 0.0) < -1.0
                or getattr(segment, "no_speech_prob", 0.0) > 0.6
            )
            if is_segment_uncertain and segment_text:
                uncertain_spans.append(segment_text)
            elif hasattr(segment, "words") and segment.words:
                for word in segment.words:
                    word_prob = getattr(word, "probability", 1.0)
                    if word_prob < 0.5:
                        w_clean = word.word.strip()
                        if w_clean and w_clean not in uncertain_spans:
                            uncertain_spans.append(w_clean)

        full_text = " ".join(text_segments).strip()
        detected_language = info.language if hasattr(info, "language") else (language or "unknown")

        return TranscriptionResult(
            text=full_text,
            language=detected_language,
            uncertain_spans=uncertain_spans,
        )


def transcribe_file(
    audio_path: Path | str,
    transcriber: TranscriberProtocol | None = None,
    language: str | None = None,
    validator: AudioValidator | None = None,
) -> TranscriptionResult:
    """Validates and transcribes an audio file.

    Caller retains complete responsibility for deleting the audio file afterwards.
    Raw audio bytes are never logged.
    """
    if validator is None:
        validator = AudioValidator()

    # Enforce safe path, size, format, duration
    validated_path = validator.validate(audio_path)

    logger.info("Validated audio file: %s", validated_path.name)

    if transcriber is None:
        transcriber = FasterWhisperTranscriber()

    # Perform transcription
    result = transcriber.transcribe(validated_path, language=language)
    logger.info("Transcription completed for: %s (detected_lang=%s)", validated_path.name, result.language)

    return result
