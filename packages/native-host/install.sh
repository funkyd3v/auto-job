#!/usr/bin/env bash
# install.sh — Install the AutoJob native messaging host.
#
# This script:
#   1. Creates a Python virtual environment (if not present)
#   2. Installs dependencies into the venv
#   3. Installs the Chrome Native Messaging host manifest
#
# Usage:
#   ./install.sh          # Install for current user
#   ./install.sh --system  # Install for all users (requires sudo)
#
# Prerequisites:
#   - Python 3.10+
#   - python3-venv (apt install python3-venv on Ubuntu)

set -euo pipefail

EXTENSION_ID="${AUTOJOB_EXTENSION_ID:-mnkogejnablpfnijdhhcjfbpeaamlpni}"
HOST_NAME="com.autojob.scraper"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOST_PATH="${SCRIPT_DIR}/run.sh"
VENV_DIR="${SCRIPT_DIR}/.venv"

# ─── Colors ───────────────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

info()  { echo -e "${GREEN}[INFO]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }

# ─── Create Virtual Environment ──────────────────────────────────────────────

setup_venv() {
    if [[ -d "$VENV_DIR" ]] && [[ -f "${VENV_DIR}/bin/python" ]]; then
        info "Virtual environment already exists at ${VENV_DIR}"
    else
        info "Creating virtual environment..."
        python3 -m venv "$VENV_DIR"
        info "Created venv at ${VENV_DIR}"
    fi

    # Activate
    # shellcheck disable=SC1091
    source "${VENV_DIR}/bin/activate"

    info "Python: $(which python3) ($(python3 --version))"
    info "Pip: $(which pip)"

    # Upgrade pip
    info "Upgrading pip..."
    python3 -m pip install --upgrade pip --quiet

    # Install dependencies
    info "Installing dependencies..."
    python3 -m pip install \
        "httpx>=0.27,<1" \
        "curl_cffi>=0.7,<1" \
        "beautifulsoup4>=4.12,<5" \
        "lxml>=5.1,<6" \
        --quiet

    info "Dependencies installed:"
    python3 -m pip list --format=columns | grep -E "httpx|curl.cffi|beautifulsoup|lxml" || true
}

# ─── Install Manifest ────────────────────────────────────────────────────────

install_user() {
    local manifest_dir
    case "$(uname -s)" in
        Linux*)
            manifest_dir="${HOME}/.config/native-messaging-hosts"
            ;;
        Darwin*)
            manifest_dir="${HOME}/Library/Application Support/Google/Chrome/NativeMessagingHosts"
            ;;
        MINGW*|MSYS*|CYGWIN*)
            manifest_dir="${APPDATA:-$HOME/AppData/Roaming}/Google/Chrome/NativeMessagingHosts"
            ;;
        *)
            error "Unsupported OS: $(uname -s)"
            exit 1
            ;;
    esac

    mkdir -p "$manifest_dir"
    local manifest_path="${manifest_dir}/${HOST_NAME}.json"

    cat > "$manifest_path" <<EOF
{
    "name": "${HOST_NAME}",
    "description": "AutoJob stealth native messaging host",
    "path": "${HOST_PATH}",
    "type": "stdio",
    "allowed_origins": [
        "chrome-extension://${EXTENSION_ID}/"
    ]
}
EOF

    info "Installed manifest to: ${manifest_path}"
}

install_system() {
    local manifest_dir
    case "$(uname -s)" in
        Linux*)
            manifest_dir="/etc/opt/chrome/native-messaging-hosts"
            ;;
        Darwin*)
            manifest_dir="/Library/Google/Chrome/NativeMessagingHosts"
            ;;
        *)
            error "Unsupported OS for system install: $(uname -s)"
            exit 1
            ;;
    esac

    sudo mkdir -p "$manifest_dir"
    local manifest_path="${manifest_dir}/${HOST_NAME}.json"

    sudo tee "$manifest_path" > /dev/null <<EOF
{
    "name": "${HOST_NAME}",
    "description": "AutoJob stealth native messaging host",
    "path": "${HOST_PATH}",
    "type": "stdio",
    "allowed_origins": [
        "chrome-extension://${EXTENSION_ID}/"
    ]
}
EOF

    info "Installed system manifest to: ${manifest_path}"
}

# ─── Verify ──────────────────────────────────────────────────────────────────

verify_install() {
    info "Verifying installation..."

    # Check venv
    if [[ ! -f "${VENV_DIR}/bin/python" ]]; then
        error "Virtual environment not found at ${VENV_DIR}"
        exit 1
    fi

    # Check Python can import the host
    if "${VENV_DIR}/bin/python" -c "import auto_job_host; print(f'v{auto_job_host.__version__}')" 2>/dev/null; then
        info "Native host module: OK"
    else
        error "Failed to import auto_job_host module"
        exit 1
    fi

    # Check run.sh is executable
    if [[ -x "$HOST_PATH" ]]; then
        info "run.sh: executable"
    else
        chmod +x "$HOST_PATH"
        info "run.sh: made executable"
    fi

    # Test ping
    info "Testing ping..."
    if echo '{"type":"PING","payload":{}}' | "$HOST_PATH" 2>/dev/null | grep -q "PONG"; then
        info "Ping test: OK"
    else
        warn "Ping test failed (host may need dependencies installed)"
    fi
}

# ─── Main ─────────────────────────────────────────────────────────────────────

echo ""
echo "AutoJob Native Host Installer"
echo "=============================="
echo ""

# Check Python
if ! command -v python3 &> /dev/null; then
    error "python3 is required but not found"
    error "Install with: sudo apt install python3 python3-venv"
    exit 1
fi

PYTHON_VERSION=$(python3 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
info "Python version: ${PYTHON_VERSION}"

# Check python3-venv
if ! python3 -m venv --help &> /dev/null 2>&1; then
    error "python3-venv is not installed"
    error "Install with: sudo apt install python3-venv"
    exit 1
fi

# Setup venv and install dependencies
setup_venv

# Ensure run.sh is executable
chmod +x "${HOST_PATH}" 2>/dev/null || true

# Install manifest
echo ""
if [[ "${1:-}" == "--system" ]]; then
    install_system
else
    install_user
fi

# Verify
echo ""
verify_install

echo ""
info "Installation complete!"
echo ""
echo "Next steps:"
echo "  1. Install Chrome extension (load unpacked from packages/extension/)"
echo "  2. Configure backend URL and API key in extension options"
echo "  3. The native host will be launched automatically when scraping"
echo ""
echo "To test manually:"
echo "  echo '{\"type\":\"PING\",\"payload\":{}}' | ${HOST_PATH}"
echo ""
echo "To activate the venv manually:"
echo "  source ${VENV_DIR}/bin/activate"
