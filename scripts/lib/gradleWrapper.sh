# shellcheck shell=sh
# The Gradle wrapper jar is binary, so it is gitignored rather than committed.
# Not executable on its own: source it.
#
#   . "$REPO_ROOT/scripts/lib/gradleWrapper.sh"
#   ensure_gradle_wrapper_jar packages/app-capacitor/android
#
# POSIX sh throughout: callers run under /bin/sh.

# Regenerates <android project>/gradle/wrapper/gradle-wrapper.jar when it is
# missing, with the Gradle on PATH (the .mise.toml pin in a mise-activated
# shell), else through `mise exec`, as the Fastlane lanes do. The wrapper task runs
# in an empty scratch build, not the Android one: that build includes the
# Cordova plugins project `cap sync` creates, so configuring it fails on a fresh
# clone before the first sync. Only the jar is copied, so the tracked gradlew
# scripts and gradle-wrapper.properties, with its distribution checksum, stay as
# committed.
ensure_gradle_wrapper_jar() {
  gradle_wrapper_jar="$1/gradle/wrapper/gradle-wrapper.jar"
  if [ -f "$gradle_wrapper_jar" ]; then
    return 0
  fi

  echo "Generating $gradle_wrapper_jar from repo-managed Gradle..."
  if command -v gradle > /dev/null 2>&1; then
    set -- gradle
  elif command -v mise > /dev/null 2>&1; then
    set -- mise exec -- gradle
  else
    echo "Error: Gradle is unavailable. Run \`mise install\` from the repo root." >&2
    return 1
  fi

  gradle_wrapper_scratch=$(mktemp -d "${TMPDIR:-/tmp}/gradle-wrapper.XXXXXX") || return 1
  : > "$gradle_wrapper_scratch/settings.gradle"
  gradle_wrapper_status=0
  if "$@" --quiet --project-dir "$gradle_wrapper_scratch" wrapper --distribution-type all \
    && mkdir -p "${gradle_wrapper_jar%/*}" \
    && cp "$gradle_wrapper_scratch/gradle/wrapper/gradle-wrapper.jar" "$gradle_wrapper_jar.tmp" \
    && mv "$gradle_wrapper_jar.tmp" "$gradle_wrapper_jar"; then
    :
  else
    gradle_wrapper_status=1
    rm -f "$gradle_wrapper_jar.tmp"
    echo "Error: could not generate $gradle_wrapper_jar." >&2
  fi
  rm -rf "$gradle_wrapper_scratch"
  return "$gradle_wrapper_status"
}
