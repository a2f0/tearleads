#!/usr/bin/env bash
# Build one of the npm-published packages outside the workspace and publish it.
set -euo pipefail

SCRIPT_DIR="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)"
REPO_ROOT="$(CDPATH='' cd -- "$SCRIPT_DIR/.." && pwd -P)"
PACKAGE=""
NPM_ARGS=()
NPM_TAG="latest"

usage() {
  cat <<EOF
Usage: $(basename "$0") <package> [--dry-run] [--tag <tag>] [--otp <code>]

Build and publish a Tearleads package to https://registry.npmjs.org with
public access. <package> is its directory under packages/:

  windowing    @tearleads/windowing
  client-sdk   @tearleads/client-sdk

The build uses a temporary directory that is removed on exit. Merging a
version bump to main publishes each package from its workflow,
.github/workflows/<package>-publish.yml; use this command to publish by hand.
ship-pr bumps changed package versions; for other releases, bump the version
in the package's package.json before publishing. Then authenticate with
npm login using an account that owns the @tearleads scope.

Options:
  --dry-run     Build and preview npm's publish without uploading.
  --tag <tag>   Set the npm distribution tag (default: latest).
  --otp <code>  Supply an npm one-time password, if required.
  -h, --help    Show this help and exit.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      NPM_ARGS+=("--dry-run")
      shift
      ;;
    --tag | --otp)
      if [[ $# -lt 2 || -z "$2" || "$2" == -* ]]; then
        echo "Error: $1 requires a value." >&2
        exit 1
      fi
      if [[ "$1" == --tag ]]; then
        NPM_TAG="$2"
      else
        NPM_ARGS+=("--otp" "$2")
      fi
      shift 2
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    -*)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
    *)
      if [[ -n "$PACKAGE" ]]; then
        echo "Error: publish one package at a time." >&2
        exit 1
      fi
      PACKAGE="$1"
      shift
      ;;
  esac
done

case "$PACKAGE" in
  windowing | client-sdk) ;;
  "")
    echo "Error: name the package to publish." >&2
    usage >&2
    exit 1
    ;;
  *)
    echo "Error: $PACKAGE is not published to npm." >&2
    usage >&2
    exit 1
    ;;
esac

for tool in bun npm; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "Error: $tool is required to publish @tearleads/$PACKAGE." >&2
    exit 1
  fi
done

PUBLISH_DIR="$(mktemp -d "${TMPDIR:-/tmp}/tearleads-$PACKAGE-publish.XXXXXX")"
trap 'rm -rf "$PUBLISH_DIR"' EXIT

# Use the package's own build, including its generated consumer manifest.
# Building outside the workspace also prevents npm from inferring a workspace
# publish target or including anything left in a local dist directory.
bun run --cwd "$REPO_ROOT/packages/$PACKAGE" package "$PUBLISH_DIR"
# A scope-specific user registry takes precedence over --registry. Override it
# only for this temporary package; npm still reads the user's auth credentials.
printf '%s\n' '@tearleads:registry=https://registry.npmjs.org' > "$PUBLISH_DIR/.npmrc"
cd "$PUBLISH_DIR"
npm publish --access public --registry https://registry.npmjs.org \
  --tag "$NPM_TAG" "${NPM_ARGS[@]+"${NPM_ARGS[@]}"}"
