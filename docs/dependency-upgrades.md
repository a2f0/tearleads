# Dependency maintenance

Workspace versions live in `package.json`, package manifests, and `bun.lock`.
Toolchain versions live in `.mise.toml`; Terraform provider constraints and
lockfiles live beside each stack. Native dependency lockfiles and SQLite build
checksums are checked in with their owning packages.

Linux and macOS CI install each job's required tools from `.mise.toml` and
`mise.lock` through the pinned mise action. Keep Bun's `packageManager`
declaration aligned with its mise pin. Ruby keeps `ruby/setup-ruby` for Bundler
caching, and npm trusted publishing keeps `actions/setup-node`. Windows jobs
keep `oven-sh/setup-bun`; their Bun pins must match `.mise.toml`, since
`mise.lock` covers macOS arm64 and Linux x64, not Windows.

Astro's CLI uses Node even when Bun starts the website tests. Keep a supported
Node on `PATH` for local website builds; Astro 7.4.2 requires at least 22.23.4.
The CI build lane selects Node 24.22.1 LTS explicitly and includes its version
in `CI_TOOLCHAIN`, so a runner's ambient Node cannot determine or cache those
build results. The nightly `Uncached tests` workflow reuses that lane.

Shared agent workflows use an exact npm version of `@a2f0/agent-tool`.
After changing it, run `bun run agents:sync` and commit the lockfile, the managed
skill and permission manifests, the skills, and the generated
`.claude/settings.json` and `.codex/rules/agent-tool.rules` together. Check hook
installation and the branch, commit, CI-gate, and release-policy fixtures; the
repository's own Turbo verification and Java/TLA toolchain checks stay in place.
Run `bun run test:static-analysis` and `bun run test:npm-publish` before the
normal full gate.

## Current constraints

Revisit these constraints when updating their owning package or runtime, and
remove them when the stated checks pass without the pin.

- Biome stays on 2.5.15: in 2.6.2, `noInvalidGridAreas` compares grid row byte
  lengths instead of grid-cell counts and rejects valid layouts. Revisit with
  `bun run lint:biome` on a release that fixes the rule; keep the layout rules
  enabled.
- TypeScript stays on 6.0.3 while the lint scripts use its JavaScript compiler
  API. Move beyond that line only after those consumers and the static gates
  work with the replacement API; a passing compiler alone is insufficient.
- MSW stays on 2.15.0: 3.0.3 bypasses request handlers under pinned Bun 1.4.3.
  Revisit when MSW/Bun changes, proving interception and strict unhandled-request
  rejection under the pinned Bun runtime, not only Node.
- Electrobun consumes its generated Hutch SDK and TypeScript configuration.
  `prepare:devkit` prepares ignored SDK output before standalone checks.
  Keep the paired toolchain and Windows host-transport fix; validate macOS,
  Linux, and Windows when changing the pair, including the
  [Windows port-conflict regression](../packages/app-electrobun/README.md#native-persistence-checks).
- RevenueCat native SDK pins follow the Capacitor purchase bridge's dependency
  chain, including the direct Xcode package pin. Align those pins before
  rebuilding both native platforms; do not update transitive SDKs independently.
- Android uses AGP 9's built-in Kotlin support, compile SDK 37, AndroidX Core
  1.19.1, and the Capacitor template's Cordova 14.0.1. Biometric 8.9.1 supports
  the hidden `FingerprintManager` API through reflection. Keep target SDK 36
  until a separate Android behavior migration validates a higher target.
- Java 25 LTS remains the supported Android runtime with Gradle 9.8.2. Change
  the pair only after upstream compatibility and the Android build are verified.
- LocalStack 4.14.0 supports the local workflow without account credentials.
  Preserve that workflow when considering a newer release.
- CI uses PostgreSQL 18.6; staging and production each use an independent
  PlanetScale PostgreSQL stack. Validate each affected deployment's supported
  database version when changing this matrix.
- The Knip production-entry and Capacitor Swift-manifest patches retain their
  rationale and removal checks in [dependency patches](../patches/README.md).
  Security overrides and the Markdownlint patch are maintained with the
  [current advisory exceptions](developer/dependency-audit.md).

## Behavior to preserve

Run the relevant regressions and validate the affected integrations when
upgrading these dependencies:

- Zod/OpenAPI changes preserve registered wire contracts and tested runtime
  refinements. Crypto changes preserve recovery-key BIP39 phrases and complete
  identity key hashes in the deterministic test vectors.
- Sentry uses explicit `dataCollection` exclusions and server-only exports;
  preserve diagnostics allowlists and the
  [privacy regressions](../packages/diagnostics/src/collectionPolicy.test.ts).
- Loro cursor attribution uses each code point's first UTF-16 unit; retain
  the [astral-character and snapshot checks](../packages/loro/src/loro.test.ts)
  of operation identity.
- Stripe's client and server version contracts and live-test limits remain in
  the [payment compatibility notes](developer/dependency-audit.md#stripe-client-and-server-compatibility).

## Update workflow

Check upstream release instructions before changing a major version. Update
related package families together, regenerate the owning lockfiles, and run the
checks and builds that consume the changed dependencies. Run both Knip modes
when production dependencies change, and follow the
[dependency audit policy](developer/dependency-audit.md) for advisories.

Always run a complete preview before infrastructure apply or deployment; skip
upgrades that destroy, replace, recreate, or cannot establish safety. The current
state must own the live resources, and previews must use authenticated target
accounts. If ownership or credentials are unavailable, hold the affected
Terraform and Wrangler upgrades and record the reason in the PR.
Bundle builds and mocked Terraform tests validate code only.

Terraform provider updates require reviewed plans and lockfiles for Linux amd64
and macOS arm64. SQLite archive updates require a verified checksum and a rebuilt
wasm artifact. Preserve encrypted databases across SQLite runtime updates:
`packages/sqlite-worker/tests/cipherUpgrade.test.ts` opens historical encrypted
bytes through the production loader, checks the wrong-key boundary, and verifies
reads and writes after reopening. Keep that fixture when upgrading. The
pinned SQLite3MultipleCiphers 2.6.1
[ChaCha20 parameter table](https://github.com/utelle/SQLite3MultipleCiphers/blob/v2.6.1/src/cipher_chacha20.c#L14-L48)
keeps legacy mode 0 and 64007 key-derivation iterations; check those defaults
and persisted-file compatibility before changing the cipher or its version.
The memory OPFS shim exercises the real codec; browser OPFS checks remain
necessary for changes to the browser storage integration.
Native updates require their platform builds in addition to the
workspace checks. Deployments use the reviewed source and lockfiles; dependency
updates do not implicitly reset application databases.

Keep this document and the linked audit notes current: reconcile constraints
against the final dependency graph, update rationale and removal checks in
place, and remove resolved entries. Keep per-run inventories, old/new version
tables, audit results, validation and preview receipts, and skipped-work ledgers
in the upgrade PR. Use an existing sweep issue only when requested; do not
create one just to store evidence. README and AGENTS.md need only concise links.
Keep credentials, raw logs, state, and plans out of public records.
