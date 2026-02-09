#!/bin/sh
set -eu

usage() {
    cat <<'EOF'
Usage: listRecentClosedPrs.sh [--watch] [--interval SECONDS] [--limit COUNT]
EOF
}

WATCH=0
INTERVAL="${PR_REFRESH_SECONDS:-30}"
LIMIT="${PR_LIST_LIMIT:-20}"

while [ "$#" -gt 0 ]; do
    case "$1" in
        --watch)
            WATCH=1
            shift
            ;;
        --interval)
            [ "$#" -ge 2 ] || { usage; exit 1; }
            INTERVAL="$2"
            shift 2
            ;;
        --limit)
            [ "$#" -ge 2 ] || { usage; exit 1; }
            LIMIT="$2"
            shift 2
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            usage
            exit 1
            ;;
    esac
done

REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || true)
[ -n "$REPO" ] || {
    echo "Unable to determine GitHub repo. Run inside a git clone with gh auth." >&2
    exit 1
}

render_closed_prs() {
    now=$(date '+%Y-%m-%d %H:%M:%S')
    printf 'Recent Closed PRs (%s)\nRepo: %s\n\n' "$now" "$REPO"
    gh pr list -R "$REPO" --search "is:pr is:closed sort:created-desc" --limit "$LIMIT"
}

if [ "$WATCH" = "1" ]; then
    while true; do
        clear
        render_closed_prs
        sleep "$INTERVAL"
    done
fi

render_closed_prs
