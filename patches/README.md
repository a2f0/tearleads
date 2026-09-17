# Dependency patches

## Capacitor CLI 8.5.1

`@capacitor-cli-8.5.1-ios18.patch` makes generated iOS Swift Package manifests
spell the deployment target as `.iOS("18.0")`. Capacitor emits `.iOS(.v18)`
with a Swift 5.9 tools declaration; `.v18` is unavailable to the macOS CI
compiler, so synchronized iOS builds fail before compiling the app. The string
form keeps the iOS 18 floor without raising the Swift tools version. Remove the
patch when Capacitor generates compatible manifests upstream.

## Knip 6.34.0

`knip-6.34.0.patch` preserves the production flag on entries discovered from
production package scripts, such as `start`. Without it, Knip classifies
`bun src/index.ts` as a development entry and excludes it even when the
configuration explicitly marks `src/index.ts!` as a production root.

Related upstream report: [production mode broken (#1000)](https://github.com/webpro-nl/knip/issues/1000)
documents the same start-script exclusion with Node. The Bun reproduction is
covered by this repository's regression fixture.

The patch changes only production analysis. Remove it when an upstream release
passes `bun run test:knip:production` without the patch. That regression also
requires modules reachable only through tests to remain unused, and preserves
public SDK source exports whose manifest targets generated `dist` files.
