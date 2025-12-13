#!/bin/sh
set -e

# Generates user-friendly release notes using Anthropic's API
# Based on git commits since the last version bump
# Usage: generateReleaseNotes.sh <platform>
#   platform: "ios" or "android"
# Requires ANTHROPIC_API_KEY environment variable

PLATFORM="$1"

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

# Get commits between the two bumps, excluding merge commits
COMMITS=$(git log "$PREVIOUS_BUMP".."$CURRENT_BUMP" -p --no-merges 2>/dev/null || echo "")

# Build JSON payload using jq to handle all escaping properly
JSON_PAYLOAD=$(jq -Rsn --arg model "claude-sonnet-4-20250514" --arg commits "$COMMITS" '
{
    model: $model,
    max_tokens: 256,
    messages: [{
        role: "user",
        content: ("Generate brief, user-friendly release notes for a mobile app based on these git commits and diffs. Focus on what users will notice, not technical details. Use simple language. Keep it to 2-4 bullet points max. No markdown formatting, just plain text with bullet points using • character. Do not include a header or version number.\n\nCommits and diffs:\n" + $commits)
    }]
}')

# Call Anthropic API
RESPONSE=$(curl -s https://api.anthropic.com/v1/messages \
    -H "Content-Type: application/json" \
    -H "x-api-key: $ANTHROPIC_API_KEY" \
    -H "anthropic-version: 2023-06-01" \
    -d "$JSON_PAYLOAD")

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
