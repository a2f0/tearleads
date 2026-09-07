# Dependency upgrades

The September 2026 refresh updates the Bun workspace and lockfile, native
purchase bridges, Ruby gems, Ansible collections, Terraform providers, GitHub
Actions, SQLite build, and mise toolchain. Versions were checked against upstream
registries and release instructions; the exceptions below are deliberate.

## Migrations applied

- **TypeScript 6:** add ambient CSS declarations for checked side-effect imports
  and explicit Bun types for Astro 7. Keep TypeScript 6.0.3 because TypeScript 7
  removes the JavaScript compiler API used by the repository's lint scripts.
  Migrate those scripts before changing this pin. See the
  [TypeScript 6 release notes](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html).
- **Vite 8 and Astro 7:** upgrade their React integrations together; validate the
  resulting web, website, and native web-asset builds against the
  [Vite migration guide](https://vite.dev/guide/migration) and
  [Astro upgrade guide](https://docs.astro.build/en/guides/upgrade-to/v7/).
- **Electrobun 2:** use the paired Hutch SDK through `electrobun sync`, extend its
  generated TypeScript configuration, and retain the Bun main process explicitly.
  Public renderer environment values use bundler `define` entries, including
  explicit `undefined` values for optional settings in WebViews without Node.
  The empty root TypeScript solution can reference this non-composite leaf;
  `tsc --build` checks its imported SDK without unrelated vendor test sources.
  The SDK
  lives in ignored `.hutch/` output and is prepared by the repository checks.
  Follow the [Electrobun 2 migration guide](https://github.com/blackboardsh/electrobun/blob/main/docs/src/content/docs/electrobun/guides/migrating-to-v2.mdx).
- **Redis client 6:** explicitly retain RESP2, the prior keepalive delay, and
  disabled command timeouts for sessions and realtime subscriptions. Validate
  both key expiry and pub/sub against a local Redis server. See the
  [Redis client migration guide](https://github.com/redis/node-redis/blob/master/docs/v5-to-v6.md).
- **Zod:** retain the existing OpenAPI union encoding while using the updated
  runtime validators. JSON Schema validation tests cover nullable and
  discriminated unions, overlapping XOR branches, and literal metadata.
  The generated OpenAPI document remains unchanged; no compatibility waiver is
  needed. See [Zod JSON Schema conversion](https://zod.dev/json-schema).
- **Hono:** avoid duplicating the compression middleware's `Vary` header.
  Cache-variation tests assert both Origin and Accept-Encoding, independent of
  header order, for normal and revalidated attribution responses. See the
  [compression middleware documentation](https://hono.dev/docs/middleware/builtin/compress).
- **Noble and Scure:** review the
  [post-quantum changelog](https://github.com/paulmillr/noble-post-quantum/releases),
  [hash changes](https://github.com/paulmillr/noble-hashes/releases), and
  [BIP39 changes](https://github.com/paulmillr/scure-bip39/releases). The removed
  hybrid aliases and stricter malformed-input checks do not change the app's
  ML-DSA-87 / ML-KEM-1024 identity derivation. Fixed vectors captured with the
  previous dependencies pin both BIP39 phrases and all four complete key hashes;
  both old and new packages recover identical identities.
- **Stripe.js 9:** the [major release changes](https://github.com/stripe/stripe-js/releases/tag/v9.0.0)
  affect `elements.update`'s return type and removed/renamed APIs not used by
  direct checkout. The existing `/pure` loader, `elements`, and `confirmPayment`
  integration still typechecks and passes its checkout tests.
- **Bun:** invalid HTTP statuses are reported without awaiting cancellation of a
  cloned response body. Cancellation can wait for the other branch; the client
  regression tests cover that case without weakening status validation.
- **Biome and Knip:** migrate the Biome configuration and apply its formatting
  changes. Preserve the existing CSS cascade by disabling the new descending
  specificity rule. Knip's stricter checks remove unused private exports, while
  types needed by declaration emit remain exported. Two source-size baselines
  change only for formatter expansion of existing tests; the subsystem registry
  grows by one entry for the shared Redis client factory.
  Knip's production-entry patch is still needed in 6.34.0: the production
  reachability regression fails without it and passes with it. The patch and
  its removal condition live in [dependency patches](../patches/README.md).
- **Android:** regenerate the Gradle 9.7.1 wrapper and verify its distribution
  checksum. AGP 9.4 uses built-in Kotlin, so the application no longer applies
  the duplicate Kotlin Android plugin. See the
  [built-in Kotlin migration](https://developer.android.com/build/migrate-to-built-in-kotlin).
- **RevenueCat and Capacitor:** synchronize Capacitor 8.5.1 and regenerate native
  project references. RevenueCat Capacitor 13.5.0 selects hybrid 18.33.1,
  Android purchases 10.19.1, and iOS purchases 5.87.1; native pins follow that
  dependency chain instead of independently choosing incompatible SDK versions.
  See the [RevenueCat releases](https://github.com/RevenueCat/purchases-capacitor/releases)
  and [Capacitor 8 guide](https://capacitorjs.com/docs/updating/8-0).
- **Ansible:** upgrade core/lint and collection pins together. Replace deprecated
  `postgresql_set` with `postgresql_alter_system` and its `param` argument, and
  replace the privileges module's `db` alias with `login_db`. See the
  [PostgreSQL collection changelog](https://github.com/ansible-collections/community.postgresql/blob/main/CHANGELOG.rst).
- **Garage:** upgrade 2.3 to 2.4 with verified per-architecture binary checksums.
  Its [release notes](https://git.deuxfleurs.fr/Deuxfleurs/garage/releases/tag/v2.4.0)
  report no breaking changes from 2.3. Before rollout, follow the
  [upgrade procedure](https://garagehq.deuxfleurs.fr/documentation/operations/upgrading/)
  and check cluster health and backups.
- **Terraform:** use Terraform 1.16.1 and current compatible provider versions;
  commit provider lockfiles with Linux amd64 and macOS arm64 hashes. Run
  `terraform init -upgrade` and review a fresh plan before rollout, as described
  in the [provider upgrade instructions](https://developer.hashicorp.com/terraform/language/providers/requirements).
- **SQLite:** update SQLite3MultipleCiphers to 2.5.1 / SQLite 3.53.4, verify the
  source archive checksum, and invalidate the generated wasm cache by archive
  version. The [release artifacts](https://github.com/utelle/SQLite3MultipleCiphers/releases/tag/v2.5.1)
  remain the source of the generated output.

## Supported-line exceptions and rollout

Android retains compile SDK 36 and AndroidX Core 1.18.0: Core 1.19 requires SDK
37, where the current Capgo biometric plugin fails to compile because
`FingerprintManager` was removed. Revisit these pins when the plugin migrates.
Cordova Android 14 remains aligned with Capacitor 8. Java receives the latest
Temurin 21 maintenance release used by the native build and formal checks.

LocalStack uses 4.14.0, the last community release usable by the existing local
workflow without account credentials. Newer releases require an authenticated
workflow; see the [LocalStack announcement](https://blog.localstack.cloud/the-road-ahead-for-localstack/).
The AWS CLI helper image is updated separately.

CI's disposable PostgreSQL service moves to 18.6. The Ansible-managed PostgreSQL
16 data directory stays on its supported distribution release; switching its
major version requires a backup and explicit `pg_upgrade` or dump/restore,
not just replacing the package name. Other unversioned apt packages continue to
follow their configured repositories. See
[PostgreSQL cluster upgrades](https://www.postgresql.org/docs/18/upgrading.html).

No Terraform apply or destroy is part of this refresh. The staging plan reports
no changes. The configured production state is empty and plans 13 creates,
zero updates, and zero destroys; confirm the intended production state before
applying it. Application, database, and Garage rollout remain separate from
merging dependency declarations.
