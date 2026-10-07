# Dependency audit policy and triage

## Routine

Use the repository's pinned Bun version. Run `bun audit --json` after dependency
updates, before a release, and during monthly maintenance. Keep the output with
the review; use `bun pm why <package>` and inspect the actual consumer code to
classify each finding. Run the full audit so build, deploy, and test tools remain
visible. A development dependency can still process hostile input or run with
deployment credentials.

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

## Historical triage on 2026-09-10

Issue: [#1441](https://github.com/a2f0/tearleads/issues/1441).
The starting lockfile at `1fc32412687dabbb33c153d2f99d3032199256cf` produced
47 advisory records across 13 packages: 1 critical, 35 high, 10 moderate, 1 low.
These counts include multiple affected-version records for one advisory and
do not represent 47 demonstrated application vulnerabilities.

At that time, the full audit reported **two moderate records**,
documented below, and **zero high or critical records**. The records describe
this lockfile and advisory database snapshot, not a guarantee against future
advisories.

| Package/group | Consumer and disposition |
| --- | --- |
| `ws` | Runtime dependency through API/API CLI `@libsql/client` and its WebSocket transport; also test tooling. Updated vulnerable 8.20.0 to 8.21.3. |
| `fast-uri` | AJV used by repository tooling and schema-validation consumers. Updated 3.1.0 to 3.1.7 without relying on a reachability exception. |
| `tar`, `@xmldom/xmldom` | Capacitor CLI's archive and plist tooling. Updated to 7.5.22 and 0.9.12, including the critical archive-processing advisory. |
| `brace-expansion` | Tooling glob expansion. Updated the 2.x and 5.x copies to 2.1.4 and 5.0.9. |
| `browserslist`, `baseline-browser-mapping` | Build-target selection through Babel/website tooling. Updated to 4.28.9 and 2.11.21. |
| `svgo` | Astro SVG processing for the static website. Updated to 4.1.0; it is not an application upload sanitization boundary. |
| `js-yaml` | Astro/configuration and OpenAPI generation. Updated 4.x to 4.3.2, including the pinned Redocly copy via the override below. The existing 5.2.2 copy was not reported vulnerable. |
| `sharp` | Astro already uses 0.35.4; Wrangler's local emulator pinned 0.35.2. Override that copy to 0.35.4. |
| `smol-toml` | Markdownlint's configuration parser pinned 1.7.0. Override to 1.8.0, already used by Astro and Knip. |
| `esbuild` | Updating the transitive `tsx` to 4.23.13 removes its vulnerable 0.27.7 copy. The old Drizzle loader's 0.18.20 copy remains under the exception below. |
| `uuid` | Capacitor's Xcode project manipulation uses `uuid.v4()` only. Retain the upstream dependency under the exception below. |

The compatible transitive updates were generated with Bun, not by editing the
lockfile. The three parent/version-scoped overrides require lockfile format 3,
supported by the pinned Bun 1.4.2; keep developer and CI Bun versions aligned.
See [Bun's override semantics](https://bun.com/docs/pm/overrides#nested-overrides).

## Triage on 2026-10-07

The baseline at `8c8616054c269b7f78b44d4793df326b79c95104` reports
34 advisory records across 14 packages. The updated lockfile reports **four
records: one high, two moderate, and one low**, with the call paths below.
Latest direct releases do not remove all vulnerable transitive pins.
The Redocly YAML override was removed after openapi-typescript resolved
@redocly/openapi-core 1.34.20 and naturally selected fixed js-yaml 4.3.2.
The baseline Ruby audit also reports high-severity rubyzip 2.4.1
[path traversal](https://github.com/advisories/GHSA-47m2-wp7j-p9vc); Fastlane
2.240.1 naturally resolves the fixed rubyzip 3.4.0.
`bundle-audit check --update` reports no vulnerable gems against advisory database
commit `0af3fe207c318a8a99ce522c8538103a13eb6c0b`.

## Temporary overrides

Owner: repository maintainers. Review by **2026-11-07**, or when upgrading the
named parent, whichever comes first. Remove each override once the parent
resolves a patched version itself and a fresh audit confirms it.
`bun run test:static-analysis` fails if an exact parent version named by an
override disappears from `bun.lock`, requiring its removal or a reviewed update.
This checks configuration drift; a fresh audit still determines safety.
Nested objects preserve npm consumer compatibility as well as Bun resolution.

| Parent/version | Override | Advisory rationale and validation |
| --- | --- | --- |
| `markdownlint-cli2@0.23.3` | `smol-toml: 1.9.0` | Fixes [malformed TOML exhaustion](https://github.com/advisories/GHSA-r4xh-jqrq-34v2); the repository's TOML-configured Markdown lint runs against the updated parser. |
| `miniflare` | `sharp: 0.35.5` | Fixes [librsvg memory corruption](https://github.com/advisories/GHSA-wq5f-xc86-pv6w). Actual Wrangler-resolved Sharp reports librsvg 2.63.2; native SVG resize and the actual local Miniflare IMAGES binding convert a red SVG to a 12×8 PNG with decoded pixel checks. |
| `miniflare` | `undici: 7.29.1` | Updates the pinned 7.29.0 copy to its security patch; local Miniflare requests and both Wrangler environment bundles exercise the retained HTTP API. |

The Wrangler CLI remains at 4.123.0: a bundle dry run cannot prove live Worker
resource safety without deployment credentials and account identity. The local
Miniflare overrides do not change live bindings, routes, or migrations.

## Remaining exceptions

Owner: repository maintainers. Review by **2026-11-07**, or immediately if the
consumer/version or usage changes. These exceptions cover only the observed
call paths and advisories. Do not accept external input through these paths
without re-triage.

- **`braces@3.0.3`, high,
  [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).**
  No patched release exists. Markdownlint tooling
  reaches it through micromatch/fast-glob. Patterns come from repository-owned
  configuration and CLI arguments, not application requests or uploaded data.
  Accept the unresolved tooling finding with that trusted-pattern boundary;
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
  removes this dependency. Native regeneration and simulator builds pass.
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
