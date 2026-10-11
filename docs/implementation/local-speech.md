# Local Speech Transcription Implementation

## Overview

Wandary processes inbound voice messages from customer communication channels (such as WhatsApp audio notes) using a **100% free, fully local** automatic speech recognition pipeline.

No cloud speech-to-text APIs (Google Cloud Speech, OpenAI Whisper API, AWS Transcribe) are used. Inference executes entirely on the host machine using `faster-whisper` on CPU with `int8` quantization and the `small` model architecture.

---

## Contract Alignment

The speech transcriber conforms directly to the `SpeechPort` specification declared in `packages/contracts/src/ports.ts`:

```typescript
export interface SpeechPort {
  transcribe(input: {
    privateMediaId: Id;
    languageHints: string[];
    traceId: string;
  }): Promise<{
    text: string;
    detectedLanguage?: string;
    uncertainSpans: string[];
  }>;
}
```

The tool produces output in the following JSON format:

```json
{
  "text": "Please pick up 3 suits for dry cleaning tomorrow morning",
  "language": "en",
  "uncertainSpans": ["tomorrow morning"]
}
```

When low-confidence words or segments occur (average log-probability below `-1.0`, `no_speech_prob` above `0.6`, or individual word probability below `0.5`), the system populates `uncertainSpans` with the corresponding phrases so downstream conversation agents can confirm those specifics with the user.

---

## Technical Architecture

```
┌────────────────────────────────────────────────────────┐
│               Wandary Backend Service                  │
│                                                        │
│  1. Receives audio webhook                             │
│  2. Stores media in secure temporary storage           │
│  3. Invokes WHISPER_COMMAND with audio file path       │
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│         tools/voice-transcriber/whisper_wrapper.sh     │
│                                                        │
│  - Locates Python runtime (.venv or system python3)    │
│  - Invokes cli.py passing parameters securely          │
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│              tools/voice-transcriber/cli.py            │
│                                                        │
│  [AudioValidator]                                      │
│  ├── Path safety & symlink sandboxing                  │
│  ├── Allowed extension check (.wav, .ogg, .m4a)        │
│  ├── File size validation (<= 10MB)                    │
│  └── ffprobe duration inspection (<= 120s)             │
│                                                        │
│  [FasterWhisperTranscriber] (Lazy Import)              │
│  ├── Checks local cache (~/.cache/wandary/whisper)     │
│  ├── CPU int8 CTranslate2 inference                    │
│  └── Formats result & identifies uncertainSpans        │
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼
               JSON stdout (Exit Code 0)
         or Error JSON stdout (Exit Code 1/2)
```

---

## Guardrails and Validation Rules

| Guardrail | Enforcement Mechanism | Limit | Error Code |
|-----------|----------------------|-------|------------|
| **File Format** | File extension and `ffprobe` format inspection | WAV, OGG/Opus, M4A/AAC | `UNSUPPORTED_FORMAT` |
| **File Size** | `os.stat` inspection prior to model loading | 10 MB maximum | `FILE_TOO_LARGE` |
| **Duration** | `ffprobe` stream metadata inspection | 120 seconds maximum | `DURATION_EXCEEDED` |
| **Probe Timeout** | `subprocess.run(timeout=15.0)` | 15 seconds | `PROBE_TIMEOUT` |
| **Symlink Safety** | Realpath resolution and system path checking | Rejects broken links, non-regular files, `/etc`, `/proc`, `/sys`, `/dev` | `UNSAFE_SYMLINK` |
| **Missing Input** | Parameter validation | Positional or `--input-file` required | `INVALID_ARGUMENTS` |

---

## Privacy and Operational Security

1. **Local-Only Execution**: Audio never traverses external networks.
2. **Zero Audio Logging**: Decoded audio buffers, base64 strings, or raw binary payloads are never emitted to loggers, stdout, or stderr.
3. **Caller Media Ownership**: The tool does not alter or delete the input media file. The caller retains sole responsibility for deleting temporary media according to Wandary data retention schedules.
4. **Shell Injection Prevention**: The tool is invoked via `exec` argument lists rather than shell string interpolation. File names containing spaces, quotes, or punctuation are processed safely.

---

## Model Caching

Model checkpoints are downloaded on the first run directly to the designated cache directory (defaults to `~/.cache/wandary/whisper` or overridden by `WHISPER_CACHE_DIR`).

All subsequent executions load weights directly from disk without network access.

---

## Verification and Testing

The voice transcriber includes a zero-dependency test suite running on standard Python `unittest`:

```bash
python3 -m unittest discover -s tools/voice-transcriber/tests -v
```

Tests utilize an injectable `FakeTranscriber` to verify validation constraints, output schemas, and CLI behavior without requiring multi-megabyte model downloads or GPU/CPU model inference.
