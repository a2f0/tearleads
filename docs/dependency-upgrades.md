# Dependency maintenance

Workspace versions live in `package.json`, package manifests, and `bun.lock`.
Toolchain versions live in `.mise.toml`; Terraform provider constraints and
lockfiles live beside each stack. Native dependency lockfiles and SQLite build
checksums are checked in with their owning packages.

## Current constraints

- TypeScript stays on 6.0.3 while the repository's lint scripts use its
  JavaScript compiler API.
- Electrobun consumes its generated Hutch SDK and TypeScript configuration.
  `prepare:devkit` prepares the ignored SDK output before standalone checks.
  Electrobun 2.0.2 pairs with Hutch 0.27.1 and includes the Windows
  host-transport listener fix. Validate macOS, Linux, and Windows when updating
  this pair.
- Redis uses RESP2, explicit keepalive settings, and disabled command timeouts
  for session and realtime connections.
- Zod schemas define runtime validation; OpenAPI generation preserves the
  registered wire contracts and their tested runtime refinements.
- Recovery-key test vectors pin BIP39 phrases and complete identity key hashes.
  Crypto dependency updates must preserve deterministic identity derivation.
- RevenueCat native SDK pins follow the Capacitor purchase bridge's dependency
  chain. Android uses the built-in Kotlin support in AGP 9.
- Android uses compile SDK 36 and AndroidX Core 1.18.0. Its biometric plugin
  still depends on `FingerprintManager`, which prevents using SDK 37.
- LocalStack 4.14.0 supports the repository's local workflow without account
  credentials.
- CI uses PostgreSQL 18.6; staging uses distribution-managed PostgreSQL 16.
  Production uses the independent PlanetScale PostgreSQL stack.
- Knip's production-entry patch and its removal condition are documented in
  [dependency patches](../patches/README.md).

## Update workflow

Check upstream release instructions before changing a major version. Update
related package families together, regenerate the owning lockfiles, and run the
checks and builds that consume the changed dependencies. Run both Knip modes
when production dependencies change, and follow the
[dependency audit policy](developer/dependency-audit.md) for advisories.

Always run a complete preview before infrastructure apply or deployment; skip
upgrades that destroy, replace, recreate, or cannot establish safety. The current
production server state is empty while live resources remain owned by the old
Symcrypt state, so it cannot establish a safe production preview. Missing live
credentials also hold Wrangler and Ansible deployment upgrades. Bundle builds
and mocked Terraform tests validate code only.

Terraform provider updates require reviewed plans and lockfiles for Linux amd64
and macOS arm64. SQLite archive updates require a verified checksum and a rebuilt
wasm artifact. Native updates require their platform builds in addition to the
workspace checks. Deployments use the reviewed source and lockfiles; dependency
updates do not implicitly reset application databases.

## October 2026 migrations

Sentry 11 uses explicit `dataCollection` exclusions and server-only exports;
retain the diagnostics allowlists and privacy regression tests. MSW stays on
2.15.0: 3.0.2 bypasses request handlers under pinned Bun 1.4.2, although the
same minimal request works under Node 24. Preserve strict unhandled-request
rejection until upstream interception supports this Bun runtime.
Dependency-cruiser tests use
its installed `depcruise` command alias rather than an internal filename.
Biome's official migration updates both configuration schemas and presets.
Loro 1.16.4 cursor attribution uses each code point's first UTF-16 unit; the
existing astral-character and snapshot tests preserve operation identity.

Capacitor 8.5.3 regenerates Android settings and Swift package references.
RevenueCat 13.7.0 selects hybrid-common 19.5.0, Android SDK 10.24.0, and iOS SDK
5.92.0; keep the Xcode direct package pin aligned too. Java 25 LTS supports Gradle
9.8.0, while Java 27 does not. Keep the Capacitor template's Cordova 14.0.1 and
SDK 36; AndroidX Core 1.19 requires SDK 37. Ruby 4.0.7 and Bundler 4.0.22 produce
the Fastlane 2.240.1 lockfile. Gradle scripts use explicit property assignment and
project extension references; remaining AGP/Capacitor plugin deprecations are
upstream warnings rather than suppressed repository errors.
