# Dependency patches

## Capacitor CLI 8.6.0

`@capacitor-cli-8.6.0-ios18.patch` makes generated iOS Swift Package manifests
spell the deployment target as `.iOS("18.0")`. Capacitor emits `.iOS(.v18)`
with a Swift 5.9 tools declaration; `.v18` is unavailable to the macOS CI
compiler, so synchronized iOS builds fail before compiling the app. The string
form keeps the iOS 18 floor without raising the Swift tools version. Remove the
patch when Capacitor generates compatible manifests upstream.

## Markdownlint 0.42.0

`markdownlint@0.42.0.patch` accepts the null-prototype nested rule options
that Smol-TOML 1.9 produces. Otherwise the normalizer silently discards those
options, changing custom line-length limits and disabled rules. Ordinary
objects are handled as before.

Remove it when upstream accepts those options and
`bun test scripts/checks/staticAnalysis/markdownlintToml.test.ts` passes without
the patch. The [dependency audit policy](../docs/developer/dependency-audit.md)
records its owner and review date.
