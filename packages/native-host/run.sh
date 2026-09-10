#!/usr/bin/env bash
# run.sh — Launcher script for the AutoJob native messaging host.
#
# This script is what Chrome actually executes. It activates the
# Python virtual environment (if present) and runs the host.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Activate virtualenv if present
VENV_DIR="${SCRIPT_DIR}/.venv"
if [[ -d "$VENV_DIR" ]]; then
    # shellcheck disable=SC1091
    source "${VENV_DIR}/bin/activate"
fi

# Run the native host
exec python3 -m auto_job_host.main "$@"
