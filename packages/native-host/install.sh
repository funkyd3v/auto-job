#!/usr/bin/env bash
# install.sh — Install the AutoJob native messaging host manifest.
#
# This script installs the Chrome Native Messaging host manifest
# so the extension can connect to the native host.
#
# Usage:
#   ./install.sh          # Install for current user
#   ./install.sh --system  # Install for all users (requires sudo)
#
# Prerequisites:
#   - Python 3.10+
#   - pip install curl_cffi beautifulsoup4 lxml httpx

set -euo pipefail

EXTENSION_ID="${AUTOJOB_EXTENSION_ID:-mnkogejnablpfnijdhhcjfbpeaamlpni}"
HOST_NAME="com.autojob.scraper"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOST_PATH="${SCRIPT_DIR}/run.sh"

# ─── Determine install location ───────────────────────────────────────────────

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
            echo "Unsupported OS: $(uname -s)" >&2
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

    echo "Installed manifest to: ${manifest_path}"
    echo "Extension ID: ${EXTENSION_ID}"
    echo "Host path: ${HOST_PATH}"
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
            echo "Unsupported OS for system install: $(uname -s)" >&2
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

    echo "Installed system manifest to: ${manifest_path}"
}

# ─── Main ─────────────────────────────────────────────────────────────────────

echo "AutoJob Native Host Installer"
echo "=============================="
echo ""

# Check Python
if ! command -v python3 &> /dev/null; then
    echo "Error: python3 is required but not found" >&2
    exit 1
fi

PYTHON_VERSION=$(python3 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
echo "Python version: ${PYTHON_VERSION}"

# Check dependencies
echo "Checking dependencies..."
python3 -c "import curl_cffi" 2>/dev/null || {
    echo "Warning: curl_cffi not installed. Run:"
    echo "  pip install curl_cffi beautifulsoup4 lxml httpx"
}
python3 -c "import bs4" 2>/dev/null || {
    echo "Warning: beautifulsoup4 not installed. Run:"
    echo "  pip install beautifulsoup4 lxml"
}

# Ensure run.sh is executable
chmod +x "${HOST_PATH}" 2>/dev/null || true

# Install manifest
if [[ "${1:-}" == "--system" ]]; then
    install_system
else
    install_user
fi

echo ""
echo "Installation complete!"
echo ""
echo "Next steps:"
echo "  1. Install Chrome extension (load unpacked from packages/extension/)"
echo "  2. Configure backend URL and API key in extension options"
echo "  3. The native host will be launched automatically when scraping"
echo ""
echo "To test the native host manually:"
echo "  echo '{\"type\":\"PING\",\"payload\":{}}' | ${HOST_PATH}"
