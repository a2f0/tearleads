# Dependency patches

## Capacitor CLI 8.5.3

`@capacitor-cli-8.5.3-ios18.patch` makes generated iOS Swift Package manifests
spell the deployment target as `.iOS("18.0")`. Capacitor emits `.iOS(.v18)`
with a Swift 5.9 tools declaration; `.v18` is unavailable to the macOS CI
compiler, so synchronized iOS builds fail before compiling the app. The string
form keeps the iOS 18 floor without raising the Swift tools version. Remove the
patch when Capacitor generates compatible manifests upstream.

## Knip 6.42.1

`knip@6.42.1.patch` preserves the production flag on entries discovered from
production package scripts, such as `start`. Without it, Knip classifies
`bun src/index.ts` as a development entry and excludes it even when the
configuration explicitly marks `src/index.ts!` as a production root.

The patch changes only production analysis. Remove it when an upstream release
passes `bun run test:knip:production` without the patch. That regression also
requires modules reachable only through tests to remain unused, and preserves
public SDK source exports whose manifest targets generated `dist` files.

## Markdownlint 0.42.0

`markdownlint@0.42.0.patch` accepts the null-prototype nested rule options
that Smol-TOML 1.9 produces. Otherwise the normalizer silently discards those
options, changing custom line-length limits and disabled rules. Ordinary
objects are handled as before.

Remove it when upstream accepts those options and
`bun test scripts/checks/staticAnalysis/markdownlintToml.test.ts` passes without
the patch. The [dependency audit policy](../docs/developer/dependency-audit.md)
records its owner and review date.
