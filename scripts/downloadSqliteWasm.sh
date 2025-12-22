#!/bin/sh
#
# Downloads pre-built SQLite3MultipleCiphers WASM with encryption support.
# This provides encrypted SQLite for the web platform using OPFS storage.
#

set -e

# Configuration
SQLITE3MC_VERSION="2.2.6"
SQLITE_VERSION="3.51.1"
PACKAGE_NAME="sqlite3mc-${SQLITE3MC_VERSION}-sqlite-${SQLITE_VERSION}-wasm.zip"
DOWNLOAD_URL="https://github.com/utelle/SQLite3MultipleCiphers/releases/download/v${SQLITE3MC_VERSION}/${PACKAGE_NAME}"

# Paths
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CLIENT_DIR="${PROJECT_ROOT}/packages/client"
WASM_DIR="${CLIENT_DIR}/src/workers/sqlite-wasm"
TEMP_DIR="${PROJECT_ROOT}/.tmp-sqlite-wasm"

# Colors for output (if terminal supports it)
if [ -t 1 ]; then
    RED='\033[0;31m'
    GREEN='\033[0;32m'
    YELLOW='\033[0;33m'
    NC='\033[0m' # No Color
else
    RED=''
    GREEN=''
    YELLOW=''
    NC=''
fi

log_info() {
    printf "${GREEN}[INFO]${NC} %s\n" "$1"
}

log_warn() {
    printf "${YELLOW}[WARN]${NC} %s\n" "$1"
}

log_error() {
    printf "${RED}[ERROR]${NC} %s\n" "$1"
}

# Check for required tools
check_dependencies() {
    for cmd in curl unzip; do
        if ! command -v "$cmd" >/dev/null 2>&1; then
            log_error "Required command '$cmd' not found. Please install it."
            exit 1
        fi
    done
}

# Clean up temp directory on exit
cleanup() {
    if [ -d "${TEMP_DIR}" ]; then
        rm -rf "${TEMP_DIR}"
    fi
}
trap cleanup EXIT

# Main download function
download_sqlite_wasm() {
    log_info "Downloading SQLite3MultipleCiphers WASM v${SQLITE3MC_VERSION}..."

    # Create temp directory
    mkdir -p "${TEMP_DIR}"

    # Download the package
    log_info "Fetching from: ${DOWNLOAD_URL}"
    if ! curl -fsSL "${DOWNLOAD_URL}" -o "${TEMP_DIR}/${PACKAGE_NAME}"; then
        log_error "Failed to download SQLite WASM package"
        exit 1
    fi

    log_info "Download complete. Extracting..."

    # Extract the package
    if ! unzip -q "${TEMP_DIR}/${PACKAGE_NAME}" -d "${TEMP_DIR}"; then
        log_error "Failed to extract SQLite WASM package"
        exit 1
    fi

    # Find the extracted directory (version number in path)
    EXTRACTED_DIR=$(find "${TEMP_DIR}" -maxdepth 1 -type d -name "sqlite3mc-wasm-*" | head -1)
    if [ -z "${EXTRACTED_DIR}" ]; then
        log_error "Could not find extracted directory"
        exit 1
    fi

    log_info "Extracted to: ${EXTRACTED_DIR}"

    # Create destination directory
    mkdir -p "${WASM_DIR}"

    # Copy the essential files
    log_info "Copying WASM files to ${WASM_DIR}..."

    # Main WASM and JS files
    cp "${EXTRACTED_DIR}/jswasm/sqlite3.wasm" "${WASM_DIR}/"
    cp "${EXTRACTED_DIR}/jswasm/sqlite3.mjs" "${WASM_DIR}/"
    cp "${EXTRACTED_DIR}/jswasm/sqlite3-opfs-async-proxy.js" "${WASM_DIR}/"

    # Worker-related files for bundler compatibility
    if [ -f "${EXTRACTED_DIR}/jswasm/sqlite3-worker1-bundler-friendly.mjs" ]; then
        cp "${EXTRACTED_DIR}/jswasm/sqlite3-worker1-bundler-friendly.mjs" "${WASM_DIR}/"
    fi
    if [ -f "${EXTRACTED_DIR}/jswasm/sqlite3-worker1-promiser-bundler-friendly.mjs" ]; then
        cp "${EXTRACTED_DIR}/jswasm/sqlite3-worker1-promiser-bundler-friendly.mjs" "${WASM_DIR}/"
    fi

    # Copy additional worker files
    cp "${EXTRACTED_DIR}/jswasm/sqlite3-worker1.mjs" "${WASM_DIR}/" 2>/dev/null || true
    cp "${EXTRACTED_DIR}/jswasm/sqlite3-worker1-promiser.mjs" "${WASM_DIR}/" 2>/dev/null || true

    log_info "Creating version file..."
    cat > "${WASM_DIR}/VERSION" << EOF
SQLite3MultipleCiphers WASM
Version: ${SQLITE3MC_VERSION}
SQLite Version: ${SQLITE_VERSION}
Downloaded: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
Source: ${DOWNLOAD_URL}
EOF

    # Also copy to public folder for runtime access
    # The sqlite3.mjs must be loaded from public so import.meta.url resolves correctly for OPFS
    PUBLIC_SQLITE_DIR="${CLIENT_DIR}/public/sqlite"
    mkdir -p "${PUBLIC_SQLITE_DIR}"
    cp "${WASM_DIR}/sqlite3.mjs" "${PUBLIC_SQLITE_DIR}/"
    cp "${WASM_DIR}/sqlite3.wasm" "${PUBLIC_SQLITE_DIR}/"
    cp "${WASM_DIR}/sqlite3-opfs-async-proxy.js" "${PUBLIC_SQLITE_DIR}/"

    log_info "SQLite WASM files installed successfully!"
    log_info ""
    log_info "Files installed to: ${WASM_DIR}"
    log_info "Public files installed to: ${PUBLIC_SQLITE_DIR}"
    log_info ""
    log_info "Installed files:"
    ls -la "${WASM_DIR}"
    log_info ""
    log_info "Usage: Import sqlite3.mjs in your web worker and use PRAGMA key for encryption."
    log_info "Example:"
    log_info "  const sqlite3 = await initSqlite3();"
    log_info "  const db = new sqlite3.oo1.DB('/mydb.sqlite3', 'c');"
    log_info "  db.exec(\"PRAGMA key = 'your-secret-key';\");"
}

# Parse arguments
show_help() {
    cat << EOF
Usage: $(basename "$0") [OPTIONS]

Downloads pre-built SQLite3MultipleCiphers WASM with encryption support.

Options:
    -h, --help      Show this help message
    -c, --clean     Remove existing WASM files before downloading
    -v, --version   Show version information

Environment:
    SQLITE3MC_VERSION   Override the SQLite3MultipleCiphers version (default: ${SQLITE3MC_VERSION})
    SQLITE_VERSION      Override the SQLite version (default: ${SQLITE_VERSION})

EOF
}

# Main
main() {
    CLEAN=false

    while [ $# -gt 0 ]; do
        case "$1" in
            -h|--help)
                show_help
                exit 0
                ;;
            -c|--clean)
                CLEAN=true
                shift
                ;;
            -v|--version)
                echo "SQLite3MultipleCiphers WASM Downloader"
                echo "Target version: ${SQLITE3MC_VERSION} (SQLite ${SQLITE_VERSION})"
                exit 0
                ;;
            *)
                log_error "Unknown option: $1"
                show_help
                exit 1
                ;;
        esac
    done

    check_dependencies

    if [ "${CLEAN}" = true ] && [ -d "${WASM_DIR}" ]; then
        log_info "Cleaning existing WASM directory..."
        rm -rf "${WASM_DIR}"
    fi

    if [ -f "${WASM_DIR}/sqlite3.wasm" ]; then
        log_warn "SQLite WASM already exists at ${WASM_DIR}"
        log_warn "Use --clean to re-download"

        if [ -f "${WASM_DIR}/VERSION" ]; then
            log_info "Current version:"
            cat "${WASM_DIR}/VERSION"
        fi
        exit 0
    fi

    download_sqlite_wasm
}

main "$@"
