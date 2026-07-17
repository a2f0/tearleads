#!/bin/sh
# Runs a client bundle command with the build-identity env vars set, then execs
# it: `sh scripts/withBuildInfoEnv.sh bun build ...`.
#
# The App Host Config's `buildInfo` is what the System Monitor's Environment tab
# and its support report show, and each deployment target stamps it at its own
# entry point. Web and Electrobun both bundle through Bun, which inlines
# `BUN_PUBLIC_*`-prefixed vars into browser bundles, so both share this wrapper
# verbatim. Capacitor bundles through Vite and reads the same two values via
# `define` in its own vite.config.ts instead.
#
# Version comes from the invoking package's own package.json, so each target
# reports the version it is actually released under.
#
# Both values degrade to "unknown" instead of failing the build: release builds
# can run from a source tarball with no .git directory, and a support report that
# says "unknown" is more useful than a build that refuses to compile.
set -e

BUN_PUBLIC_GIT_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
BUN_PUBLIC_APP_VERSION="$(
  bun -e 'console.log(JSON.parse(await Bun.file("package.json").text()).version)' \
    2>/dev/null || echo unknown
)"
export BUN_PUBLIC_GIT_SHA
export BUN_PUBLIC_APP_VERSION

exec "$@"
