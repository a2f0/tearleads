#!/usr/bin/env bash
# Build @tearleads/windowing and commit the consumer package to a branch that
# holds only that package, so another repository can depend on
# github:a2f0/tearleads#<commit> without an npm release.
set -euo pipefail

SCRIPT_DIR="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)"
REPO_ROOT="$(CDPATH='' cd -- "$SCRIPT_DIR/.." && pwd -P)"
BRANCH="dist/windowing"
REMOTE="origin"
DRY_RUN=false

usage() {
  cat <<EOF
Usage: $(basename "$0") [--dry-run] [--branch <name>] [--remote <name>]

Build @tearleads/windowing and commit the built package to a branch whose tree
is that package alone (default: $BRANCH on $REMOTE). Each commit's parent is the
branch's previous tip, so the push is a fast-forward, and a build identical to
the tip publishes nothing. Consumers pin the printed commit:

  "@tearleads/windowing": "github:a2f0/tearleads#<commit>"

Options:
  --dry-run        Build and commit locally, print the commit, but do not push.
  --branch <name>  Branch to publish to (default: $BRANCH).
  --remote <name>  Remote to publish to (default: $REMOTE).
  -h, --help       Show this help and exit.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --branch | --remote)
      if [[ $# -lt 2 || -z "$2" || "$2" == -* ]]; then
        echo "Error: $1 requires a value." >&2
        exit 1
      fi
      if [[ "$1" == --branch ]]; then
        BRANCH="$2"
      else
        REMOTE="$2"
      fi
      shift 2
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

for tool in bun git; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "Error: $tool is required to publish @tearleads/windowing." >&2
    exit 1
  fi
done

cd "$REPO_ROOT"
SOURCE_COMMIT="$(git rev-parse HEAD)"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/tearleads-windowing-branch.XXXXXX")"
trap 'rm -rf "$WORK_DIR"' EXIT
BUILD_DIR="$WORK_DIR/package"
mkdir "$BUILD_DIR"

# The same consumer package npm receives, built outside the workspace.
bun run --cwd "$REPO_ROOT/packages/windowing" package "$BUILD_DIR"
VERSION="$(sed -n 's/^ *"version": *"\([^"]*\)".*$/\1/p' "$BUILD_DIR/package.json" | head -n 1)"
if [[ -z "$VERSION" ]]; then
  echo "Error: the built package.json has no version." >&2
  exit 1
fi

# Stage the build in a throwaway index, so the checkout's own index and work
# tree are untouched. --force keeps ignore rules from dropping built files.
GIT_DIR_PATH="$(git rev-parse --absolute-git-dir)"
export GIT_INDEX_FILE="$WORK_DIR/index"
git -C "$BUILD_DIR" --git-dir="$GIT_DIR_PATH" --work-tree="$BUILD_DIR" \
  add --all --force .
TREE="$(git write-tree)"
unset GIT_INDEX_FILE

PARENT=""
if git ls-remote --exit-code --heads "$REMOTE" "$BRANCH" >/dev/null; then
  git fetch --quiet --no-tags "$REMOTE" "refs/heads/$BRANCH"
  PARENT="$(git rev-parse FETCH_HEAD)"
  if [[ "$(git rev-parse "$PARENT^{tree}")" == "$TREE" ]]; then
    echo "$BRANCH already holds this build at $PARENT."
    echo "Pin: github:a2f0/tearleads#$PARENT"
    exit 0
  fi
fi

MESSAGE="windowing $VERSION from $SOURCE_COMMIT"
if [[ -n "$PARENT" ]]; then
  COMMIT="$(git commit-tree "$TREE" -p "$PARENT" -m "$MESSAGE")"
else
  COMMIT="$(git commit-tree "$TREE" -m "$MESSAGE")"
fi

if [[ "$DRY_RUN" == true ]]; then
  echo "Dry run: built $COMMIT ($MESSAGE); not pushed."
  exit 0
fi

git push "$REMOTE" "$COMMIT:refs/heads/$BRANCH"
echo "Published $MESSAGE to $BRANCH as $COMMIT."
echo "Pin: github:a2f0/tearleads#$COMMIT"
