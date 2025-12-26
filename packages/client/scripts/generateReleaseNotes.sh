#!/bin/sh
set -e

# Generates user-friendly release notes using Anthropic's API
# Based on git commits since the last version bump
# Usage: generateReleaseNotes.sh <platform>
#   platform: "ios" or "android"
# Requires ANTHROPIC_API_KEY environment variable

PLATFORM="$1"
ANTHROPIC_MODEL="claude-3-5-haiku-20241022"

if [ -z "$PLATFORM" ]; then
    echo "Usage: generateReleaseNotes.sh <platform>" >&2
    echo "  platform: ios or android" >&2
    exit 1
fi

case "$PLATFORM" in
    ios)
        BUMP_PATTERN="bump iOS build number"
        ;;
    android)
        BUMP_PATTERN="bump Android build number"
        ;;
    *)
        echo "Error: Invalid platform '$PLATFORM'. Must be 'ios' or 'android'" >&2
        exit 1
        ;;
esac

if [ -z "$ANTHROPIC_API_KEY" ]; then
    echo "Error: ANTHROPIC_API_KEY environment variable is required" >&2
    exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
    echo "Error: curl is required but not found" >&2
    exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
    echo "Error: jq is required but not found" >&2
    exit 1
fi

# Find the two most recent version bump commits for this platform
# We want commits BETWEEN the previous bump and the current bump
BUMP_COMMITS=$(git log --oneline --grep="$BUMP_PATTERN" -2 --format="%H" 2>/dev/null || echo "")
CURRENT_BUMP=$(echo "$BUMP_COMMITS" | head -1)
PREVIOUS_BUMP=$(echo "$BUMP_COMMITS" | tail -1)

# Build JSON payload and pipe directly to curl to avoid argument length limits
# Using -d @- reads the JSON from stdin
# Note: We use commit messages only (no diffs) and Haiku model to stay within API rate limits
RESPONSE=$(git log "$PREVIOUS_BUMP".."$CURRENT_BUMP" --no-merges --format="- %s%n%b" 2>/dev/null | jq -Rs --arg model "$ANTHROPIC_MODEL" '
{
    model: $model,
    max_tokens: 256,
    messages: [{
        role: "user",
        content: ("Generate brief, user-friendly release notes for a mobile app based on these git commit messages. Focus on what users will notice, not technical details. Use simple language. Keep it to 2-4 bullet points max. No markdown formatting, just plain text with bullet points using • character. Do not include a header or version number.\n\nCommit messages:\n" + .)
    }]
}' | curl -s https://api.anthropic.com/v1/messages \
    -H "Content-Type: application/json" \
    -H "x-api-key: $ANTHROPIC_API_KEY" \
    -H "anthropic-version: 2023-06-01" \
    -d @-)

# Extract the text from response using printf to avoid echo issues
RELEASE_NOTES=$(printf '%s' "$RESPONSE" | jq -r '.content[0].text // empty')

if [ -z "$RELEASE_NOTES" ]; then
    ERROR=$(printf '%s' "$RESPONSE" | jq -r '.error.message // empty')
    if [ -n "$ERROR" ]; then
        echo "Error from Anthropic API: $ERROR" >&2
    else
        echo "Error: No release notes returned from API" >&2
    fi
    exit 1
fi

printf '%s\n' "$RELEASE_NOTES"
