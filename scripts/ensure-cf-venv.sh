#!/usr/bin/env bash
# Bootstrap (idempotent) the Python venv that hosts the Chrome-fingerprint
# transport (scripts/cf-transport.py). Creates .venv-cf/ next to the repo
# root and installs curl_cffi if missing.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV="$ROOT/.venv-cf"

if [ -x "$VENV/bin/python" ] && "$VENV/bin/python" -c "import curl_cffi" 2>/dev/null; then
  echo "cf-venv: up to date ($VENV)"
  exit 0
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "cf-venv: python3 not found — Chrome-fingerprint transport unavailable (browser fallback remains)" >&2
  exit 0
fi

python3 -m venv "$VENV"
"$VENV/bin/pip" install --quiet --upgrade pip
"$VENV/bin/pip" install --quiet curl_cffi
"$VENV/bin/python" -c "import curl_cffi"
echo "cf-venv: ready ($VENV, curl_cffi $( "$VENV/bin/python" -c 'import curl_cffi; print(curl_cffi.__version__)'))"
