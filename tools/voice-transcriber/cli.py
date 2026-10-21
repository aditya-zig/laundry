#!/usr/bin/env python3
"""CLI entry point for Laundry Local Voice Transcriber.

Accepts audio files without shell interpolation and outputs JSON:
  {"text": str, "language": str, "uncertainSpans": list[str]}

On error, outputs structured JSON and exits with a nonzero status code.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

# Add current directory to path if running directly
CURRENT_DIR = Path(__file__).resolve().parent
if str(CURRENT_DIR) not in sys.path:
    sys.path.insert(0, str(CURRENT_DIR))

from transcriber import (
    AudioValidationError,
    AudioValidator,
    DependencyMissingError,
    FasterWhisperTranscriber,
    transcribe_file,
)

logger = logging.getLogger("laundry.cli")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Laundry Local Speech Transcriber (faster-whisper CPU int8)",
        allow_abbrev=False,
    )
    parser.add_argument(
        "audio_file",
        nargs="?",
        default=None,
        help="Path to audio file (WAV, OGG, M4A). Max 120s, max 10MB.",
    )
    parser.add_argument(
        "-i",
        "--input-file",
        dest="input_file",
        default=None,
        help="Alternative argument for input audio file path.",
    )
    parser.add_argument(
        "--model",
        default="small",
        help="Whisper model size or path (default: small).",
    )
    parser.add_argument(
        "--language",
        default=None,
        help="Optional language hint (e.g., 'en', 'es', 'hi'). Auto-detected if omitted.",
    )
    parser.add_argument(
        "--compute-type",
        default="int8",
        help="Quantization compute type (default: int8 for fast CPU inference).",
    )
    parser.add_argument(
        "--device",
        default="cpu",
        help="Compute device (default: cpu).",
    )
    parser.add_argument(
        "--cache-dir",
        default=None,
        help="Local cache directory for downloaded models (default: ~/.cache/laundry/whisper).",
    )
    parser.add_argument(
        "--max-duration",
        type=float,
        default=120.0,
        help="Maximum audio duration in seconds (default: 120.0).",
    )
    parser.add_argument(
        "--max-size-mb",
        type=float,
        default=10.0,
        help="Maximum audio file size in megabytes (default: 10.0).",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Enable verbose debug logging to stderr.",
    )
    return parser


def emit_json_error(message: str, code: str, exit_code: int = 1) -> None:
    payload = {
        "error": message,
        "code": code,
        "text": "",
        "language": None,
        "uncertainSpans": [],
    }
    sys.stdout.write(json.dumps(payload, indent=2) + "\n")
    sys.stdout.flush()
    sys.exit(exit_code)


def main(args_list: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(args_list)

    log_level = logging.DEBUG if args.verbose else logging.WARNING
    logging.basicConfig(level=log_level, format="%(asctime)s [%(levelname)s] %(message)s", stream=sys.stderr)

    target_path = args.input_file or args.audio_file
    if not target_path:
        emit_json_error(
            "No audio file specified. Provide positional audio path or --input-file.",
            code="INVALID_ARGUMENTS",
            exit_code=2,
        )

    # Convert to Path object
    audio_path = Path(target_path)

    # Initialize validator
    validator = AudioValidator(
        max_size_bytes=int(args.max_size_mb * 1024 * 1024),
        max_duration_sec=args.max_duration,
    )

    # Initialize transcriber
    transcriber = FasterWhisperTranscriber(
        model_name=args.model,
        device=args.device,
        compute_type=args.compute_type,
        cache_dir=args.cache_dir,
    )

    try:
        result = transcribe_file(
            audio_path=audio_path,
            transcriber=transcriber,
            language=args.language,
            validator=validator,
        )
    except AudioValidationError as e:
        emit_json_error(e.message, code=e.code, exit_code=1)
    except DependencyMissingError as e:
        emit_json_error(e.message, code=e.code, exit_code=2)
    except Exception as e:
        emit_json_error(f"Unexpected transcription failure: {e}", code="RUNTIME_ERROR", exit_code=1)

    # Emit JSON success to stdout
    sys.stdout.write(json.dumps(result.to_dict(), indent=2) + "\n")
    sys.stdout.flush()
    return 0


if __name__ == "__main__":
    sys.exit(main())
