# Private error diagnostics

The web app, Android and iOS WebViews, the Electrobun desktop renderer and main
process, and the API report to separate Sentry projects for staging and
production. Reporting is disabled without the corresponding DSN. Development,
the two-identity demo, and the website remain local.

## Account setup

The `tearleads` organization uses these projects:

| Target | Staging | Production |
| --- | --- | --- |
| Web | `tearleads-web-staging` | `tearleads-web-production` |
| API | `tearleads-api-staging` | `tearleads-api-production` |
| Android | `tearleads-android-staging` | `tearleads-android-production` |
| iOS | `tearleads-ios-staging` | `tearleads-ios-production` |
| Electrobun | `tearleads-electrobun-staging` | `tearleads-electrobun-production` |

Keep **Prevent Storing of IP Addresses**, default data scrubbing, and data
scrubbing enabled in every project. Copy DSNs from **Settings → Projects →
project → Client Keys (DSN)**. Hosted US, EU, and legacy ingestion URLs work.

Each tier's ignored `.secrets/<tier>/shared.env` holds `SENTRY_ORG=tearleads`
and `SENTRY_AUTH_TOKEN`. The latter needs source-map upload access and stays in
the build/deploy process. It must never have a `VITE_` or `BUN_PUBLIC_` prefix.

Configure these variables in `.secrets/staging/app.env`; use `PRODUCTION`
instead of `STAGING` in `.secrets/prod/app.env`:

```sh
SENTRY_STAGING_PROJECT='tearleads-web-staging'
SENTRY_STAGING_DSN='https://PUBLIC_KEY@oORG.ingest.us.sentry.io/PROJECT_ID'
SENTRY_API_STAGING_DSN='https://PUBLIC_KEY@oORG.ingest.us.sentry.io/PROJECT_ID'
SENTRY_API_STAGING_PROJECT='tearleads-api-staging'
SENTRY_ANDROID_STAGING_PROJECT='tearleads-android-staging'
SENTRY_ANDROID_STAGING_DSN='https://PUBLIC_KEY@oORG.ingest.us.sentry.io/PROJECT_ID'
SENTRY_IOS_STAGING_PROJECT='tearleads-ios-staging'
SENTRY_IOS_STAGING_DSN='https://PUBLIC_KEY@oORG.ingest.us.sentry.io/PROJECT_ID'
SENTRY_ELECTROBUN_STAGING_PROJECT='tearleads-electrobun-staging'
SENTRY_ELECTROBUN_STAGING_DSN='https://PUBLIC_KEY@oORG.ingest.us.sentry.io/PROJECT_ID'
```

The DSNs above are placeholders. DSNs are public; the upload token is private.
API project slugs default to `tearleads-api-staging` and
`tearleads-api-production`; the corresponding tier variable can override them.

## Deployment and releases

[`scripts/deploy/deployStaging.sh`](../../scripts/deploy/deployStaging.sh) and [`scripts/deploy/deployProduction.sh`](../../scripts/deploy/deployProduction.sh)
publish the API Worker and web app. The API deploy syncs `API_SENTRY_DSN`,
builds once with its tier and commit, uploads the matching source map to Sentry,
then publishes that bundle and map to Cloudflare. Configured diagnostics require
a clean checkout and a successful map upload before migrations or publication.
See [API diagnostics](api-sentry.md) for release identity and frame admission.

The build number is `git rev-list --count HEAD` at build time. The default
branch only gains squash-merged commits, so every deploy from it counts higher
than the one before. The API sends it on every response as
`X-Tearleads-Api-Version` (exposed to cross-origin clients); shallow clones,
source archives, and source runs omit it. A branch build counts its own commits
on top of the merge base, so only default-branch deploys are comparable.

Clients keep the number from the latest response in memory
(`tearleads.apiVersion`), tag their Sentry reports with it as `api_version`,
and show it as **API Version** in the System Monitor's Environment tab and
support report. It is not persisted: a stored value would misattribute the
first failures after a redeploy.

Web deployment selects the tier DSN, builds, uploads maps, then publishes
assets. Missing upload credentials or an upload failure stop a configured
deployment.

Google Play builds and iOS TestFlight builds invoke `bun run build:release
android` or `bun run build:release ios` in `packages/app-capacitor`.
`NATIVE_RELEASE_TIER` selects `staging` or `production` (default). The builder
reads the selected tier's `shared.env` and `app.env` (from
`NATIVE_RELEASE_SECRETS_DIR` when set, as the Fastlane lanes do), injects only
the selected public Sentry configuration, uploads maps, and removes them before
Capacitor packaging. Publishing maps requires a clean Git checkout; staged,
modified, or untracked sources stop the release before building. Upload failures
stop packaging. Debug and local Android APK/sideload builds stay local. The root
native `scripts/release/*Release.sh` wrappers, which
[`scripts/deploy/deployEverything.sh`](../../scripts/deploy/deployEverything.sh)
also runs, reach this step through Fastlane; no separate source-map command is
required.

## Collection policy

The adapter uses a private Sentry client and scope with **no automatic SDK
integrations**. Sentry 11 collection categories are explicitly disabled with
`dataCollection`, including user information, cookies, headers, bodies, query
parameters, database queries, AI inputs/outputs, queues, GraphQL, frame
variables, and source context; its broader defaults must not widen this policy.
It rebuilds each error from an allowlist before sending and repeats that
validation at the transport boundary. Both clients select static trace
lifecycle with a zero trace sampling rate, so Sentry 11 adds no SpanStreaming
integration. Only error envelopes leave. Repeated sanitized error locations
report once per page load, within five distinct errors per minute and twenty
per page load; the API resets that budget and deduplication hourly. Excess
reports drop locally to bound retry-loop traffic and the project quota.

Allowed:

- Generic exception type and placeholder message on clients; generated bundle filename,
  line, and column. Runtime function names and source context are excluded from
  transmitted events; Sentry can reconstruct code context from uploaded maps.
- API operation names, reviewed driver exception types and error codes, and
  error HTTP statuses (400–599). API titles are constructed from this finite
  vocabulary; raw exception text is never sent. See API coverage below.
- API-only sanitized cause stacks, bounded pool counters, HTTP methods and
  response statuses, and route templates from the release's OpenAPI allowlist.
- API-only aggregate counts of locally discarded errors, emitted as bounded
  client reports without event content or identifiers.
- Git release, deployment environment, and target/build variant.
- On clients, `api_version`: the build number from the API's
  `X-Tearleads-Api-Version` response header (see above), as last heard from.
- On clients, API requests that got no response, as coarse warning events and
  breadcrumbs from the reviewed vocabulary in
  [API network failures](api-network-failures.md#reporting-to-sentry).
- Up to 30 breadcrumbs containing an approved mini-app name and action, plus
  timestamps. These describe attempts/navigation, not successful server commits.
  The trail is cleared when the active identity changes or is locked.
- Random event IDs and a fixed `0.0.0.0` user IP field to suppress IP inference.

Excluded:

- Raw exception and cause messages, arbitrary error properties, and System Monitor
  log text or support reports.
- Document/file/contact names, text, field values, document kinds, entity IDs,
  key fingerprints, passwords, keys, account IDs, and stable user identifiers.
- Full page URLs, path segments, queries, fragments, request/response data,
  cookies, authorization headers, DOM text, and console output.
- Session tracking, replay, screenshots, attachments, feedback, analytics,
  performance tracing, profiling, Sentry Logs, and automatic SDK client reports.
  Only the API's locally constructed discard counters are permitted.

Anonymous DevTools and extension-only exceptions have no application code frame
and are discarded. Boundary failures without a usable stack still produce a
generic report. String-only log messages stay local.

This protects application content, not all network metadata: direct browser
requests necessarily expose a connection IP, browser HTTP headers, and the site
origin to Sentry's infrastructure. The transport requests omission of
credentials and the `Referer` header; mobile network requests pass through
Capacitor's native HTTP bridge. The project setting above disables storage of IP
addresses. Do not enable Sentry's recommended automatic integrations without
revisiting this policy.

## Error boundaries and System Monitor

The root boundary handles shell/provider failures. Each mini-app has its own
boundary in both windowed and routed layouts, with a **Try again** action that
remounts the failed view. It does not clear the user's cache or identity.
Unhandled browser errors and promise rejections with application frames are also
reported.

System Monitor gathers its local logs through `LogProvider`. Actual `Error`
objects supplied to `logError` also go through the private adapter; formatted
messages never become remote breadcrumbs. Safe actions appear locally as
`Activity: explorer.move-to-trash`. The local report and Sentry trail can be
compared without exporting raw logs. Mini-app render failures also enter the
local log when Sentry is disabled. Activity entries share the local log's
1,000-entry retention limit.

Incoming document and container-metadata quarantines pass the original `Error`
to this logger after recording the durable failure. This covers ordinary sync
and raw history recovery on web, Android, and iOS. Reports have
`diagnostic_source=log` and `exception.mechanism.handled=true`; their mapped
stacks identify the quarantine path. The raw quarantine message, update IDs,
writer identity, causes, and document contents remain local. Identical repeats
within a live document are suppressed before appending host logs or
breadcrumbs. Reports also use the existing per-page deduplication and event
budget. Reporting throws or rejections do not replace the quarantine or clear
the write-queue error, and results from an invalidated sync generation are not
reported.

Failed local document writes and failed sync-lane runs report the same way.
The document write chain deliberately swallows its errors so an un-awaited
edit cannot reject; a failed content, row, or attachment write still reaches
the logger with the original `Error`.
Sync lanes report through an observability-only lane callback that is separate
from the lane's own error handling. Both suppress an identical repeat — the
write chain per document store, a lane per registered lane, and a lane's
signature is deliberately never cleared by a later success, because a lane
alternating between failure and recovery would otherwise refill the local log.
A vanished local database is teardown rather than lost durability and stays
local, as do offline and expected HTTP outcomes, which never reach these
paths. Messages are fixed literals: document, row, container, and lane
identifiers stay in the local log line and are never reported.

The local database lifecycle reports its own failures the same way. Wiping a
persisted database that cannot be decrypted with the resolved key — the most
destructive automatic action the client takes — reports a real `Error` whose
cause is the SQLite failure, and so do a failed wipe and a recreated database
that comes back unreadable. Boot, reset, and worker-construction failures
report the original `Error`. A crash of the SQLite worker itself (a failed
script load or an uncaught exception outside request handling) is observed on
the main thread on every target: the cross-tab owner forwards it to each
client, in-flight requests reject instead of hanging, and the app reports it
once and retires the runtime so the retry surface appears. Callers whose
requests it rejected treat it as the database going away and stay local. The
crash `Error` is constructed in application code, never from the worker's own
event, so its stack maps to an allowlisted bundle frame.

User-initiated mini-app actions report the same way once they have thrown:
Explorer's create, rename, move, link, share, activate, detach, refresh,
download, and route-restore paths, Organization Manager's create, admin
mutation, purge recovery, billing, checkout, and cancellation paths, and the
file document preview and download paths. Each keeps its existing UI outcome
and passes the original `Error` to the logger with a fixed literal message. A
database that went away mid-flight and a projection verification cancelled by
a newer generation are teardown, not failures, and stay local. Container
shares are reported inside the SDK, where the thrown failure is still in hand,
rather than at the panel. The local keyring lock provider mounts outside the
logger and reports through the host diagnostics directly; clearing a PIN
verifies it first, so a mistyped PIN is a refusal rather than a report.

All mini-apps record opening and route changes. Explorer additionally records
root/Trash/folder/document views and explicit context-menu actions. Notes
records moving documents to Trash; Backup / Restore records export/import
actions. To instrument another action, use `useDiagnosticBreadcrumb()` or the
typed `diagnosticAction` prop on `MiniAppButton` / `DiagnosticMenuItem`. Add
vocabulary to `@tearleads/diagnostics/activity` deliberately. Never derive it
from text, IDs, or routes.

## Mobile, desktop, and API coverage

Mobile uses the same private JavaScript client, error boundaries, System Monitor
adapter, and mini-app vocabulary as web. The packaged asset manifest restricts
frames to exact generated code files, and must match the platform, tier, and
commit. Pending events flush when the app pauses. Native crash collection,
watchdogs, native breadcrumbs, and native attachments are disabled; this setup
captures JavaScript failures inside the WebView.

The Electrobun desktop renderer uses that same private JavaScript client,
boundaries, and adapter. Frames are restricted to the renderer bundle served
from the desktop shell's pinned loopback origin.

The Bun main process reports failed downloads, failed reveals, uncaught
exceptions, and unhandled rejections through the server client. Its only
admitted frame is `app:///bun/index.js`, located from the running bundle's own
absolute path; an ASAR or unbundled run reports nothing, and a map left beside
the bundle, or an install path the stack parser cannot read, yields frameless
events. An uncaught exception is logged, reported, and flushed for up to two
seconds before Electrobun's own crash shutdown runs, so the app briefly keeps
running; a second crash in that window shuts down at once.

See [API error diagnostics](api-sentry.md) for request and background capture,
safe error metadata, fallback stacks, and maintenance reporting in both tiers.

## Source maps and verification

Web releases use `tearleads-web@<git-sha>` and `staging-app` / `production-app`.
Both tiers require and upload only the app entry and its linked map under
`app:///`, matching sanitized frames. Web workers stay out of uploads. Each
Workers Static Assets deployment replaces the previous assets, and
`.assetsignore` keeps maps out of it. Maps contain source code; upload tokens
never enter Bun builds.

Mobile events use `tearleads-android@<git-sha>` or `tearleads-ios@<git-sha>` and
`staging-app` / `production-app`. Vite emits hidden maps; uploads use
`app:///assets/` URLs matching the packaged JavaScript frames. Maps are removed
from `dist` after the upload attempt, including failures. The pinned CLI
[associates matching JavaScript and hidden map filenames](https://github.com/getsentry/sentry-cli/blob/3.8.1/src/utils/sourcemaps.rs#L105)
and adds references to uploaded artifacts; matching release, dist, and canonical
URLs provide symbolication without transmitting debug metadata.

Electrobun events use `tearleads-electrobun@<git-sha>` and a dist per build
target, `<tier>-app-<os>-<arch>`, as a commit's builds share URLs. The target is
Hutch's `ELECTROBUN_OS`/`ELECTROBUN_ARCH` (`macos-arm64`, `linux-x64`,
`linux-arm64`, `win-x64`; others stop). `ELECTROBUN_RELEASE_TIER` selects
`staging` or `production`; unset is a local build that reads no secrets and
reports nothing. Release from the repository root with
`scripts/release/{build,upload}{Macos,Linux}{,Staging}Release.sh`.
[`packages/app-electrobun/scripts/withSentryReleaseEnv.ts`](../../packages/app-electrobun/scripts/withSentryReleaseEnv.ts)
resolves that tier's DSN and full commit into the public
`BUN_PUBLIC_SENTRY_ELECTROBUN_*` defines for the Electrobun build and its
inherited `postBuild` packaging hook. It drops every inherited Sentry name
first, so exported configuration cannot reroute events and the token never
reaches a bundle. A configured tier with a missing or malformed DSN stops the
build.

Release builds emit external maps for the renderer chunk and the main-process
bundle. The main process reads its configuration from a build-time define with
no runtime environment fallback. Before Electrobun signs or archives the app,
the packaging hook copies each script and its map, with repository-relative
sources, to `build/sentry-sourcemaps/<dist>`, then deletes every map in the
build directory, even after a failure. The release shell unsets its exported
upload token; after the build, the wrapper reads it from the tier's
`.secrets/<tier>/shared.env`, uploads the staged files with `app:///` URLs,
removes them, and exits non-zero on failure so nothing is published. Publishing
requires a clean checkout before any Bun process runs and again before upload.
`BUN_OPTIONS` and `BUN_INSPECT*` are unset first; Bun launches add
`--no-env-file --config=/dev/null`. The wrapper refuses those variables and
`DYLD_*`, and reads `SENTRY_*` names only from the tier's `.secrets/<tier>/`
files.

The upload token reaches only the pinned `sentry-cli` binary, resolved via
`@sentry/cli`, not `PATH`, and run without a Bun or npm shim. It runs in a fresh
empty directory as cwd and `HOME`, refuses to start below a `.sentryclirc`,
`.env` or a directory others can write (`TMPDIR` must be private), and receives
only the token, `SENTRY_DISABLE_UPDATE_CHECK=1` and `SENTRY_LOAD_DOTENV=0`.
`--url` is pinned to `https://sentry.io/`. The CLI prefers an org auth token's
(`sntrys_`) embedded URL and organization over `--url` and `--org`, so the URL
must be the root of `sentry.io`, `us.sentry.io` or `de.sentry.io` (then pinned)
and the organization must be `SENTRY_ORG`. Rewriting inlines files a map names,
so uploads pass `--no-rewrite`, once each staged map embeds every source at a
repository-relative path (no `sourceRoot`, sections, URLs or `..`) and each
script names only its own map.

The Linux container (no `.git` or token) sets
`TEARLEADS_ELECTROBUN_SOURCEMAP_UPLOAD=deferred`: it stages and sweeps maps
without uploading; a checkout refuses the flag. `releaseLinux.sh upload` applies
the same checkout, `BUN_*` and token rules, copies staging to a private host
directory and, before publishing, uploads it via `uploadDeferredSourceMaps.ts`
(`BUILD_GIT_SHA` must be the clean `HEAD`; exactly two regular-file pairs under
the `linux-x64` dist).

Before changing this integration, run the tests in
[`packages/diagnostics/src`](../../packages/diagnostics/src/), the `diagnostics`
folders of [`packages/app-capacitor/src`](../../packages/app-capacitor/src/),
[`packages/api/src`](../../packages/api/src/), and
[`packages/app-electrobun/src`](../../packages/app-electrobun/src/),
`packages/app-electrobun/scripts/sentry*.test.ts`, the privacy tests in
`packages/app-web/scripts/sentry*.test.ts`, the real browser test
[`packages/app-web/e2e/diagnostics.spec.ts`](../../packages/app-web/e2e/diagnostics.spec.ts),
and the app boundary/logging tests. They inspect emitted envelopes with
synthetic private values; live verification needs the account configuration
above.

Verify staging before enabling production. After a client release uploads its
maps, trigger a new handled failure in each process; Sentry does not
symbolicate events it received before the upload. On desktop, a backup export
the main process cannot write reports from both the main process and the
renderer's file saver. Each event must reach the expected project with the
expected release, environment, and dist, show no processing errors, and map
its frames to source. It carries only the generic message, `app:///` frames
with positions, approved breadcrumbs (none from a server client), and user IP
`0.0.0.0`; file names, contents, host paths, and request details stay out.
