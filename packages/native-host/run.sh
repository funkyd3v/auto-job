#!/usr/bin/env bash
# run.sh — Launcher script for the AutoJob native messaging host.
#
# This script is what Chrome actually executes. It activates the
# Python virtual environment (if present) and runs the host.
#
# If the venv doesn't exist, it tries to run with system Python.
# Chrome will show an error if the host fails to start.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="${SCRIPT_DIR}/.venv"

# Activate virtualenv if present
if [[ -d "$VENV_DIR" ]] && [[ -f "${VENV_DIR}/bin/python" ]]; then
    # shellcheck disable=SC1091
    source "${VENV_DIR}/bin/activate"
    exec python3 -m auto_job_host.main "$@"
fi

# Fallback: try system Python
if command -v python3 &> /dev/null; then
    exec python3 -m auto_job_host.main "$@"
fi

# Last resort: error message to stderr
echo "ERROR: Python3 not found. Run ./install.sh first." >&2
exit 1
