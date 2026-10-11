# Voice verification

Tested 2026-10-11 with tools/voice-transcriber/.venv Python 3.12.14. I ran the full suite plus a real local model pass. No paid calls. No user audio.

## Unit tests

Command:

```
tools/voice-transcriber/.venv/bin/python -m unittest discover -s tools/voice-transcriber/tests -v
```

First run failed. 22 passed, 1 failed, exit 1 in 40.849s.

```
FAIL: test_missing_dependency_honest_message_and_nonzero_exit
AssertionError: 'RUNTIME_ERROR' != 'DEPENDENCY_MISSING'
```

The failure exposed a real bug. faster-whisper 1.2.1 calls `av.open(..., metadata_errors="ignore")`. The pinned `av==19.0.1` dropped that argument. Every real transcribe call died with:

```
TypeError: open() got an unexpected keyword argument 'metadata_errors'
```

The CLI caught it as RUNTIME_ERROR. Sine wave fixture transcribed as `{"text": "You", "language": "en"}` only after I downgraded.

After fix, same command passes. 23 tests OK, exit 0 in 10.127s.

## Defects fixed

I changed two files under tools/voice-transcriber. Nothing else.

Pin fix in requirements.txt and README.md:

```
av==19.0.1
```

became:

```
av==14.2.0
```

av 14.2.0 still accepts `metadata_errors`. I confirmed with `inspect` on `av.open`. Then I installed it with:

```
uv pip install --python tools/voice-transcriber/.venv/bin/python "av==14.2.0"
```

Test fix in tools/voice-transcriber/tests/test_cli.py. The old `test_missing_dependency_honest_message_and_nonzero_exit` assumed faster-whisper was missing. It runs under `sys.executable`, so under the venv it is present. I made it branch. If the import is missing it checks for DEPENDENCY_MISSING and exit nonzero. If present it checks for exit 0 and valid `text`, `language`, `uncertainSpans`.

## Real speech test

I needed spoken audio without touching user data or paid TTS. System had no espeak. I fetched Arch packages without root and extracted them to /tmp:

```
espeak-ng-1.52.0-1.1-x86_64.pkg.tar.zst 7.27M
pcaudiolib-1.3-1.1
libsonic-0.2.0-2
```

Ran with:

```
LD_LIBRARY_PATH=/tmp/opencode/espeak-root/usr/lib
ESPEAK_DATA_PATH=/tmp/opencode/espeak-root/usr/share/espeak-ng-data
/tmp/opencode/espeak-root/usr/bin/espeak-ng -v en -s 165 -w /tmp/opencode/laundry_raw.wav "Please wash and iron two dress shirts, and pick up my laundry tomorrow morning."
```

Output was 207K, 4.789977s per ffprobe. I resampled for Whisper:

```
ffmpeg -y -i /tmp/opencode/laundry_raw.wav -ar 16000 -ac 1 -c:a pcm_s16le /tmp/opencode/laundry_request.wav
```

Result was 150K, 4.79s, wav, well under 10MB and 120s caps.

Real transcription command, exit status kept intact with no pipes:

```
export WHISPER_CACHE_DIR=/tmp/opencode/whisper-cache
tools/voice-transcriber/.venv/bin/python tools/voice-transcriber/cli.py --model small --device cpu --compute-type int8 --cache-dir $WHISPER_CACHE_DIR /tmp/opencode/laundry_request.wav
```

Output, exit 0:

```json
{
  "text": "Please wash and iron two dress shirts, and pick up my laundry tomorrow morning.",
  "language": "en",
  "uncertainSpans": []
}
```

That matches the input sentence word for word. So yes, I claim real speech tested with actual model output. Model pulled from public HuggingFace on first run to /tmp/opencode/whisper-cache. It logged the unauthenticated Hub warning. Expected on a free box.

Wrapper checks also passed, both exit 0 with identical text:

```
tools/voice-transcriber/whisper_wrapper.sh --model small --device cpu --compute-type int8 --cache-dir $WHISPER_CACHE_DIR --input-file /tmp/opencode/laundry_request.wav
tools/voice-transcriber/whisper_wrapper.sh "/tmp/opencode/audio with spaces (test) #1.wav" --model small ...
```

The spaced name with brackets and hash worked. The wrapper uses `exec "$PYTHON_BIN" "$SCRIPT_DIR/cli.py" "$@"`. No shell interpolation. Good.

## Guardrails checked

Each ran as a direct call, exit code read from `$?`:

Missing file returns FILE_NOT_FOUND, exit 1. Oversize 10MB plus 1024 bytes returns FILE_TOO_LARGE, exit 1. Symlink to /etc/hosts returns UNSAFE_SYMLINK, exit 1. Malformed wav and empty file and broken symlink paths are covered in the unit suite.

Confidence handling works. Sine tone decodes as low confidence `uncertainSpans: ["You"]`. Clean espeak sentence decodes as high confidence `uncertainSpans: []`. Thresholds in transcriber.py are avg_logprob below -1.0, no_speech_prob above 0.6, word probability below 0.5.

Dependency errors stay explicit. Missing faster-whisper raises DEPENDENCY_MISSING with the pip install hint. Missing ffprobe raises FFPROBE_MISSING. Model fetch errors bubble as RUNTIME_ERROR JSON, not silent text.

## Limitations

I only tested English espeak output. Hindi, Hinglish, noisy phone audio, and 120s boundary files are not covered. Model download needs network to HuggingFace once, then it runs offline. I left the cache in /tmp, not in ~/.cache/wandary/whisper. Caller still owns file deletion. I verified the file survives transcription.
