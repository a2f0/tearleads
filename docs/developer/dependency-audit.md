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

## Triage on 2026-09-10

Issue: [#1441](https://github.com/a2f0/tearleads/issues/1441).
The starting lockfile at `1fc32412687dabbb33c153d2f99d3032199256cf` produced
47 advisory records across 13 packages: 1 critical, 35 high, 10 moderate, 1 low.
These counts include multiple affected-version records for one advisory and
do not represent 47 demonstrated application vulnerabilities.

After the updates below, the full audit reports **two moderate records**,
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

## Temporary overrides

Owner: repository maintainers. Review by **2026-10-10**, or when upgrading the
named parent, whichever comes first. Remove each override once the parent
resolves a patched version itself and a fresh audit confirms it.
`bun run test:static-analysis` fails if an exact parent version named by an
override disappears from `bun.lock`, requiring its removal or a reviewed update.
This checks configuration drift; a fresh audit still determines whether the
replacement dependency is safe.

| Parent/version | Override | Advisory rationale |
| --- | --- | --- |
| `@redocly/openapi-core@1.34.17` | `js-yaml: 4.3.2` | Fixes [merge-key CPU exhaustion](https://github.com/advisories/GHSA-52cp-r559-cp3m), [ordered-map CPU exhaustion](https://github.com/advisories/GHSA-5p4m-2wfm-xmqj), and [empty-merge-source bypass](https://github.com/advisories/GHSA-2883-xcg3-v3hh) while retaining the 4.x API. |
| `markdownlint-cli2@0.23.2` | `smol-toml: 1.8.0` | Fixes [malformed-TOML denial of service](https://github.com/advisories/GHSA-7w5x-hrqm-74c2). |
| `miniflare@5.20260811.1-alpha` | `sharp: 0.35.4` | Fixes [bundled libheif vulnerabilities](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c) in Wrangler's local image processing. |

## Remaining exceptions

Owner: repository maintainers. Review by **2026-10-10**, or immediately if the
consumer/version or usage changes. Neither exception covers new runtime imports,
new input paths, or other advisories against the same package.

- **`esbuild@0.18.20`, moderate,
  [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99).**
  Path: `@tearleads/api-shared` development dependency `drizzle-kit@0.31.10` →
  `@esbuild-kit/esm-loader@2.6.5` → `@esbuild-kit/core-utils@3.3.2` → esbuild.
  Repository scripts use Drizzle Kit for migration generation; the installed
  core-utils code calls esbuild's `transform` API, not its HTTP server. The
  advisory requires esbuild's `serve` feature. Accept this unused vulnerable
  feature instead of forcing the loader across its `~0.18.20` constraint.
  Remove the exception when Drizzle replaces the loader or resolves esbuild
  >=0.25.0. Re-triage before enabling an esbuild server through this dependency.
- **`uuid@7.0.3`, moderate,
  [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq).**
  Path: `app-capacitor` development dependency `@capacitor/cli@8.5.1` →
  `xcode@3.0.1` → uuid. Inspection of `xcode/lib/pbxProject.js` finds only
  `uuid.v4()` with no output buffer in `generateUuid`. The advisory concerns
  `v3`/`v5`/`v6` with caller-supplied output buffers; that call path is absent.
  Accept the current upstream pin instead of forcing a multi-major upgrade.
  Remove the exception when Xcode tooling adopts uuid >=11.1.1 or removes it.

Reproduce the dependency paths with `bun pm why esbuild` and `bun pm why uuid`.
Inspect the resolved packages in `node_modules/.bun/` after installation. These
exceptions are based on the observed APIs, not merely their dev-dependency labels.
