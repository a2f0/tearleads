#!/bin/sh
# Runs a client bundle command with the build-identity env vars set, then execs
# it: `sh scripts/lib/withBuildInfoEnv.sh bun build ...`.
#
# The App Host Config's `buildInfo` is what the System Monitor's Environment tab
# and its support report show, and each deployment target stamps it at its own
# entry point. Web uses Bun's environment passthrough; Electrobun uses explicit
# renderer defines for these same variables, so both share this wrapper.
# Capacitor bundles through Vite and reads the same two values via
# `define` in its own vite.config.ts instead.
#
# Version comes from the invoking package's own package.json, so each target
# reports the version it is actually released under.
#
# Both values degrade to "unknown" instead of failing the build: release builds
# can run from a source tarball with no .git directory, and a support report that
# says "unknown" is more useful than a build that refuses to compile.
set -e

# A source archive has no Git directory; a Linux release container receives the
# commit it was exported from as BUILD_GIT_SHA. A checkout always shows its own
# HEAD.
BUN_PUBLIC_GIT_SHA="$(
  if git rev-parse --short HEAD 2>/dev/null; then
    :
  elif [ -n "${BUILD_GIT_SHA:-}" ]; then
    printf '%.7s\n' "$BUILD_GIT_SHA"
  else
    echo unknown
  fi
)"
# Read without dotenv files or a working-directory bunfig.toml: a desktop
# release runs this before it checks that its checkout holds no untracked file,
# so a preload either names would run first.
BUN_PUBLIC_APP_VERSION="$(
  bun --no-env-file --config=/dev/null \
    -e 'console.log(JSON.parse(await Bun.file("package.json").text()).version)' \
    2>/dev/null || echo unknown
)"
export BUN_PUBLIC_GIT_SHA
export BUN_PUBLIC_APP_VERSION

exec "$@"
