"""Integration and CLI tests for tools/voice-transcriber/cli.py and whisper_wrapper.sh."""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

CURRENT_DIR = Path(__file__).resolve().parent
PACKAGE_DIR = CURRENT_DIR.parent
CLI_SCRIPT = PACKAGE_DIR / "cli.py"
WRAPPER_SCRIPT = PACKAGE_DIR / "whisper_wrapper.sh"


class TestVoiceTranscriberCLI(unittest.TestCase):
    def setUp(self):
        self.test_dir = tempfile.mkdtemp(prefix="cli_test_")
        self.test_path = Path(self.test_dir)

    def tearDown(self):
        shutil.rmtree(self.test_dir, ignore_errors=True)

    def create_dummy_audio(self, filename: str, duration_sec: float = 0.5) -> Path:
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

    def run_cli(self, args: list[str]) -> subprocess.CompletedProcess[str]:
        cmd = [sys.executable, str(CLI_SCRIPT)] + args
        return subprocess.run(cmd, capture_output=True, text=True, check=False)

    def run_wrapper(self, args: list[str]) -> subprocess.CompletedProcess[str]:
        cmd = [str(WRAPPER_SCRIPT)] + args
        return subprocess.run(cmd, capture_output=True, text=True, check=False)

    def test_no_arguments_returns_json_error_and_nonzero_exit(self):
        res = self.run_cli([])
        self.assertNotEqual(res.returncode, 0)
        data = json.loads(res.stdout)
        self.assertEqual(data["code"], "INVALID_ARGUMENTS")
        self.assertIn("error", data)
        self.assertEqual(data["text"], "")

    def test_missing_file_returns_json_error_and_nonzero_exit(self):
        missing = self.test_path / "missing.wav"
        res = self.run_cli([str(missing)])
        self.assertNotEqual(res.returncode, 0)
        data = json.loads(res.stdout)
        self.assertEqual(data["code"], "FILE_NOT_FOUND")
        self.assertIn("does not exist", data["error"])

    def test_input_file_flag_compatibility(self):
        missing = self.test_path / "missing.wav"
        res = self.run_cli(["--input-file", str(missing)])
        self.assertNotEqual(res.returncode, 0)
        data = json.loads(res.stdout)
        self.assertEqual(data["code"], "FILE_NOT_FOUND")

    def test_oversized_file_returns_json_error(self):
        large_wav = self.test_path / "huge.wav"
        with open(large_wav, "wb") as f:
            f.seek(10 * 1024 * 1024 + 1024)
            f.write(b"0")

        res = self.run_cli([str(large_wav)])
        self.assertNotEqual(res.returncode, 0)
        data = json.loads(res.stdout)
        self.assertEqual(data["code"], "FILE_TOO_LARGE")

    def test_malformed_audio_returns_json_error(self):
        malformed = self.test_path / "broken.wav"
        malformed.write_bytes(b"not a valid wav")

        res = self.run_cli([str(malformed)])
        self.assertNotEqual(res.returncode, 0)
        data = json.loads(res.stdout)
        self.assertEqual(data["code"], "MALFORMED_AUDIO")

    def test_unsafe_symlink_returns_json_error(self):
        link = self.test_path / "unsafe.wav"
        os.symlink("/etc/hosts", link)

        res = self.run_cli([str(link)])
        self.assertNotEqual(res.returncode, 0)
        data = json.loads(res.stdout)
        self.assertEqual(data["code"], "UNSAFE_SYMLINK")

    def test_missing_dependency_honest_message_and_nonzero_exit(self):
        """When faster-whisper is missing, returns honest setup message; when present, succeeds."""
        audio = self.create_dummy_audio("sample.wav")
        res = self.run_cli([str(audio)])

        try:
            import importlib.util

            has_fw = importlib.util.find_spec("faster_whisper") is not None
        except Exception:
            has_fw = False

        if not has_fw:
            # If faster-whisper is not installed, it must return DEPENDENCY_MISSING and exit code 2
            self.assertNotEqual(res.returncode, 0)
            data = json.loads(res.stdout)
            self.assertEqual(data["code"], "DEPENDENCY_MISSING")
            self.assertIn("faster-whisper is not installed", data["error"])
            self.assertIn("pip install -r tools/voice-transcriber/requirements.txt", data["error"])
            self.assertEqual(data["text"], "")
        else:
            # Dependency present: CLI must succeed with valid contract JSON.
            self.assertEqual(res.returncode, 0, msg=f"stdout={res.stdout} stderr={res.stderr}")
            data = json.loads(res.stdout)
            self.assertIn("text", data)
            self.assertIn("language", data)
            self.assertIn("uncertainSpans", data)

    def test_shell_wrapper_execution_positional_and_flag(self):
        """Verify shell wrapper script executes with both argument styles."""
        missing = self.test_path / "wrapper_missing.wav"

        # Positional
        res_pos = self.run_wrapper([str(missing)])
        self.assertNotEqual(res_pos.returncode, 0)
        data_pos = json.loads(res_pos.stdout)
        self.assertEqual(data_pos["code"], "FILE_NOT_FOUND")

        # Flag --input-file
        res_flag = self.run_wrapper(["--input-file", str(missing)])
        self.assertNotEqual(res_flag.returncode, 0)
        data_flag = json.loads(res_flag.stdout)
    def test_cli_success_with_mocked_transcription(self):
        """Verify CLI produces valid JSON {text, language, uncertainSpans} and returns 0."""
        from unittest.mock import patch
        import io
        from cli import main
        from transcriber import TranscriptionResult

        audio = self.create_dummy_audio("valid.wav")
        fake_result = TranscriptionResult(
            text="Please deliver to 42 Wallaby Way",
            language="en",
            uncertain_spans=["Wallaby"],
        )

        stdout_buf = io.StringIO()
        with patch("sys.stdout", stdout_buf), patch("cli.transcribe_file", return_value=fake_result):
            ret = main(["--input-file", str(audio), "--language", "en"])
            self.assertEqual(ret, 0)

        output_json = json.loads(stdout_buf.getvalue())
        self.assertEqual(output_json["text"], "Please deliver to 42 Wallaby Way")
        self.assertEqual(output_json["language"], "en")
        self.assertEqual(output_json["uncertainSpans"], ["Wallaby"])


if __name__ == "__main__":
    unittest.main()
