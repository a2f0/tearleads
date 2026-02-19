#!/bin/sh
set -e

# Generates user-friendly release notes from recent PRs
# Provider order: OpenCode -> OpenRouter -> Anthropic -> deterministic fallback
# Based on git commits since the last version bump
# Usage: generateReleaseNotes.sh <platform>
#   platform: "ios" or "android"
# Optional environment variables:
# - OPENROUTER_API_KEY (for OpenRouter provider)
# - OPENROUTER_MODEL (OpenRouter model override)
# - ANTHROPIC_API_KEY (for Anthropic provider)
# - ANTHROPIC_MODEL / FALLBACK_MODEL (Anthropic model overrides)

PLATFORM="$1"
# Use Claude 3 Haiku as primary (most cost-effective)
# Claude 3.5 Haiku requires tier 2+ API access
ANTHROPIC_MODEL="${ANTHROPIC_MODEL:-claude-3-haiku-20240307}"
FALLBACK_MODEL="${FALLBACK_MODEL:-claude-3-5-sonnet-latest}"
OPENROUTER_MODEL="${OPENROUTER_MODEL:-meta-llama/llama-3.1-8b-instruct:free}"

if [ -z "$PLATFORM" ]; then
    echo "Usage: generateReleaseNotes.sh <platform>" >&2
    echo "  platform: ios or android" >&2
    exit 1
fi

# Get the repository root to ensure paths work regardless of working directory
if ! command -v git >/dev/null 2>&1; then
    echo "Error: git is required but not found" >&2
    exit 1
fi
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
if [ -z "$REPO_ROOT" ]; then
    echo "Error: Not a git repository." >&2
    exit 1
fi

case "$PLATFORM" in
    ios)
        VERSION_FILE="$REPO_ROOT/packages/client/ios/App/App.xcodeproj/project.pbxproj"
        ;;
    android)
        VERSION_FILE="$REPO_ROOT/packages/client/android/app/build.gradle"
        ;;
    *)
        echo "Error: Invalid platform '$PLATFORM'. Must be 'ios' or 'android'" >&2
        exit 1
        ;;
esac

if ! command -v curl >/dev/null 2>&1; then
    echo "Error: curl is required but not found" >&2
    exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
    echo "Error: jq is required but not found" >&2
    exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
    echo "Error: gh (GitHub CLI) is required but not found" >&2
    exit 1
fi

# Find the two most recent commits that modified the version file
# This reliably detects version bumps regardless of commit message format
BUMP_COMMITS=$(git log -2 --format="%H" -- "$VERSION_FILE" 2>/dev/null || echo "")
CURRENT_BUMP=$(echo "$BUMP_COMMITS" | head -1)
PREVIOUS_BUMP=$(echo "$BUMP_COMMITS" | tail -1)

if [ -z "$CURRENT_BUMP" ]; then
    echo "Error: No version bump commits found for $PLATFORM." >&2
    exit 1
fi

# Determine commit range based on available version bump history
if [ "$CURRENT_BUMP" = "$PREVIOUS_BUMP" ]; then
    # Only one version bump exists; use recent commits leading up to it
    echo "Only one version bump found for $PLATFORM; using recent commit history" >&2
    GIT_RANGE="-20 ${CURRENT_BUMP}"
else
    PREVIOUS_DATE=$(git log -1 --format="%cI" "$PREVIOUS_BUMP" 2>/dev/null)
    CURRENT_DATE=$(git log -1 --format="%cI" "$CURRENT_BUMP" 2>/dev/null)
    echo "Finding PRs merged between $PREVIOUS_DATE and $CURRENT_DATE" >&2
    # Include the bump commit itself: squash-merge combines feature + version bump in one commit
    GIT_RANGE="${PREVIOUS_BUMP}..${CURRENT_BUMP}"
fi

# Extract PR numbers from all commits in range
# Works with merge commits ("Merge pull request #123") and squash-merge ("feat: desc (#123)")
# shellcheck disable=SC2086
PR_NUMBERS=$(git log $GIT_RANGE --format="%s" 2>/dev/null | \
    grep -oE '#[0-9]+' | tr -d '#' | sort -u || true)

if [ -z "$PR_NUMBERS" ]; then
    echo "Warning: No PR references found in commits, falling back to commit messages" >&2
    # shellcheck disable=SC2086
    COMMITS=$(git log $GIT_RANGE --no-merges --format="- %s" 2>/dev/null)
else
    # Fetch PRs one at a time (gh pr view only accepts one PR number)
    # shellcheck disable=SC2086
    PR_NUMS_INLINE=$(echo $PR_NUMBERS | tr '\n' ' ')
    echo "Fetching data for PRs: $PR_NUMS_INLINE" >&2

    # Build JSON array by fetching each PR individually
    # Use || true to prevent set -e from exiting if gh pr view fails
    PR_DATA_ITEMS=""
    for PR_NUM in $PR_NUMBERS; do
        PR_DATA=$(gh pr view "$PR_NUM" --json number,title,body,labels 2>/dev/null || true)
        if [ -n "$PR_DATA" ]; then
            if [ -z "$PR_DATA_ITEMS" ]; then
                PR_DATA_ITEMS="$PR_DATA"
            else
                PR_DATA_ITEMS="$PR_DATA_ITEMS,$PR_DATA"
            fi
        fi
    done
    PR_DATA_LIST="[$PR_DATA_ITEMS]"

    # Process the JSON array of PRs using jq for cleaner formatting
    # Use printf instead of echo to avoid escape sequence interpretation
    COMMITS=$(printf '%s' "$PR_DATA_LIST" | jq -r '
      def release_section($body):
        if ($body | length) == 0 then "" else
          ($body
            | split("\n")
            | . as $lines
            | ("\n" + ($lines | join("\n")) + "\n") as $text
            | (if ($text | test("\\n##?\\s*Release Notes\\s*\\n"; "i")) then
                ($text | capture("\\n##?\\s*Release Notes\\s*\\n(?<section>[\\s\\S]*?)(\\n##\\s|$)"; "i").section)
              else ""
              end)
          )
        end;

      def is_internal_label($labels):
        ["chore", "infra", "ci", "tests", "test", "deps", "dependencies", "refactor", "docs", "build", "tooling"] as $internal_labels |
        ($labels | map(.name | ascii_downcase) | any(IN($internal_labels[])));

      map(select(.labels == null or (is_internal_label(.labels) | not))
        | . as $pr
        | (release_section($pr.body // "") | if length > 0 then . else $pr.title end) as $summary
        | "\n## PR #\($pr.number): \($pr.title)\n\($summary)"
      ) | if length > 0 then join("") else "No user-visible changes found in PRs." end')
fi

if [ -z "$COMMITS" ]; then
    echo "Error: No commits or PRs found in range" >&2
    exit 1
fi

has_command() {
    command -v "$1" >/dev/null 2>&1
}

extract_candidate_changes() {
    printf '%s\n' "$COMMITS" | while IFS= read -r line; do
        case "$line" in
            "## PR #"*": "*) printf '%s\n' "${line#*: }" ;;
            "- "*) printf '%s\n' "${line#- }" ;;
        esac
    done | sed '/^[[:space:]]*$/d' | sed '/^No user-visible changes found in PRs\.$/d' | head -3
}

build_deterministic_notes() {
    changes=$(extract_candidate_changes || true)
    if [ -z "$changes" ]; then
        printf '• No user-visible changes\n'
        return 0
    fi

    printf '%s\n' "$changes" | while IFS= read -r change; do
        short_change=$(printf '%s' "$change" | cut -c1-140)
        printf '• %s\n' "$short_change"
    done
}

call_anthropic_api() {
    model="$1"
    max_tokens="$2"
    printf '%s' "$COMMITS" | jq -Rs --arg model "$model" --arg max_tokens "$max_tokens" '
{
    model: $model,
    max_tokens: ($max_tokens | tonumber),
    temperature: 0,
    system: "You are a release-notes generator. Only use facts explicitly stated in the provided PR titles/bodies. Do not infer or invent features. If nothing user-visible is present, output a single bullet: • No user-visible changes.",
    messages: [{
        role: "user",
        content: ("Generate release notes for a mobile app. 2-3 bullet points using • character. Plain text only, no markdown.\n\nRULES:\n- Under 500 characters total (Google Play Store limit)\n- Start DIRECTLY with the first • bullet - no preamble or introduction\n- No header or version number\n- Focus on user-visible changes only\n- Only include changes explicitly stated below; do not infer\n- If nothing user-visible, output exactly: • No user-visible changes\n\nPull Requests:\n" + .)
    }]
}' | curl -s https://api.anthropic.com/v1/messages \
        -H "Content-Type: application/json" \
        -H "x-api-key: $ANTHROPIC_API_KEY" \
        -H "anthropic-version: 2023-06-01" \
        -d @-
}

call_openrouter_api() {
    max_tokens="$1"
    printf '%s' "$COMMITS" | jq -Rs --arg model "$OPENROUTER_MODEL" --arg max_tokens "$max_tokens" '
{
    model: $model,
    max_tokens: ($max_tokens | tonumber),
    temperature: 0,
    messages: [{
        role: "system",
        content: "You generate mobile app release notes. Use only facts explicitly present in provided PR text. Never infer."
    }, {
        role: "user",
        content: ("Generate release notes for a mobile app. 2-3 bullet points using • character. Plain text only, no markdown.\n\nRULES:\n- Under 500 characters total\n- Start directly with • bullet lines\n- Focus on user-visible changes only\n- If nothing user-visible, output exactly: • No user-visible changes\n\nPull Requests:\n" + .)
    }]
}' | curl -s https://openrouter.ai/api/v1/chat/completions \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $OPENROUTER_API_KEY" \
        -H "HTTP-Referer: https://github.com/a2f0/tearleads" \
        -H "X-Title: Tearleads Release Notes" \
        -d @-
}

extract_notes() {
    printf '%s' "$1" | jq -r '.content[0].text // empty'
}

extract_openrouter_notes() {
    printf '%s' "$1" | jq -r '.choices[0].message.content // empty'
}

extract_error() {
    printf '%s' "$1" | jq -r '.error.message // .error.type // empty'
}

is_valid_notes() {
    notes="$1"
    # Must start with bullet
    printf '%s' "$notes" | grep -q '^• ' || return 1
    # 1 to 3 bullets
    bullet_count=$(printf '%s' "$notes" | grep -c '^• ' || true)
    if [ "$bullet_count" -gt 3 ]; then
        return 1
    fi
    # Under 500 characters
    if [ "$(printf '%s' "$notes" | wc -c | tr -d ' ')" -ge 500 ]; then
        return 1
    fi
    return 0
}

try_opencode() {
    if ! has_command opencode; then
        return 1
    fi

    UI_PROMPT=$(cat <<EOF
Generate mobile app release notes from this PR context.
Output only 1-3 bullet points.
Rules:
- Each line must start with "• "
- Plain text only, no markdown heading
- Under 500 characters total
- Focus only on user-visible changes
- If nothing user-visible: "• No user-visible changes"

PR context:
$COMMITS
EOF
)

    OPENCODE_RESPONSE=$(printf '%s' "$UI_PROMPT" | opencode run 2>/dev/null || true)
    if [ -z "$OPENCODE_RESPONSE" ]; then
        return 1
    fi

    RELEASE_NOTES=$(printf '%s\n' "$OPENCODE_RESPONSE" | sed 's/\r$//' | sed 's/^- /• /' | sed '/^[[:space:]]*$/d')
    is_valid_notes "$RELEASE_NOTES"
}

try_openrouter() {
    if [ -z "${OPENROUTER_API_KEY:-}" ]; then
        return 1
    fi

    RESPONSE=$(call_openrouter_api 180)
    RELEASE_NOTES=$(extract_openrouter_notes "$RESPONSE")
    if [ -z "$RELEASE_NOTES" ]; then
        ERROR=$(extract_error "$RESPONSE")
        [ -n "$ERROR" ] && printf "OpenRouter failed: %s\n" "$ERROR" >&2
        return 1
    fi

    RELEASE_NOTES=$(printf '%s\n' "$RELEASE_NOTES" | sed 's/\r$//' | sed 's/^- /• /' | sed '/^[[:space:]]*$/d')
    is_valid_notes "$RELEASE_NOTES"
}

try_anthropic() {
    if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
        return 1
    fi

    echo "Trying model: $ANTHROPIC_MODEL" >&2
    RESPONSE=$(call_anthropic_api "$ANTHROPIC_MODEL" 180)
    RELEASE_NOTES=$(extract_notes "$RESPONSE")

    # If primary fails, try fallback model
    if [ -z "$RELEASE_NOTES" ]; then
        ERROR=$(extract_error "$RESPONSE")
        printf "Primary model failed: %s\n" "$ERROR" >&2
        printf "Full response: %s\n" "$RESPONSE" >&2
        printf "Trying fallback model: %s\n" "$FALLBACK_MODEL" >&2

        RESPONSE=$(call_anthropic_api "$FALLBACK_MODEL" 220)
        RELEASE_NOTES=$(extract_notes "$RESPONSE")
    fi

    # If output format is invalid, retry with stricter prompt and shorter output
    if [ -n "$RELEASE_NOTES" ] && ! is_valid_notes "$RELEASE_NOTES"; then
        printf "Invalid release notes format; retrying with stricter limits\n" >&2
        RESPONSE=$(call_anthropic_api "$FALLBACK_MODEL" 120)
        RELEASE_NOTES=$(extract_notes "$RESPONSE")
    fi

    if [ -z "$RELEASE_NOTES" ]; then
        ERROR=$(extract_error "$RESPONSE")
        if [ -n "$ERROR" ]; then
            printf "Error from Anthropic API: %s\n" "$ERROR" >&2
        else
            echo "Error: No release notes returned from Anthropic API" >&2
        fi
        printf "Full response: %s\n" "$RESPONSE" >&2
        return 1
    fi

    is_valid_notes "$RELEASE_NOTES"
}

RELEASE_NOTES=""

if try_opencode; then
    echo "Generated release notes with OpenCode" >&2
elif try_openrouter; then
    echo "Generated release notes with OpenRouter" >&2
elif try_anthropic; then
    echo "Generated release notes with Anthropic" >&2
else
    echo "Falling back to deterministic release notes" >&2
    RELEASE_NOTES=$(build_deterministic_notes)
fi

if ! is_valid_notes "$RELEASE_NOTES"; then
    RELEASE_NOTES=$(build_deterministic_notes)
fi

if [ -z "$RELEASE_NOTES" ]; then
    echo "Error: Failed to generate release notes" >&2
    exit 1
fi

if [ "$(printf '%s' "$RELEASE_NOTES" | wc -c | tr -d ' ')" -ge 500 ]; then
    RELEASE_NOTES=$(printf '%s\n' "$RELEASE_NOTES" | head -2)
    if ! is_valid_notes "$RELEASE_NOTES"; then
        RELEASE_NOTES='• No user-visible changes'
    fi
fi

if [ -z "$RELEASE_NOTES" ]; then
    if [ -n "$ERROR" ]; then
        printf "Error: %s\n" "$ERROR" >&2
    else
        echo "Error: No release notes generated" >&2
    fi
    exit 1
fi

printf '%s\n' "$RELEASE_NOTES"
