#!/bin/sh
set -eu

SCRIPT_PATH=$0
case $SCRIPT_PATH in
  */*) ;;
  *) SCRIPT_PATH=$(command -v -- "$SCRIPT_PATH" || true) ;;
esac
SCRIPT_DIR=$(cd -- "$(dirname -- "${SCRIPT_PATH:-$0}")" && pwd -P)
AGENTS_DIR=$(cd -- "$SCRIPT_DIR/.." && pwd -P)

usage() {
    cat <<'EOF'
Usage:
  agentTool.sh <action> [options]

Actions:
  refresh
  solicitClaudeCodeReview
  solicitCodexReview
  setVscodeTitle
  addLabel
  approveSkippedChecks
  tagPrWithTuxedoInstance

  # GitHub API actions (Phase 4) - High Priority
  getPrInfo                Get PR info (number, state, merge status, etc.)
  getReviewThreads         Fetch review threads via GraphQL
  replyToComment           Reply to a PR review comment in-thread
  replyToGemini            Reply to Gemini with standardized commit-hash message
  resolveThread            Resolve a review thread
  getCiStatus              Get workflow run and job statuses
  cancelWorkflow           Cancel a workflow run
  rerunWorkflow            Rerun a workflow

  # GitHub API actions (Phase 4) - Medium Priority
  downloadArtifact         Download CI artifact to local path
  enableAutoMerge          Enable auto-merge on a PR
  findPrForBranch          Find PR associated with a branch
  listHighPriorityPrs      List open high-priority PRs with merge state
  triggerGeminiReview      Post /gemini review and poll for response
  findDeferredWork         Find deferred work comments in a PR

Options:
  --title <value>          Title to set (optional for setVscodeTitle)
  --type <pr|issue>        Target type for addLabel (required for addLabel)
  --number <n>             PR or issue number (for addLabel, getReviewThreads, replyToComment, replyToGemini)
  --label <name>           Label name for addLabel (required for addLabel)
  --fields <list>          Comma-separated fields for getPrInfo (default: number,state,mergeStateStatus)
  --unresolved-only        Only return unresolved threads (for getReviewThreads)
  --comment-id <id>        Comment database ID (for replyToComment, replyToGemini)
  --body <text>            Comment body (for replyToComment)
  --thread-id <id>         Thread node ID (for resolveThread)
  --commit <sha>           Commit SHA (for getCiStatus, replyToGemini)
  --run-id <id>            Workflow run ID (for getCiStatus, cancelWorkflow, rerunWorkflow, downloadArtifact)
  --artifact <name>        Artifact name (for downloadArtifact)
  --dest <path>            Destination path (for downloadArtifact)
  --branch <name>          Branch name (for findPrForBranch)
  --state <open|merged>    PR state filter (for findPrForBranch, default: open)
  --poll-timeout <secs>    Polling timeout in seconds (for triggerGeminiReview, default: 300)
  --timeout-seconds <n>    Timeout in seconds (default: 300, refresh: 3600)
  --repo-root <path>       Execute from this repo root instead of auto-detecting
  --dry-run                Validate and report without executing the target script
  --json                   Emit structured JSON summary
  -h, --help               Show help
EOF
}

require_value() {
    opt="$1"
    val="$2"
    if [ -z "$val" ]; then
        echo "Error: $opt requires a value." >&2
        exit 1
    fi
}

is_positive_int() {
    case "$1" in
        ''|*[!0-9]*) return 1 ;;
        0) return 1 ;;
        *) return 0 ;;
    esac
}

is_sha_like() {
    case "$1" in
        ''|*[!0-9a-fA-F]*) return 1 ;;
    esac
    SHA_LEN=${#1}
    [ "$SHA_LEN" -ge 7 ] && [ "$SHA_LEN" -le 40 ]
}

# Handle --help/-h before requiring an action
case "${1:-}" in
    -h|--help)
        usage
        exit 0
        ;;
esac

if [ "$#" -lt 1 ]; then
    usage >&2
    exit 1
fi

ACTION="$1"
shift

TITLE=""
LABEL_TYPE=""
LABEL_NUMBER=""
LABEL_NAME=""
FIELDS=""
UNRESOLVED_ONLY=false
COMMENT_ID=""
BODY=""
THREAD_ID=""
COMMIT_SHA=""
RUN_ID=""
ARTIFACT_NAME=""
DEST_PATH=""
BRANCH_NAME=""
STATE_FILTER=""
POLL_TIMEOUT=""
TIMEOUT_SECONDS=""
REPO_ROOT=""
DRY_RUN=false
EMIT_JSON=false

while [ "$#" -gt 0 ]; do
    case "$1" in
        --title)
            shift
            require_value "--title" "${1:-}"
            TITLE="$1"
            ;;
        --type)
            shift
            require_value "--type" "${1:-}"
            LABEL_TYPE="$1"
            ;;
        --number)
            shift
            require_value "--number" "${1:-}"
            LABEL_NUMBER="$1"
            ;;
        --label)
            shift
            require_value "--label" "${1:-}"
            LABEL_NAME="$1"
            ;;
        --fields)
            shift
            require_value "--fields" "${1:-}"
            FIELDS="$1"
            ;;
        --unresolved-only)
            UNRESOLVED_ONLY=true
            ;;
        --comment-id)
            shift
            require_value "--comment-id" "${1:-}"
            COMMENT_ID="$1"
            ;;
        --body)
            shift
            require_value "--body" "${1:-}"
            BODY="$1"
            ;;
        --thread-id)
            shift
            require_value "--thread-id" "${1:-}"
            THREAD_ID="$1"
            ;;
        --commit)
            shift
            require_value "--commit" "${1:-}"
            COMMIT_SHA="$1"
            ;;
        --run-id)
            shift
            require_value "--run-id" "${1:-}"
            RUN_ID="$1"
            ;;
        --artifact)
            shift
            require_value "--artifact" "${1:-}"
            ARTIFACT_NAME="$1"
            ;;
        --dest)
            shift
            require_value "--dest" "${1:-}"
            DEST_PATH="$1"
            ;;
        --branch)
            shift
            require_value "--branch" "${1:-}"
            BRANCH_NAME="$1"
            ;;
        --state)
            shift
            require_value "--state" "${1:-}"
            STATE_FILTER="$1"
            ;;
        --poll-timeout)
            shift
            require_value "--poll-timeout" "${1:-}"
            POLL_TIMEOUT="$1"
            ;;
        --timeout-seconds)
            shift
            require_value "--timeout-seconds" "${1:-}"
            TIMEOUT_SECONDS="$1"
            ;;
        --repo-root)
            shift
            require_value "--repo-root" "${1:-}"
            REPO_ROOT="$1"
            ;;
        --dry-run)
            DRY_RUN=true
            ;;
        --json)
            EMIT_JSON=true
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            echo "Error: Unknown option '$1'." >&2
            usage >&2
            exit 1
            ;;
    esac
    shift
done

case "$ACTION" in
    refresh|setVscodeTitle|solicitCodexReview|solicitClaudeCodeReview|addLabel|approveSkippedChecks|tagPrWithTuxedoInstance) ;;
    getPrInfo|getReviewThreads|replyToComment|replyToGemini|resolveThread|getCiStatus|cancelWorkflow|rerunWorkflow) ;;
    downloadArtifact|enableAutoMerge|findPrForBranch|listHighPriorityPrs|triggerGeminiReview|findDeferredWork) ;;
    *)
        echo "Error: Unknown action '$ACTION'." >&2
        usage >&2
        exit 1
        ;;
esac

# setVscodeTitle defaults to '<workspace> - <branch>' when --title is not provided

# addLabel requires --type, --number, and --label
if [ "$ACTION" = "addLabel" ]; then
    if [ -z "$LABEL_TYPE" ]; then
        echo "Error: addLabel requires --type." >&2
        exit 1
    fi
    if [ -z "$LABEL_NUMBER" ]; then
        echo "Error: addLabel requires --number." >&2
        exit 1
    fi
    if [ -z "$LABEL_NAME" ]; then
        echo "Error: addLabel requires --label." >&2
        exit 1
    fi
    case "$LABEL_TYPE" in
        pr|issue) ;;
        *)
            echo "Error: --type must be 'pr' or 'issue'." >&2
            exit 1
            ;;
    esac
    if ! is_positive_int "$LABEL_NUMBER"; then
        echo "Error: --number must be a positive integer." >&2
        exit 1
    fi
fi

# getReviewThreads requires --number (PR number)
if [ "$ACTION" = "getReviewThreads" ]; then
    if [ -z "$LABEL_NUMBER" ]; then
        echo "Error: getReviewThreads requires --number (PR number)." >&2
        exit 1
    fi
    if ! is_positive_int "$LABEL_NUMBER"; then
        echo "Error: --number must be a positive integer." >&2
        exit 1
    fi
fi

# replyToComment requires --number, --comment-id, and --body
if [ "$ACTION" = "replyToComment" ]; then
    if [ -z "$LABEL_NUMBER" ]; then
        echo "Error: replyToComment requires --number (PR number)." >&2
        exit 1
    fi
    if [ -z "$COMMENT_ID" ]; then
        echo "Error: replyToComment requires --comment-id." >&2
        exit 1
    fi
    if [ -z "$BODY" ]; then
        echo "Error: replyToComment requires --body." >&2
        exit 1
    fi
fi

# replyToGemini requires --number, --comment-id, and --commit
if [ "$ACTION" = "replyToGemini" ]; then
    if [ -z "$LABEL_NUMBER" ]; then
        echo "Error: replyToGemini requires --number (PR number)." >&2
        exit 1
    fi
    if [ -z "$COMMENT_ID" ]; then
        echo "Error: replyToGemini requires --comment-id." >&2
        exit 1
    fi
    if [ -z "$COMMIT_SHA" ]; then
        echo "Error: replyToGemini requires --commit." >&2
        exit 1
    fi
    if ! is_sha_like "$COMMIT_SHA"; then
        echo "Error: --commit must be a 7-40 character hexadecimal SHA." >&2
        exit 1
    fi
fi

# resolveThread requires --thread-id
if [ "$ACTION" = "resolveThread" ]; then
    if [ -z "$THREAD_ID" ]; then
        echo "Error: resolveThread requires --thread-id." >&2
        exit 1
    fi
fi

# getCiStatus requires either --commit or --run-id
if [ "$ACTION" = "getCiStatus" ]; then
    if [ -z "$COMMIT_SHA" ] && [ -z "$RUN_ID" ]; then
        echo "Error: getCiStatus requires --commit or --run-id." >&2
        exit 1
    fi
fi

# cancelWorkflow requires --run-id
if [ "$ACTION" = "cancelWorkflow" ]; then
    if [ -z "$RUN_ID" ]; then
        echo "Error: cancelWorkflow requires --run-id." >&2
        exit 1
    fi
fi

# rerunWorkflow requires --run-id
if [ "$ACTION" = "rerunWorkflow" ]; then
    if [ -z "$RUN_ID" ]; then
        echo "Error: rerunWorkflow requires --run-id." >&2
        exit 1
    fi
fi

# downloadArtifact requires --run-id, --artifact, and --dest
if [ "$ACTION" = "downloadArtifact" ]; then
    if [ -z "$RUN_ID" ]; then
        echo "Error: downloadArtifact requires --run-id." >&2
        exit 1
    fi
    if [ -z "$ARTIFACT_NAME" ]; then
        echo "Error: downloadArtifact requires --artifact." >&2
        exit 1
    fi
    if [ -z "$DEST_PATH" ]; then
        echo "Error: downloadArtifact requires --dest." >&2
        exit 1
    fi
fi

# enableAutoMerge requires --number (PR number)
if [ "$ACTION" = "enableAutoMerge" ]; then
    if [ -z "$LABEL_NUMBER" ]; then
        echo "Error: enableAutoMerge requires --number (PR number)." >&2
        exit 1
    fi
fi

# findPrForBranch requires --branch
if [ "$ACTION" = "findPrForBranch" ]; then
    if [ -z "$BRANCH_NAME" ]; then
        echo "Error: findPrForBranch requires --branch." >&2
        exit 1
    fi
    # Default state to open
    if [ -z "$STATE_FILTER" ]; then
        STATE_FILTER="open"
    fi
    case "$STATE_FILTER" in
        open|merged) ;;
        *)
            echo "Error: --state must be 'open' or 'merged'." >&2
            exit 1
            ;;
    esac
fi

# triggerGeminiReview requires --number (PR number)
if [ "$ACTION" = "triggerGeminiReview" ]; then
    if [ -z "$LABEL_NUMBER" ]; then
        echo "Error: triggerGeminiReview requires --number (PR number)." >&2
        exit 1
    fi
    # Default poll timeout to 300 seconds
    if [ -z "$POLL_TIMEOUT" ]; then
        POLL_TIMEOUT="300"
    fi
fi

# findDeferredWork requires --number (PR number)
if [ "$ACTION" = "findDeferredWork" ]; then
    if [ -z "$LABEL_NUMBER" ]; then
        echo "Error: findDeferredWork requires --number (PR number)." >&2
        exit 1
    fi
fi

if [ -n "$TIMEOUT_SECONDS" ] && ! is_positive_int "$TIMEOUT_SECONDS"; then
    echo "Error: --timeout-seconds must be a positive integer." >&2
    exit 1
fi

if [ -z "$TIMEOUT_SECONDS" ]; then
    if [ "$ACTION" = "refresh" ]; then
        TIMEOUT_SECONDS=3600
    else
        TIMEOUT_SECONDS=300
    fi
fi

if [ -z "$REPO_ROOT" ]; then
    if ! REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null); then
        echo "Error: Could not detect git repository root. Use --repo-root." >&2
        exit 1
    fi
fi

# GitHub API actions are handled inline (no external script)
IS_INLINE_ACTION=false
case "$ACTION" in
    getPrInfo|getReviewThreads|replyToComment|replyToGemini|resolveThread|getCiStatus|cancelWorkflow|rerunWorkflow)
        IS_INLINE_ACTION=true
        SCRIPT=""
        ;;
    downloadArtifact|enableAutoMerge|findPrForBranch|listHighPriorityPrs|triggerGeminiReview|findDeferredWork)
        IS_INLINE_ACTION=true
        SCRIPT=""
        ;;
    solicitCodexReview|solicitClaudeCodeReview|approveSkippedChecks)
        SCRIPT="$REPO_ROOT/scripts/$ACTION.sh"
        ;;
    addLabel|tagPrWithTuxedoInstance)
        SCRIPT="$AGENTS_DIR/$ACTION.sh"
        ;;
    *)
        SCRIPT="$AGENTS_DIR/$ACTION.sh"
        ;;
esac

if [ "$IS_INLINE_ACTION" = false ] && [ ! -x "$SCRIPT" ]; then
    echo "Error: Script not executable: $SCRIPT" >&2
    exit 1
fi

SAFETY_CLASS="safe_write_local"
RETRY_SAFE="true"
if [ "$ACTION" = "refresh" ]; then
    RETRY_SAFE="false"
fi
if [ "$ACTION" = "solicitCodexReview" ] || [ "$ACTION" = "solicitClaudeCodeReview" ]; then
    SAFETY_CLASS="safe_read"
fi
if [ "$ACTION" = "addLabel" ] || [ "$ACTION" = "tagPrWithTuxedoInstance" ]; then
    SAFETY_CLASS="safe_write_remote"
fi
# GitHub API actions: read-only vs write
case "$ACTION" in
    getPrInfo|getReviewThreads|getCiStatus|findPrForBranch|listHighPriorityPrs|findDeferredWork)
        SAFETY_CLASS="safe_read"
        ;;
    replyToComment|replyToGemini|resolveThread|cancelWorkflow|rerunWorkflow|enableAutoMerge|triggerGeminiReview)
        SAFETY_CLASS="safe_write_remote"
        ;;
    downloadArtifact)
        SAFETY_CLASS="safe_write_local"
        ;;
esac

START_MS=$(node -e 'console.log(Date.now())')
TMP_OUTPUT=$(mktemp "${TMPDIR:-/tmp}/agentTool.XXXXXX")
trap 'rm -f "$TMP_OUTPUT"' EXIT

# Execute inline GitHub API action (writes to TMP_OUTPUT, sets EXIT_CODE)
run_inline_action() {
    REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
    case "$ACTION" in
        getPrInfo)
            if [ -z "$FIELDS" ]; then
                FIELDS="number,state,mergeStateStatus,headRefName,baseRefName,url"
            fi
            gh pr view --json "$FIELDS" -R "$REPO"
            ;;
        getReviewThreads)
            if [ "$UNRESOLVED_ONLY" = true ]; then
                FILTER='select(.isResolved == false)'
            else
                FILTER='.'
            fi
            # Extract owner and repo name
            OWNER=$(echo "$REPO" | cut -d'/' -f1)
            REPO_NAME=$(echo "$REPO" | cut -d'/' -f2)
            gh api graphql -f query='
                query($owner: String!, $repo: String!, $pr: Int!) {
                    repository(owner: $owner, name: $repo) {
                        pullRequest(number: $pr) {
                            reviewThreads(first: 100) {
                                nodes {
                                    id
                                    isResolved
                                    path
                                    line
                                    comments(first: 20) {
                                        nodes {
                                            id
                                            databaseId
                                            author { login }
                                            body
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            ' -f owner="$OWNER" -f repo="$REPO_NAME" -F pr="$LABEL_NUMBER" \
                --jq ".data.repository.pullRequest.reviewThreads.nodes[] | $FILTER"
            ;;
        replyToComment)
            gh api "repos/$REPO/pulls/$LABEL_NUMBER/comments/$COMMENT_ID/replies" \
                -f body="$BODY"
            ;;
        replyToGemini)
            BODY="@gemini-code-assist Fixed in commit $COMMIT_SHA. Please confirm this addresses the issue."
            gh api "repos/$REPO/pulls/$LABEL_NUMBER/comments/$COMMENT_ID/replies" \
                -f body="$BODY"
            ;;
        resolveThread)
            gh api graphql -f query='
                mutation($threadId: ID!) {
                    resolveReviewThread(input: {threadId: $threadId}) {
                        thread { isResolved }
                    }
                }
            ' -f threadId="$THREAD_ID"
            ;;
        getCiStatus)
            if [ -n "$RUN_ID" ]; then
                gh run view "$RUN_ID" --json status,conclusion,jobs \
                    --jq '{status, conclusion, jobs: [.jobs[] | {name, status, conclusion}]}' \
                    -R "$REPO"
            else
                # Get run ID from commit, then get status
                FOUND_RUN_ID=$(gh run list --commit "$COMMIT_SHA" --limit 1 --json databaseId --jq '.[0].databaseId' -R "$REPO")
                if [ -z "$FOUND_RUN_ID" ] || [ "$FOUND_RUN_ID" = "null" ]; then
                    echo '{"error": "No workflow run found for commit"}' >&2
                    return 1
                fi
                gh run view "$FOUND_RUN_ID" --json status,conclusion,jobs,databaseId \
                    --jq '{run_id: .databaseId, status, conclusion, jobs: [.jobs[] | {name, status, conclusion}]}' \
                    -R "$REPO"
            fi
            ;;
        cancelWorkflow)
            gh run cancel "$RUN_ID" -R "$REPO"
            echo '{"status": "cancelled", "run_id": "'"$RUN_ID"'"}'
            ;;
        rerunWorkflow)
            gh run rerun "$RUN_ID" -R "$REPO"
            echo '{"status": "rerun_triggered", "run_id": "'"$RUN_ID"'"}'
            ;;
        downloadArtifact)
            gh run download "$RUN_ID" -n "$ARTIFACT_NAME" -D "$DEST_PATH" -R "$REPO"
            printf '{"status": "downloaded", "run_id": "%s", "artifact": "%s", "dest": "%s"}\n' "$RUN_ID" "$ARTIFACT_NAME" "$DEST_PATH"
            ;;
        enableAutoMerge)
            gh pr merge "$LABEL_NUMBER" --auto --merge -R "$REPO"
            printf '{"status": "auto_merge_enabled", "pr": %s}\n' "$LABEL_NUMBER"
            ;;
        findPrForBranch)
            gh pr list --head "$BRANCH_NAME" --state "$STATE_FILTER" --json number,title,state,url -R "$REPO" --jq '.[0] // {"error": "No PR found"}'
            ;;
        listHighPriorityPrs)
            # Get high-priority PRs then fetch merge state for each
            PRS=$(gh pr list --label "high-priority" --state open --search "-is:draft" --json number -R "$REPO" --jq '.[].number')
            if [ -z "$PRS" ]; then
                echo '[]'
            else
                printf '['
                FIRST=true
                for PR_NUM in $PRS; do
                    if [ "$FIRST" = false ]; then
                        printf ','
                    fi
                    gh pr view "$PR_NUM" --json number,title,mergeStateStatus -R "$REPO"
                    FIRST=false
                done
                printf ']\n'
            fi
            ;;
        triggerGeminiReview)
            # Post /gemini review command
            gh pr comment "$LABEL_NUMBER" -R "$REPO" --body "/gemini review"
            printf '{"status": "review_requested", "pr": %s}\n' "$LABEL_NUMBER"
            ;;
        findDeferredWork)
            # Search PR comments for deferred work patterns
            gh api "repos/$REPO/pulls/$LABEL_NUMBER/comments" --paginate \
                --jq '.[] | select(.body | test("defer|follow[- ]?up|future PR|later|TODO|FIXME"; "i")) | {id: .id, path: .path, line: .line, body: .body, html_url: .html_url}'
            ;;
    esac
}

EXIT_CODE=0
if [ "$DRY_RUN" = true ]; then
    if [ "$IS_INLINE_ACTION" = true ]; then
        printf 'dry-run: would run inline action %s\n' "$ACTION" >"$TMP_OUTPUT"
    else
        printf 'dry-run: would run %s from %s\n' "$SCRIPT" "$REPO_ROOT" >"$TMP_OUTPUT"
    fi
elif [ "$IS_INLINE_ACTION" = true ]; then
    # Export variables for subshell access
    export ACTION FIELDS UNRESOLVED_ONLY LABEL_NUMBER COMMENT_ID BODY THREAD_ID COMMIT_SHA RUN_ID
    export ARTIFACT_NAME DEST_PATH BRANCH_NAME STATE_FILTER POLL_TIMEOUT
    # Execute inline GitHub API action with timeout if available
    if command -v timeout >/dev/null 2>&1; then
        if ! timeout "$TIMEOUT_SECONDS" sh -c '
            set -eu
            REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
            case "$ACTION" in
                getPrInfo)
                    if [ -z "$FIELDS" ]; then
                        FIELDS="number,state,mergeStateStatus,headRefName,baseRefName,url"
                    fi
                    gh pr view --json "$FIELDS" -R "$REPO"
                    ;;
                getReviewThreads)
                    if [ "$UNRESOLVED_ONLY" = true ]; then
                        FILTER="select(.isResolved == false)"
                    else
                        FILTER="."
                    fi
                    OWNER=$(echo "$REPO" | cut -d/ -f1)
                    REPO_NAME=$(echo "$REPO" | cut -d/ -f2)
                    gh api graphql -f query="query(\$owner: String!, \$repo: String!, \$pr: Int!) { repository(owner: \$owner, name: \$repo) { pullRequest(number: \$pr) { reviewThreads(first: 100) { nodes { id isResolved path line comments(first: 20) { nodes { id databaseId author { login } body } } } } } } }" -f owner="$OWNER" -f repo="$REPO_NAME" -F pr="$LABEL_NUMBER" --jq ".data.repository.pullRequest.reviewThreads.nodes[] | $FILTER"
                    ;;
                replyToComment)
                    gh api "repos/$REPO/pulls/$LABEL_NUMBER/comments/$COMMENT_ID/replies" -f body="$BODY"
                    ;;
                replyToGemini)
                    BODY="@gemini-code-assist Fixed in commit $COMMIT_SHA. Please confirm this addresses the issue."
                    gh api "repos/$REPO/pulls/$LABEL_NUMBER/comments/$COMMENT_ID/replies" -f body="$BODY"
                    ;;
                resolveThread)
                    gh api graphql -f query="mutation(\$threadId: ID!) { resolveReviewThread(input: {threadId: \$threadId}) { thread { isResolved } } }" -f threadId="$THREAD_ID"
                    ;;
                getCiStatus)
                    if [ -n "$RUN_ID" ]; then
                        gh run view "$RUN_ID" --json status,conclusion,jobs --jq "{status, conclusion, jobs: [.jobs[] | {name, status, conclusion}]}" -R "$REPO"
                    else
                        FOUND_RUN_ID=$(gh run list --commit "$COMMIT_SHA" --limit 1 --json databaseId --jq ".[0].databaseId" -R "$REPO")
                        if [ -z "$FOUND_RUN_ID" ] || [ "$FOUND_RUN_ID" = "null" ]; then
                            echo "{\"error\": \"No workflow run found for commit\"}" >&2
                            exit 1
                        fi
                        gh run view "$FOUND_RUN_ID" --json status,conclusion,jobs,databaseId --jq "{run_id: .databaseId, status, conclusion, jobs: [.jobs[] | {name, status, conclusion}]}" -R "$REPO"
                    fi
                    ;;
                cancelWorkflow)
                    gh run cancel "$RUN_ID" -R "$REPO"
                    printf "{\"status\": \"cancelled\", \"run_id\": \"%s\"}\n" "$RUN_ID"
                    ;;
                rerunWorkflow)
                    gh run rerun "$RUN_ID" -R "$REPO"
                    printf "{\"status\": \"rerun_triggered\", \"run_id\": \"%s\"}\n" "$RUN_ID"
                    ;;
                downloadArtifact)
                    gh run download "$RUN_ID" -n "$ARTIFACT_NAME" -D "$DEST_PATH" -R "$REPO"
                    printf "{\"status\": \"downloaded\", \"run_id\": \"%s\", \"artifact\": \"%s\", \"dest\": \"%s\"}\n" "$RUN_ID" "$ARTIFACT_NAME" "$DEST_PATH"
                    ;;
                enableAutoMerge)
                    gh pr merge "$LABEL_NUMBER" --auto --merge -R "$REPO"
                    printf "{\"status\": \"auto_merge_enabled\", \"pr\": %s}\n" "$LABEL_NUMBER"
                    ;;
                findPrForBranch)
                    gh pr list --head "$BRANCH_NAME" --state "$STATE_FILTER" --json number,title,state,url -R "$REPO" --jq ".[0] // {\"error\": \"No PR found\"}"
                    ;;
                listHighPriorityPrs)
                    PRS=$(gh pr list --label "high-priority" --state open --search "-is:draft" --json number -R "$REPO" --jq ".[].number")
                    if [ -z "$PRS" ]; then
                        echo "[]"
                    else
                        printf "["
                        FIRST=true
                        for PR_NUM in $PRS; do
                            if [ "$FIRST" = false ]; then
                                printf ","
                            fi
                            gh pr view "$PR_NUM" --json number,title,mergeStateStatus -R "$REPO"
                            FIRST=false
                        done
                        printf "]\n"
                    fi
                    ;;
                triggerGeminiReview)
                    gh pr comment "$LABEL_NUMBER" -R "$REPO" --body "/gemini review"
                    printf "{\"status\": \"review_requested\", \"pr\": %s}\n" "$LABEL_NUMBER"
                    ;;
                findDeferredWork)
                    gh api "repos/$REPO/pulls/$LABEL_NUMBER/comments" --paginate --jq ".[] | select(.body | test(\"defer|follow[- ]?up|future PR|later|TODO|FIXME\"; \"i\")) | {id: .id, path: .path, line: .line, body: .body, html_url: .html_url}"
                    ;;
            esac
        ' >"$TMP_OUTPUT" 2>&1; then
            EXIT_CODE=$?
        fi
    else
        if ! run_inline_action >"$TMP_OUTPUT" 2>&1; then
            EXIT_CODE=$?
        fi
    fi
else
    if command -v timeout >/dev/null 2>&1; then
        if ! timeout "$TIMEOUT_SECONDS" sh -c '
            set -eu
            REPO_ROOT="$1"
            SCRIPT="$2"
            TITLE="$3"
            ACTION="$4"
            LABEL_TYPE="$5"
            LABEL_NUMBER="$6"
            LABEL_NAME="$7"
            cd "$REPO_ROOT"
            if [ "$ACTION" = "addLabel" ]; then
                "$SCRIPT" --type "$LABEL_TYPE" --number "$LABEL_NUMBER" --label "$LABEL_NAME"
            elif [ -n "$TITLE" ]; then
                "$SCRIPT" "$TITLE"
            else
                "$SCRIPT"
            fi
        ' _ "$REPO_ROOT" "$SCRIPT" "$TITLE" "$ACTION" "$LABEL_TYPE" "$LABEL_NUMBER" "$LABEL_NAME" >"$TMP_OUTPUT" 2>&1; then
            EXIT_CODE=$?
        fi
    else
        if ! sh -c '
            set -eu
            REPO_ROOT="$1"
            SCRIPT="$2"
            TITLE="$3"
            ACTION="$4"
            LABEL_TYPE="$5"
            LABEL_NUMBER="$6"
            LABEL_NAME="$7"
            cd "$REPO_ROOT"
            if [ "$ACTION" = "addLabel" ]; then
                "$SCRIPT" --type "$LABEL_TYPE" --number "$LABEL_NUMBER" --label "$LABEL_NAME"
            elif [ -n "$TITLE" ]; then
                "$SCRIPT" "$TITLE"
            else
                "$SCRIPT"
            fi
        ' _ "$REPO_ROOT" "$SCRIPT" "$TITLE" "$ACTION" "$LABEL_TYPE" "$LABEL_NUMBER" "$LABEL_NAME" >"$TMP_OUTPUT" 2>&1; then
            EXIT_CODE=$?
        fi
    fi
fi

END_MS=$(node -e 'console.log(Date.now())')
DURATION_MS=$((END_MS - START_MS))

STATUS="success"
if [ "$EXIT_CODE" -ne 0 ]; then
    STATUS="failure"
fi

KEY_LINES_BASE64=$(tail -n 5 "$TMP_OUTPUT" | base64 | tr -d '\n')

if [ "$EMIT_JSON" = true ]; then
    node - "$STATUS" "$EXIT_CODE" "$DURATION_MS" "$ACTION" "$REPO_ROOT" "$SAFETY_CLASS" "$RETRY_SAFE" "$DRY_RUN" "$KEY_LINES_BASE64" <<'NODE'
const [status, exitCode, durationMs, action, repoRoot, safetyClass, retrySafe, dryRun, keyLinesBase64] =
  process.argv.slice(2);
const keyLines = Buffer.from(keyLinesBase64, 'base64')
  .toString('utf8')
  .split('\n')
  .map((line) => line.trimEnd())
  .filter((line) => line.length > 0);

process.stdout.write(
  `${JSON.stringify(
    {
      status,
      exit_code: Number(exitCode),
      duration_ms: Number(durationMs),
      action,
      repo_root: repoRoot,
      safety_class: safetyClass,
      retry_safe: retrySafe === "true",
      dry_run: dryRun === "true",
      key_lines: keyLines
    },
    null,
    2
  )}\n`
);
NODE
else
    cat "$TMP_OUTPUT"
fi

if [ "$EXIT_CODE" -ne 0 ]; then
    exit "$EXIT_CODE"
fi
