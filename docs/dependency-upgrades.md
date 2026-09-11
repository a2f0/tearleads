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

Terraform provider updates require reviewed plans and lockfiles for Linux amd64
and macOS arm64. SQLite archive updates require a verified checksum and a rebuilt
wasm artifact. Native updates require their platform builds in addition to the
workspace checks. Deployments use the reviewed source and lockfiles; dependency
updates do not implicitly reset application databases.
