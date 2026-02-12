#!/bin/sh
set -eu

pr_dashboard_usage() {
    script_name="$1"
    cat <<EOF
Usage: $script_name [--watch] [--interval SECONDS] [--limit COUNT]
EOF
}

pr_dashboard_parse_args() {
    script_name="$1"
    shift

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
                [ "$#" -ge 2 ] || { pr_dashboard_usage "$script_name"; exit 1; }
                INTERVAL="$2"
                shift 2
                ;;
            --limit)
                [ "$#" -ge 2 ] || { pr_dashboard_usage "$script_name"; exit 1; }
                LIMIT="$2"
                shift 2
                ;;
            -h|--help)
                pr_dashboard_usage "$script_name"
                exit 0
                ;;
            *)
                pr_dashboard_usage "$script_name"
                exit 1
                ;;
        esac
    done
}

pr_dashboard_repo() {
    REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || true)
    [ -n "$REPO" ] || {
        echo "Unable to determine GitHub repo. Run inside a git clone with gh auth." >&2
        exit 1
    }
}

pr_dashboard_render() {
    title="$1"
    search_query="$2"

    now=$(date '+%Y-%m-%d %H:%M:%S')
    printf '%s (%s)\nRepo: %s\n\n' "$title" "$now" "$REPO"

    # Use custom JSON + template to include labels column
    # Format: ID  TITLE  BRANCH  STATE  UPDATED  LABELS
    gh pr list -R "$REPO" --search "$search_query" --limit "$LIMIT" \
        --json number,title,headRefName,state,updatedAt,labels \
        --template '{{range .}}{{tablerow (printf "#%.0f" .number) (truncate 50 .title) .headRefName .state (timeago .updatedAt) (pluck "name" .labels | join ", ")}}{{end}}'
}

pr_dashboard_main() {
    script_name="$1"
    title="$2"
    search_query="$3"
    shift 3

    pr_dashboard_parse_args "$script_name" "$@"
    pr_dashboard_repo

    if [ "$WATCH" = "1" ]; then
        while true; do
            clear
            pr_dashboard_render "$title" "$search_query"
            sleep "$INTERVAL"
        done
    fi

    pr_dashboard_render "$title" "$search_query"
}
