# Wandary Local Voice Transcriber

Fully local speech-to-text tool for Wandary customer voice messages. Runs inference on CPU with `faster-whisper` using int8 quantization and the `small` model architecture. Zero paid APIs, zero cloud egress, and complete privacy preservation.

---

## Features

- **100% Free & Local**: Powered by `faster-whisper` running locally on CPU with `int8` quantization. Never calls external speech APIs or incurs third-party costs.
- **Contract Compatible**: Emits structured JSON matching Wandary's `SpeechPort` contract:
  ```json
  {
    "text": "Please wash and iron 2 dress shirts",
    "language": "en",
    "uncertainSpans": ["dress shirts"]
  }
  ```
- **Robust Guardrails**:
  - **Formats**: WAV, OGG/Opus, M4A/AAC via `ffprobe`/`ffmpeg`.
  - **Duration**: Max 120 seconds enforced via `ffprobe` (15s timeout).
  - **Size**: Max 10MB enforced before model loading.
  - **Symlink & Path Safety**: Rejects broken symlinks, non-regular files, and symlinks referencing sensitive system paths (`/etc`, `/proc`, `/sys`, etc.).
  - **Safe Argument Handling**: Safe CLI parameter passing without shell interpolation.
- **Privacy & Hygiene**:
  - Never logs raw audio bytes or payloads.
  - Media deletion responsibility remains with the caller.
- **Pluggable & Testable**: Includes a fake transcriber interface for unit testing without downloading multi-megabyte model checkpoints.

---

## Installation

### Prerequisites

- Python 3.10+
- `ffmpeg` and `ffprobe` installed on system path:
  ```bash
  # Debian / Ubuntu
  sudo apt-get install -y ffmpeg

  # Arch Linux
  sudo pacman -S ffmpeg

  # macOS
  brew install ffmpeg
  ```

### Install Python Dependencies

Create a dedicated virtual environment or install dependencies directly:

```bash
cd tools/voice-transcriber
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Pinned dependencies in `requirements.txt`:
```text
faster-whisper==1.2.1
ctranslate2==4.8.2
huggingface-hub==2.2.0
tokenizers==0.23.3
onnxruntime==1.31.0
av==14.2.0
tqdm==4.70.1
```

---

## Quick Start

### 1. CLI Usage

Transcribe an audio file using positional argument:
```bash
./cli.py /path/to/voice_message.ogg
```

Or using the `--input-file` argument:
```bash
./cli.py --input-file /path/to/voice_message.m4a --language en
```

### 2. Available Options

| Flag | Default | Description |
|------|---------|-------------|
| `<audio_file>` | (positional) | Path to audio file (WAV, OGG, M4A) |
| `-i, --input-file` | `None` | Alternative flag for input file path |
| `--model` | `small` | Whisper model size or local directory |
| `--language` | `None` (auto) | Language code hint (`en`, `es`, `hi`, etc.) |
| `--compute-type` | `int8` | Quantization type (`int8`, `float32`) |
| `--device` | `cpu` | Inference device (`cpu`) |
| `--cache-dir` | `~/.cache/wandary/whisper` | Directory for downloaded model weights |
| `--max-duration` | `120.0` | Max allowed audio duration in seconds |
| `--max-size-mb` | `10.0` | Max allowed audio file size in megabytes |
| `--verbose` | `False` | Enable diagnostic logging to stderr |

---

## Backend Integration (`WHISPER_COMMAND`)

Wandary backend services invoke the transcriber via the `WHISPER_COMMAND` environment variable.

The included wrapper script `whisper_wrapper.sh` automatically detects virtual environments and runs `cli.py`:

```bash
export WHISPER_COMMAND="/home/batman/Projects/code/wandary/tools/voice-transcriber/whisper_wrapper.sh"
```

The wrapper supports both calling conventions:
```bash
$WHISPER_COMMAND /tmp/media/voice_note.ogg
# OR
$WHISPER_COMMAND --input-file /tmp/media/voice_note.ogg
```

### Exit Codes and Output Contract

- **Success (`exit 0`)**: Emits valid JSON to `stdout`:
  ```json
  {
    "text": "Transcribed speech content",
    "language": "en",
    "uncertainSpans": []
  }
  ```
- **Validation Failure (`exit 1`)**: Emits error JSON to `stdout` and exits nonzero:
  ```json
  {
    "error": "Audio duration 135.00s exceeds maximum limit of 120s",
    "code": "DURATION_EXCEEDED",
    "text": "",
    "language": null,
    "uncertainSpans": []
  }
  ```
- **Missing Dependency (`exit 2`)**: Emits honest setup error to `stdout` and exits nonzero:
  ```json
  {
    "error": "faster-whisper is not installed. To use local voice transcription, install dependencies via:\n  pip install -r tools/voice-transcriber/requirements.txt",
    "code": "DEPENDENCY_MISSING",
    "text": "",
    "language": null,
    "uncertainSpans": []
  }
  ```

---

## Architecture & Data Flow

```
Customer WhatsApp Audio (WAV / OGG / M4A)
                   │
                   ▼
       [AudioValidator]
       ├── Path & Symlink Safety Checks
       ├── Extension Verification (.wav, .ogg, .oga, .opus, .m4a)
       ├── File Size Check (<= 10MB)
       └── ffprobe Duration Inspection (<= 120s)
                   │
                   ▼ Validated Path
   [FasterWhisperTranscriber] (Lazy Import)
       ├── Local Weights Cache (~/.cache/wandary/whisper)
       ├── CPU int8 Inference (CTranslate2)
       └── Confidence Extraction (uncertainSpans)
                   │
                   ▼
           Output JSON Object
       { text, language, uncertainSpans }
```

---

## Privacy & Security

1. **Local Data Processing**: Audio content never leaves the host machine. No external API calls are made during transcription.
2. **No Audio Logging**: Raw audio streams and decoded waveform bytes are never written to stdout, stderr, or application log files.
3. **Caller Lifecycle Ownership**: The transcriber does not delete input audio files upon completion. The calling application controls retention and deletion according to Wandary compliance policies.
4. **Symlink Sandboxing**: The tool detects and rejects broken symlinks, links pointing to special device nodes (`/dev/*`), and symlinks resolving to system administrative directories (`/etc`, `/proc`, `/sys`).

---

## Running Tests

Run the test suite using Python's standard `unittest` (no external dependencies required):

```bash
python3 -m unittest discover -s tools/voice-transcriber/tests -v
```
