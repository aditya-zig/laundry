#!/usr/bin/env bash
set -e

# Laundry Local Speech Transcriber Wrapper
# Compatible with WHISPER_COMMAND configuration in backend.
# Accepts arguments:
#   <audio_file>
#   --input-file <audio_file>
#   or any flags accepted by cli.py

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Use project venv python if available, otherwise fallback to system python3
if [ -x "$SCRIPT_DIR/.venv/bin/python3" ]; then
  PYTHON_BIN="$SCRIPT_DIR/.venv/bin/python3"
elif [ -x "$SCRIPT_DIR/venv/bin/python3" ]; then
  PYTHON_BIN="$SCRIPT_DIR/venv/bin/python3"
else
  PYTHON_BIN="${PYTHON:-python3}"
fi

# Execute CLI without shell interpolation of arguments
exec "$PYTHON_BIN" "$SCRIPT_DIR/cli.py" "$@"
