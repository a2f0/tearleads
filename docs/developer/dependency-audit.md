# Dependency audit policy and triage

## Routine

Use the repository's pinned Bun version. Run `bun audit --json` after dependency
updates, before a release, and during monthly maintenance. Keep the output with
the review; use `bun pm why <package>` and inspect the actual consumer code to
classify each finding. Run the full audit so build, deploy, and test tools remain
visible. A development dependency can still process hostile input or run with
deployment credentials.

For the Ruby graph, install the audit tool with `gem install bundler-audit`, then
run `bundle-audit check --update` from `packages/app-capacitor` against its
`Gemfile.lock`. Keep those results with the review too.

Prioritize reachable production findings and high/critical findings in every
environment. Fix or mitigate those before release; any exception needs a named
owner, advisory/version, input and call-path evidence, review date, and removal
condition. Unknown reachability is unfinished triage. Lower-severity findings
also need classification, rather than silent suppression.

Prefer targeted updates within the existing dependency ranges. If an upstream
tool pins a vulnerable transitive version, use a narrowly scoped compatible
override with a removal condition and validate that consumer. Avoid forcing
major upgrades solely to clear an unused vulnerable API from the audit output.

The audit remains a manual review step, without a new CI or branch-protection
gate. `bun audit` intentionally continues to report documented exceptions and
exit nonzero; that output must be compared with this record, not ignored.

## Current record

The active overrides and exceptions below were last reconciled in
[#2474](https://github.com/a2f0/tearleads/pull/2474). That PR and the earlier
[triage issue #1441](https://github.com/a2f0/tearleads/issues/1441) retain completed
fixes and historical evidence. Advisory counts and clean-audit claims belong
in the upgrade PR because they describe a particular lockfile and advisory
snapshot. Reconcile this document on each upgrade and remove resolved entries.

The parent/version-scoped overrides require Bun lockfile format 3. Keep
developer and CI Bun versions aligned with `.mise.toml`; use
[Bun's override semantics](https://bun.com/docs/pm/overrides#nested-overrides).

## Temporary overrides

Owner: repository maintainers. Review by **2026-11-07**, or when upgrading the
named parent, whichever comes first. Remove each override once the parent
resolves a patched version itself and a fresh audit confirms it.
`bun run test:static-analysis` fails if an exact parent version named by an
override disappears or another version of that parent enters `bun.lock`,
requiring its removal or a reviewed update.
This checks configuration drift; a fresh audit still determines safety.
Nested objects preserve npm consumer compatibility as well as Bun resolution.
Validate the exact parent selectors with fresh resolutions as well as the
existing lockfile when changing an override.

| Parent/version | Override | Advisory rationale and validation |
| --- | --- | --- |
| `markdownlint-cli2@0.23.3` | `smol-toml: 1.9.0` | Fixes [malformed TOML exhaustion](https://github.com/advisories/GHSA-r4xh-jqrq-34v2); run the actual Markdown linter and the TOML compatibility fixture when updating it. |
| `miniflare@5.20260811.1-alpha` | `sharp: 0.35.5` | Fixes [librsvg memory corruption](https://github.com/advisories/GHSA-wq5f-xc86-pv6w). Check Wrangler-resolved Sharp's librsvg against the advisory, then exercise native SVG resize and the local Miniflare IMAGES binding with decoded pixel assertions. |
| `miniflare@5.20260811.1-alpha` | `undici: 7.29.1` | Updates the pinned 7.29.0 copy for [unbounded decompression](https://github.com/nodejs/undici/security/advisories/GHSA-3xpg-4rpp-hhhm) and [WebSocket subprotocol denial of service](https://github.com/nodejs/undici/security/advisories/GHSA-rfgv-xxqx-mfg5); exercise local Miniflare requests and both Wrangler environment bundles against the retained HTTP API when changing this override. |

The Wrangler CLI remains at 4.123.0: a bundle dry run cannot prove live Worker
resource safety without deployment credentials and account identity. Revisit
when complete authenticated previews establish resource safety. Local Miniflare
override checks do not establish live binding, route, or migration safety.

Smol-TOML 1.9 returns null-prototype objects. Markdownlint 0.41.1 otherwise
discards nested rule options, silently changing line-length limits and enabling
disabled rules. `patches/markdownlint@0.41.1.patch` accepts those objects while
preserving its previous handling of ordinary objects. The actual CLI regression
in `scripts/checks/staticAnalysis/markdownlintToml.test.ts` failed without the
patch and passes with it; it also checks glob ignores and malformed configuration.
Remove the patch when upstream preserves null-prototype rule options and those
regressions pass without it. Review it with the parser override by 2026-11-07.

## Stripe client and server compatibility

The [10.0 release](https://github.com/stripe/stripe-js/releases/tag/v10.0.0)
loads Endive rather than Dahlia. Its removed Payment Request Button and Elements
`paymentMethodTypes` option are absent from our checkout. `webDirectCheckout.ts`
uses the pure loader, a Payment Element with a server-created client secret, and
`confirmPayment`; it does not use Elements with Checkout Sessions. Email
collection is disabled only when we supply that email in confirmation's
`payment_method_data.billing_details`, covered by the existing checkout test.
Review the [Endive changes](https://docs.stripe.com/changelog/endive) against
that flow when changing its integration.
When upgrading, compile the checkout and retain its injected-loader tests for
application lifecycle and error handling; they do not exercise Stripe's
remote SDK.
Live payment validation remains unavailable without a test account.

The server's explicit REST API version remains 2024-06-20. Stripe.js uses its own
release's API version; Stripe's
[versioning guidance](https://docs.stripe.com/sdks/stripejs-versioning) permits
gradual server upgrades. A server API migration needs separate webhook, invoice,
and subscription validation before changing that contract.

## Remaining exceptions

Owner: repository maintainers. Review by **2026-11-07**, or immediately if the
consumer/version or usage changes. These exceptions cover only the observed
call paths and advisories. Do not accept external input through these paths
without re-triage.

- **`braces@3.0.3`, high,
  [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).**
  The retained Markdownlint tooling path
  reaches it through micromatch/fast-glob. Patterns come from repository-owned
  configuration and CLI arguments, not application requests or uploaded data.
  Accept the unresolved tooling finding with that trusted-pattern boundary;
  re-triage immediately if micromatch/fast-glob enters runtime code or accepts
  untrusted patterns, including application requests or uploaded data;
  update promptly when an owning dependency resolves a fixed release.
- **`esbuild@0.18.20`, moderate,
  [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99).**
  Path: development `drizzle-kit@0.31.11` → `@esbuild-kit/esm-loader@2.6.5` →
  `@esbuild-kit/core-utils@3.3.2`. The installed loader calls `transform`, not
  the vulnerable HTTP `serve` API. Keep its `~0.18.20` constraint; remove this
  exception when Drizzle replaces the loader or resolves esbuild >=0.25.0.
- **`uuid@7.0.3`, moderate,
  [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq).**
  Path: `@capacitor/cli@8.5.3` → `xcode@3.0.1`. `pbxProject.generateUuid`
  uses only `uuid.v4()` without an output buffer; the affected `v3`/`v5`/`v6`
  buffer APIs are absent. Remove when Xcode tooling adopts uuid >=11.1.1 or
  removes this dependency. Revalidate native regeneration and simulator builds
  when changing this tooling.
- **`katex@0.16.47`, low,
  [GHSA-238p-pmpm-9mq7](https://github.com/advisories/GHSA-238p-pmpm-9mq7).**
  Path: `markdownlint@0.41.1` → `micromark-extension-math@3.1.0`. Lint reads
  repository Markdown; application rendering does not import this dependency.
  The advisory requires existing prototype pollution. Keep the owner's 0.16
  API constraint; remove when it supports KaTeX >=0.18.2 or drops the renderer.

Reproduce paths with `bun pm why <package>` and inspect the resolved packages
in `node_modules/.bun/`. Audit coverage is the locked npm and Ruby graphs;
platform native binaries additionally rely on their official advisories and
release notes, rather than a claim that Bun audits every bundled system library.
