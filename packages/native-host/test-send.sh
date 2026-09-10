#!/usr/bin/env bash
# test-send.sh — Send a raw JSON message to the native host with proper framing.
#
# Usage:
#   ./test-send.sh '{"type":"PING","payload":{}}'
#   ./test-send.sh '{"type":"SCRAPE_SEARCH","payload":{"source":"linkedin","url":"https://www.linkedin.com/jobs/search/?keywords=python","config":{}}}'

set -euo pipefail

if [[ $# -lt 1 ]]; then
    echo "Usage: $0 '<json_message>'" >&2
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="${SCRIPT_DIR}/.venv"

# Activate venv if present
if [[ -d "$VENV_DIR" ]] && [[ -f "${VENV_DIR}/bin/python" ]]; then
    # shellcheck disable=SC1091
    source "${VENV_DIR}/bin/activate"
fi

MESSAGE="$1"

# Use Python to construct the proper length-prefixed message and pipe it
python3 -c "
import struct, json, sys

msg = sys.argv[1].encode('utf-8')
header = struct.pack('<I', len(msg))
sys.stdout.buffer.write(header)
sys.stdout.buffer.write(msg)
sys.stdout.buffer.flush()
" "$MESSAGE" | python3 -m auto_job_host.main
