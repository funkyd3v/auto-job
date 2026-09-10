#!/usr/bin/env bash
# test-ping.sh — Send a properly formatted PING message to the native host.
#
# Chrome Native Messaging format: 4-byte little-endian length + JSON body.
# This script constructs that format for manual testing.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="${SCRIPT_DIR}/.venv"

# Activate venv if present
if [[ -d "$VENV_DIR" ]] && [[ -f "${VENV_DIR}/bin/python" ]]; then
    # shellcheck disable=SC1091
    source "${VENV_DIR}/bin/activate"
fi

# Use Python to construct the proper length-prefixed message and pipe it
python3 -c "
import struct, json, sys

msg = json.dumps({'type': 'PING', 'payload': {}}).encode('utf-8')
header = struct.pack('<I', len(msg))
sys.stdout.buffer.write(header)
sys.stdout.buffer.write(msg)
sys.stdout.buffer.flush()
" | python3 -m auto_job_host.main
