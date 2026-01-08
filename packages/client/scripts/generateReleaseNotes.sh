#!/bin/sh
set -e

# Generates user-friendly release notes using Anthropic's API
# Based on git commits since the last version bump
# Usage: generateReleaseNotes.sh <platform>
#   platform: "ios" or "android"
# Requires ANTHROPIC_API_KEY environment variable

PLATFORM="$1"
# Use Claude 3 Haiku as primary (most cost-effective)
# Claude 3.5 Haiku requires tier 2+ API access
ANTHROPIC_MODEL="${ANTHROPIC_MODEL:-claude-3-haiku-20240307}"
FALLBACK_MODEL="${FALLBACK_MODEL:-claude-3-5-sonnet-latest}"

if [ -z "$PLATFORM" ]; then
    echo "Usage: generateReleaseNotes.sh <platform>" >&2
    echo "  platform: ios or android" >&2
    exit 1
fi

case "$PLATFORM" in
    ios)
        VERSION_FILE="packages/client/ios/App/App.xcodeproj/project.pbxproj"
        ;;
    android)
        VERSION_FILE="packages/client/android/app/build.gradle"
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

# Find the two most recent commits that modified the version file
# This reliably detects version bumps regardless of commit message format
BUMP_COMMITS=$(git log -2 --format="%H" -- "$VERSION_FILE" 2>/dev/null || echo "")
CURRENT_BUMP=$(echo "$BUMP_COMMITS" | head -1)
PREVIOUS_BUMP=$(echo "$BUMP_COMMITS" | tail -1)

if [ "$CURRENT_BUMP" = "$PREVIOUS_BUMP" ]; then
    echo "Error: Could not find two distinct version bump commits for $PLATFORM. Unable to determine commit range." >&2
    exit 1
fi

# Build JSON payload and pipe directly to curl to avoid argument length limits
# Using -d @- reads the JSON from stdin
# Note: We use commit messages only (no diffs) and Haiku model to stay within API rate limits

# Get commits between version bumps, excluding the current bump commit itself
COMMITS=$(git log "${PREVIOUS_BUMP}..${CURRENT_BUMP}~1" --no-merges --format="- %s" 2>/dev/null)

call_anthropic_api() {
    model="$1"
    printf '%s' "$COMMITS" | jq -Rs --arg model "$model" '
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
        -d @-
}

extract_notes() {
    printf '%s' "$1" | jq -r '.content[0].text // empty'
}

extract_error() {
    printf '%s' "$1" | jq -r '.error.message // .error.type // empty'
}

# Try primary model
echo "Trying model: $ANTHROPIC_MODEL" >&2
RESPONSE=$(call_anthropic_api "$ANTHROPIC_MODEL")
RELEASE_NOTES=$(extract_notes "$RESPONSE")

# If primary fails, try fallback model
if [ -z "$RELEASE_NOTES" ]; then
    ERROR=$(extract_error "$RESPONSE")
    printf "Primary model failed: %s\n" "$ERROR" >&2
    printf "Full response: %s\n" "$RESPONSE" >&2
    printf "Trying fallback model: %s\n" "$FALLBACK_MODEL" >&2

    RESPONSE=$(call_anthropic_api "$FALLBACK_MODEL")
    RELEASE_NOTES=$(extract_notes "$RESPONSE")
fi

if [ -z "$RELEASE_NOTES" ]; then
    ERROR=$(extract_error "$RESPONSE")
    if [ -n "$ERROR" ]; then
        printf "Error from Anthropic API: %s\n" "$ERROR" >&2
    else
        echo "Error: No release notes returned from API" >&2
    fi
    printf "Full response: %s\n" "$RESPONSE" >&2
    exit 1
fi

printf '%s\n' "$RELEASE_NOTES"
