# Dependency audit policy and triage

## Routine

With the repository's pinned Bun version, run `bun audit --json` after
[dependency updates](../dependency-upgrades.md), before a release, and during
monthly maintenance. Keep the output with the review; classify each finding with
`bun pm why <package>` and the actual consumer code. Run the full audit so
build, deploy, and test tools stay visible: a development dependency can still
process hostile input or run with deployment credentials.

For the Ruby graph, install the audit tool with `gem install bundler-audit`,
then run `bundle-audit check --update` from
[`packages/app-capacitor`](../../packages/app-capacitor/) against its
[`Gemfile.lock`](../../packages/app-capacitor/Gemfile.lock). Keep those results
with the review too.

Prioritize reachable production findings and high/critical findings in every
environment. Fix or mitigate those before release; any exception needs a named
owner, advisory/version, input and call-path evidence, review date, and removal
condition. Unknown reachability is unfinished triage. Lower-severity findings
also need classification, not silent suppression.

Prefer targeted updates within existing dependency ranges. If an upstream tool
pins a vulnerable transitive version, use a narrowly scoped compatible override
with a removal condition and validate that consumer. Do not force major
upgrades solely to clear an unused vulnerable API from the audit output.

The audit is a manual review step, not a CI or branch-protection gate.
`bun audit` reports the documented exceptions and exits nonzero; compare that
output with this record rather than ignoring it.

## Current record

This document lists the active overrides and exceptions; reconcile it on each
upgrade and remove resolved entries. Advisory counts and clean-audit claims
belong in the upgrade PR, since they describe one lockfile and advisory
snapshot. The `braces@3.0.3` exception was removed because
[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) was
withdrawn on October 23, 2026; its presence in the lockfile does not reactivate
that advisory. Re-triage if upstream publishes a replacement advisory.

The parent/version-scoped overrides require Bun lockfile format 3. Keep
developer and CI Bun versions aligned with [`.mise.toml`](../../.mise.toml); see
[Bun's override semantics](https://bun.com/docs/pm/overrides#nested-overrides).

## Temporary overrides

Owner: repository maintainers. Review by **2026-11-07**, or when upgrading the
named parent, whichever comes first. Remove each override once the parent
resolves a patched version itself and a fresh audit confirms it.
`bun run test:static-analysis` fails if an exact parent version named by an
override disappears or another version of that parent enters
[`bun.lock`](../../bun.lock), requiring its removal or a reviewed update. This
checks configuration drift; a fresh audit still determines safety. Nested
objects preserve npm consumer compatibility as well as Bun resolution. When
changing an override, validate the exact parent selectors with fresh resolutions
as well as the existing lockfile.

| Parent/version | Override | Advisory rationale and validation |
| --- | --- | --- |
| `markdownlint@0.42.0` | `re2js: 2.8.7` | Fixes [quadratic lookbehind matching](https://github.com/le0pard/re2js/security/advisories/GHSA-gg6h-894w-4m9c) in the exact-pinned 2.8.6. Use the security patch rather than forcing the later DFA-engine changes; the CLI regressions exercise repeated reversed links, Unicode link whitespace, line-length handling, and TOML options. Remove when Markdownlint selects a fixed release itself. |
| `miniflare@5.20260811.1-alpha` | `sharp: 0.35.5` | Fixes [librsvg memory corruption](https://github.com/advisories/GHSA-wq5f-xc86-pv6w). Check Wrangler-resolved Sharp's librsvg against the advisory, then exercise native SVG resize and the local Miniflare IMAGES binding with decoded pixel assertions. |
| `miniflare@5.20260811.1-alpha` | `undici: 7.30.1` | Replaces Miniflare's pinned 7.29.0 for [unbounded decompression](https://github.com/nodejs/undici/security/advisories/GHSA-3xpg-4rpp-hhhm), [WebSocket subprotocol denial of service](https://github.com/nodejs/undici/security/advisories/GHSA-rfgv-xxqx-mfg5), [excessive content-encoding crashes](https://github.com/nodejs/undici/security/advisories/GHSA-xjj6-f33q-929c), [EventSource memory exhaustion](https://github.com/nodejs/undici/security/advisories/GHSA-4qv8-2p9j-2685), and [integrity-token bypass](https://github.com/nodejs/undici/security/advisories/GHSA-f72v-6w45-q472); exercise local Miniflare requests and both Wrangler environment bundles against the retained HTTP API when changing this override. |

The Wrangler CLI stays at 4.123.0: authenticated account and binding discovery
is not a full state-owned preview of every staging and production resource.
Revisit when complete authenticated previews establish resource safety. Local
Miniflare checks and bundle dry runs do not establish live binding, route,
migration, or secret-sync safety.

## Markdownlint patch

Markdownlint CLI 0.24.0 parses TOML configuration with Smol-TOML 1.9.1, which
returns null-prototype objects. Unpatched, Markdownlint 0.42.0 discards those
nested rule options, silently changing line-length limits and enabling disabled
rules.
[`patches/markdownlint@0.42.0.patch`](../../patches/markdownlint@0.42.0.patch)
accepts them while handling ordinary objects as before. The CLI regression in
[`scripts/checks/staticAnalysis/markdownlintToml.test.ts`](../../scripts/checks/staticAnalysis/markdownlintToml.test.ts)
fails without the patch; it also checks glob ignores and malformed
configuration. Remove the patch when upstream preserves null-prototype rule
options and that regression passes without it. Owner: repository maintainers;
review by **2026-11-07**.

## Stripe client and server compatibility

Stripe.js 10 (`@stripe/stripe-js` 10.2.1 is locked) loads the Endive API
version; see its
[10.0 release notes](https://github.com/stripe/stripe-js/releases/tag/v10.0.0).
The [checkout](./stripe-checkout-client.md) does not use the Payment Request
Button or the Elements `paymentMethodTypes` option, both removed in 10.0.
[`packages/app-web/src/webDirectCheckout.ts`](../../packages/app-web/src/webDirectCheckout.ts)
uses the pure loader, a Payment Element with a server-created client secret, and
`confirmPayment`; it does not use Elements with Checkout Sessions. Email
collection is disabled only when the checkout supplies that email in
confirmation's `payment_method_data.billing_details`, which the checkout test
covers. Review the [Endive changes](https://docs.stripe.com/changelog/endive)
against that flow when changing its integration. When upgrading, compile the
checkout and keep its injected-loader tests for application lifecycle and error
handling; they do not exercise Stripe's remote SDK. Live payment validation is
unavailable without a test account.

The server pins REST API version 2024-06-20 (`STRIPE_API_VERSION` in
[`packages/api/src/billing/stripeHttp.ts`](../../packages/api/src/billing/stripeHttp.ts)).
Stripe.js uses its own release's API version; Stripe's [versioning
guidance](https://docs.stripe.com/sdks/stripejs-versioning) permits gradual
server upgrades. A server API migration needs separate webhook, invoice, and
subscription validation before changing that contract.

## Remaining exceptions

Owner: repository maintainers. Review by **2026-11-07**, or immediately if the
consumer/version or usage changes. These exceptions cover only the observed
call paths and advisories. Do not accept external input through these paths
without re-triage.

- **`esbuild@0.18.20`, moderate,
  [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99).**
  Path: development `drizzle-kit@0.31.11` → `@esbuild-kit/esm-loader@2.6.5` →
  `@esbuild-kit/core-utils@3.3.2`. The installed loader calls `transform`, not
  the vulnerable HTTP `serve` API. Keep its `~0.18.20` constraint; remove this
  exception when Drizzle replaces the loader or resolves esbuild >=0.25.0.
- **`glob@13.0.6`, moderate,
  [GHSA-3g3m-2fjr-6pw4](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4).**
  Path: `@capacitor/cli@8.6.0` → `rimraf@6.1.3`. The CLI calls
  `rimraf.sync` with repository-derived paths, without a glob option or an
  AbortSignal timeout. It does not expose traversal to application input.
  Keep the parent's glob 13 constraint rather than forcing a major upgrade;
  remove when rimraf adopts glob >=14.0.2. Re-triage before adding glob options
  or using cancellation to bound traversal.
- **`minimatch@5.1.9` and `10.2.6`, moderate,
  [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249).**
  Paths: `openapi-typescript@7.13.0` → `@redocly/openapi-core@1.34.20`, and
  Capacitor's rimraf/glob chain above. Redocly's `matchUrl` receives
  repository-owned OpenAPI configuration patterns, not application requests;
  Capacitor does not enable rimraf's glob branch. Do not accept untrusted
  patterns through either path. Remove when the owners support minimatch
  >=11.0.1; keep their current major API constraints until then.
- **`katex@0.16.47`, low,
  [GHSA-238p-pmpm-9mq7](https://github.com/advisories/GHSA-238p-pmpm-9mq7).**
  Path: `markdownlint@0.42.0` → `micromark-extension-math@3.1.0`. Lint reads
  repository Markdown; application rendering does not import this dependency.
  The advisory requires existing prototype pollution. Keep the owner's 0.16
  API constraint; remove when it supports KaTeX >=0.18.2 or drops the renderer.

Reproduce paths with `bun pm why <package>` and inspect the resolved packages
in `node_modules/.bun/`. Audit coverage is the locked npm and Ruby graphs;
platform native binaries additionally rely on their official advisories and
release notes, not on a claim that Bun audits every bundled system library.
