"""Unit tests for voice transcriber validation, pipeline, and fake transcriber injection."""

import io
import logging
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

# Add parent directory to sys.path so transcriber can be imported directly
CURRENT_DIR = Path(__file__).resolve().parent
PACKAGE_DIR = CURRENT_DIR.parent
if str(PACKAGE_DIR) not in sys.path:
    sys.path.insert(0, str(PACKAGE_DIR))

from transcriber import (
    AudioValidationError,
    AudioValidator,
    DependencyMissingError,
    FasterWhisperTranscriber,
    TranscriptionResult,
    transcribe_file,
)


class FakeTranscriber:
    """Injectable fake transcriber for test isolation without downloading models."""

    def __init__(
        self,
        text: str = "Order 2 shirts washed and ironed",
        language: str = "en",
        uncertain_spans: list[str] | None = None,
    ):
        self.text = text
        self.language = language
        self.uncertain_spans = uncertain_spans or ["ironed"]
        self.invocations: list[dict] = []

    def transcribe(self, audio_path: Path, language: str | None = None) -> TranscriptionResult:
        self.invocations.append({"audio_path": audio_path, "language": language})
        return TranscriptionResult(
            text=self.text,
            language=self.language,
            uncertain_spans=self.uncertain_spans,
        )


class TestVoiceTranscriberValidation(unittest.TestCase):
    def setUp(self):
        self.test_dir = tempfile.mkdtemp(prefix="transcriber_test_")
        self.test_path = Path(self.test_dir)

    def tearDown(self):
        shutil.rmtree(self.test_dir, ignore_errors=True)

    def create_dummy_audio(self, filename: str, duration_sec: float = 1.0) -> Path:
        """Helper to create a tiny valid wav file using ffmpeg."""
        file_path = self.test_path / filename
        cmd = [
            "ffmpeg",
            "-y",
            "-f",
            "lavfi",
            "-i",
            f"sine=frequency=440:duration={duration_sec}",
            "-f",
            "wav",
            str(file_path),
        ]
        subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
        return file_path

    def test_missing_file_raises_validation_error(self):
        missing_path = self.test_path / "non_existent.wav"
        validator = AudioValidator()
        with self.assertRaises(AudioValidationError) as ctx:
            validator.validate(missing_path)
        self.assertEqual(ctx.exception.code, "FILE_NOT_FOUND")

    def test_over_limit_size_raises_validation_error(self):
        large_path = self.test_path / "oversized.wav"
        # Create a file slightly over 10 MB limit
        with open(large_path, "wb") as f:
            f.seek(10 * 1024 * 1024 + 1024)
            f.write(b"0")

        validator = AudioValidator(max_size_bytes=10 * 1024 * 1024)
        with self.assertRaises(AudioValidationError) as ctx:
            validator.validate(large_path)
        self.assertEqual(ctx.exception.code, "FILE_TOO_LARGE")

    def test_empty_file_raises_validation_error(self):
        empty_path = self.test_path / "empty.wav"
        empty_path.touch()

        validator = AudioValidator()
        with self.assertRaises(AudioValidationError) as ctx:
            validator.validate(empty_path)
        self.assertEqual(ctx.exception.code, "EMPTY_FILE")

    def test_unsupported_format_raises_validation_error(self):
        unsupported = self.test_path / "sample.mp3"
        unsupported.write_text("dummy")

        validator = AudioValidator()
        with self.assertRaises(AudioValidationError) as ctx:
            validator.validate(unsupported)
        self.assertEqual(ctx.exception.code, "UNSUPPORTED_FORMAT")

    def test_over_limit_duration_raises_validation_error(self):
        valid_wav = self.create_dummy_audio("long.wav", duration_sec=1.0)
        # Mock probe_duration to simulate audio longer than 120 seconds
        validator = AudioValidator(max_duration_sec=120.0)
        with patch.object(validator, "probe_duration", return_value=125.5):
            with self.assertRaises(AudioValidationError) as ctx:
                validator.validate(valid_wav)
            self.assertEqual(ctx.exception.code, "DURATION_EXCEEDED")

    def test_malformed_duration_raises_validation_error(self):
        corrupt_wav = self.test_path / "corrupted.wav"
        # Write random non-audio data
        corrupt_wav.write_bytes(b"RIFF\x00\x00\x00\x00WAVEfmt invalid audio data")

        validator = AudioValidator()
        with self.assertRaises(AudioValidationError) as ctx:
            validator.validate(corrupt_wav)
        self.assertEqual(ctx.exception.code, "MALFORMED_AUDIO")

    def test_reject_unsafe_symlink_broken(self):
        dangling_symlink = self.test_path / "broken_link.wav"
        os.symlink(self.test_path / "does_not_exist.wav", dangling_symlink)

        validator = AudioValidator()
        with self.assertRaises(AudioValidationError) as ctx:
            validator.validate(dangling_symlink)
        self.assertIn(ctx.exception.code, ["UNSAFE_SYMLINK", "FILE_NOT_FOUND"])

    def test_reject_unsafe_symlink_sensitive_system_path(self):
        sensitive_symlink = self.test_path / "system_link.wav"
        # Point to /etc/hosts (a sensitive system file)
        os.symlink("/etc/hosts", sensitive_symlink)

        validator = AudioValidator()
        with self.assertRaises(AudioValidationError) as ctx:
            validator.validate(sensitive_symlink)
        self.assertEqual(ctx.exception.code, "UNSAFE_SYMLINK")

    def test_reject_unsafe_symlink_non_regular_file(self):
        dev_symlink = self.test_path / "dev_link.wav"
        if os.path.exists("/dev/null"):
            os.symlink("/dev/null", dev_symlink)
            validator = AudioValidator()
            with self.assertRaises(AudioValidationError) as ctx:
                validator.validate(dev_symlink)
            self.assertEqual(ctx.exception.code, "UNSAFE_SYMLINK")


class TestVoiceTranscriberExecution(unittest.TestCase):
    def setUp(self):
        self.test_dir = tempfile.mkdtemp(prefix="transcriber_exec_test_")
        self.test_path = Path(self.test_dir)

    def tearDown(self):
        shutil.rmtree(self.test_dir, ignore_errors=True)

    def create_dummy_audio(self, filename: str) -> Path:
        file_path = self.test_path / filename
        cmd = [
            "ffmpeg",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=0.5",
            "-f",
            "wav",
            str(file_path),
        ]
        subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
        return file_path

    def test_injectable_fake_transcriber_success(self):
        audio_file = self.create_dummy_audio("audio.wav")
        fake = FakeTranscriber(
            text="Pick up laundry at 10am",
            language="en",
            uncertain_spans=["10am"],
        )

        result = transcribe_file(audio_file, transcriber=fake, language="en")

        self.assertIsInstance(result, TranscriptionResult)
        self.assertEqual(result.text, "Pick up laundry at 10am")
        self.assertEqual(result.language, "en")
        self.assertEqual(result.uncertain_spans, ["10am"])

        payload = result.to_dict()
        self.assertEqual(payload["text"], "Pick up laundry at 10am")
        self.assertEqual(payload["language"], "en")
        self.assertEqual(payload["uncertainSpans"], ["10am"])
        self.assertEqual(len(fake.invocations), 1)

    def test_caller_owns_deletion_retention(self):
        """Audio file must not be deleted by transcriber; deletion is caller's responsibility."""
        audio_file = self.create_dummy_audio("persistent.wav")
        fake = FakeTranscriber()

        transcribe_file(audio_file, transcriber=fake)

        self.assertTrue(audio_file.exists(), "Input audio file must remain intact after transcription")

    def test_safe_path_handling_with_spaces_and_special_characters(self):
        file_name = "audio with spaces and (special) [chars] #1.wav"
        audio_file = self.create_dummy_audio(file_name)
        fake = FakeTranscriber(text="Handled safely")

        result = transcribe_file(audio_file, transcriber=fake)
        self.assertEqual(result.text, "Handled safely")

    def test_lazy_import_faster_whisper_honest_error(self):
        """When faster-whisper is not installed, FasterWhisperTranscriber must give honest setup message."""
        transcriber = FasterWhisperTranscriber()
        with patch.dict(sys.modules, {"faster_whisper": None}):
            with self.assertRaises(DependencyMissingError) as ctx:
                transcriber.load_model()
            err_msg = str(ctx.exception)
            self.assertIn("faster-whisper is not installed", err_msg)
            self.assertIn("requirements.txt", err_msg)

    def test_never_logs_raw_audio(self):
        """Log records should never contain raw binary audio data."""
        audio_file = self.create_dummy_audio("private.wav")
        fake = FakeTranscriber()

        log_stream = io.StringIO()
        handler = logging.StreamHandler(log_stream)
        logger = logging.getLogger("wandary.transcriber")
        logger.addHandler(handler)
        logger.setLevel(logging.DEBUG)

        try:
            transcribe_file(audio_file, transcriber=fake)
            log_output = log_stream.getvalue()
            # Assert raw audio header or bytes are not in logs
            self.assertNotIn("RIFF", log_output)
            self.assertNotIn("WAVE", log_output)
        finally:
            logger.removeHandler(handler)


if __name__ == "__main__":
    unittest.main()
