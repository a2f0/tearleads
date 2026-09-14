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

The existing ignored `.secrets/root.env` holds `SENTRY_ORG=tearleads` and
`SENTRY_AUTH_TOKEN`. The latter needs source-map upload access and stays in the
build/deploy process. It must never have a `VITE_` or `BUN_PUBLIC_` prefix.

Configure these variables in `.secrets/staging.env`; use `PRODUCTION` instead of
`STAGING` in `.secrets/prod.env`:

```sh
SENTRY_STAGING_PROJECT='tearleads-web-staging'
SENTRY_STAGING_DSN='https://PUBLIC_KEY@oORG.ingest.us.sentry.io/PROJECT_ID'
SENTRY_API_STAGING_DSN='https://PUBLIC_KEY@oORG.ingest.us.sentry.io/PROJECT_ID'
SENTRY_ANDROID_STAGING_PROJECT='tearleads-android-staging'
SENTRY_ANDROID_STAGING_DSN='https://PUBLIC_KEY@oORG.ingest.us.sentry.io/PROJECT_ID'
SENTRY_IOS_STAGING_PROJECT='tearleads-ios-staging'
SENTRY_IOS_STAGING_DSN='https://PUBLIC_KEY@oORG.ingest.us.sentry.io/PROJECT_ID'
SENTRY_ELECTROBUN_STAGING_PROJECT='tearleads-electrobun-staging'
SENTRY_ELECTROBUN_STAGING_DSN='https://PUBLIC_KEY@oORG.ingest.us.sentry.io/PROJECT_ID'
```

The DSNs above are placeholders. The DSN is public; the upload token is private.

## Deployment and releases

`scripts/deployStaging.sh` and `scripts/deployProduction.sh` apply Ansible's API
configuration and deploy the compiled API and web app. Ansible writes only
`API_SENTRY_DSN` and `API_SENTRY_ENVIRONMENT` to the protected API environment
file; the executable embeds its commit and exact source-path allowlist. Run the
full scripts the first time so the server environment is updated. Subsequent
`--skip-infra` deploys reuse that environment.

Web deployment selects the tier DSN, builds, uploads maps, then publishes
assets. Missing upload credentials or an upload failure stop a configured
deployment.

Google Play builds and iOS TestFlight builds invoke `bun
run build:release android` or `bun run build:release ios` in
`packages/app-capacitor`. `NATIVE_RELEASE_TIER` selects `staging` or
`production` (default). The builder reads the root and selected tier secrets,
injects only the selected public Sentry configuration, uploads maps, and removes
them before Capacitor packaging. Publishing maps requires a clean Git checkout;
staged, modified, or untracked sources stop the release before building. Upload
failures stop packaging. Debug and local Android APK/sideload builds stay local.
The root `scripts/buildAndroidRelease.sh`,
`scripts/buildIosRelease.sh`, their `StagingRelease.sh` counterparts, and all
corresponding `upload*Release.sh` wrappers reach this step through Fastlane.
`scripts/deployEverything.sh` uses those wrappers too. No separate source-map
command is required.

Existing installed mobile apps need a new release to start reporting.

## Collection policy

The adapter uses a private Sentry client and scope with **no automatic SDK
integrations**. It rebuilds each error from an allowlist before sending and
repeats that validation at the transport boundary. Only error envelopes can
leave. Repeated sanitized error locations are reported once per page load, with
limits of five distinct errors per minute and twenty per page load. The API
resets its twenty-error budget and deduplication once per hour. Excess reports
are dropped locally to bound retry-loop traffic and protect the project quota.

Allowed:

- Generic exception type and placeholder message; generated bundle filename,
  line, and column. Runtime function names and source context are excluded from
  transmitted events; Sentry can reconstruct code context from uploaded maps.
- Git release, deployment environment, and target/build variant.
- Up to 30 breadcrumbs containing an approved mini-app name and action, plus
  timestamps. These describe attempts/navigation, not successful server commits.
  The trail is cleared when the active identity changes or is locked.
- Random event IDs and a fixed `0.0.0.0` user IP field to suppress IP inference.

Excluded:

- Raw exception messages, causes, arbitrary error properties, and System Monitor
  log text or support reports.
- Document/file/contact names, text, field values, document kinds, entity IDs,
  key fingerprints, passwords, keys, account IDs, and stable user identifiers.
- Full page URLs, path segments, queries, fragments, request/response data,
  cookies, authorization headers, DOM text, and console output.
- Session tracking, replay, screenshots, attachments, feedback, analytics,
  performance tracing, profiling, Sentry Logs, and client reports.

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

System Monitor continues to gather its existing local logs through
`LogProvider`. Actual `Error` objects supplied to `logError` also go through the
private adapter; formatted messages never become remote breadcrumbs. Safe
actions appear locally as `Activity: explorer.move-to-trash`. The local report
and Sentry trail can be compared without exporting raw logs. Mini-app render
failures also enter the local log when Sentry is disabled. Activity entries
share the local log's existing 1,000-entry retention limit.

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
edit cannot reject, so a failed content, row, or attachment write was
previously invisible; it now reaches the logger with the original `Error`.
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
logger and reports through the host diagnostics directly; clearing a PIN now
verifies it first, so a mistyped PIN is a refusal rather than a report.

All mini-apps record opening and route changes. Explorer additionally records
root/Trash/folder/document views and explicit context-menu actions. Notes
records moving documents to Trash; Backup / Restore records export/import
actions. To instrument another action, use `useDiagnosticBreadcrumb()` or the
typed `diagnosticAction` prop on `MiniAppButton` / `MenuItem`. Add vocabulary to
`@tearleads/diagnostics/activity` deliberately. Never derive it from text, IDs,
or routes.

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

The API captures unexpected HTTP errors (500+, including temporary database
failures) and failures during WebSocket handshakes. A domain error carrying a
500+ status answers with its own status and body, which the shared handler
never sees, so it is captured where it is answered instead. Its status is kept
deliberately: propagating it would turn a retryable 503 into a permanent 500
unless its cause chain happened to look like driver contention. Expected client
errors and organization entitlement failures keep their existing responses and
stay local. Each captured API error has an independent scope and no
breadcrumbs, preventing activity from different requests from mixing.

Failures the API logged and deliberately swallowed — a realtime publish after
the write already committed, read-model notification verification, session
revocation notices, and post-handshake WebSocket interest handling — report
under `diagnostic_source=background-error`, which keeps them out of the
request 5xx signal. They are fire-and-forget: reporting cannot change the
response, and the committed write stays committed. Process and native crashes
remain outside this integration.

The blob-GC and Stripe-seat-sync executables build with the same diagnostics
configuration and report their own swallowed maintenance failures: blob
reclamation reports the aggregate carrying every per-object failure, and each
billing phase reports independently so one failure does not hide the others.
Per-item failures, which the sweeps count and drop rather than raise, report
too; free-trial expiry reports at the attention threshold its backoff already
defines rather than on every retryable attempt. An aggregate reports a bounded
number of its constituents rather than itself, because only the first exception
survives sanitizing and the aggregate's own stack is its construction site.
Both binaries drain pending reports before exiting, since a short-lived process
can otherwise finish and exit while a report is still in flight. Reporting never
changes their exit status.

## Source maps and verification

Events use `tearleads-web@<git-sha>` releases and `staging-app` /
`production-app` distributions. The deploy script uploads the exact JS and
linked maps with `app:///` artifact URLs, matching the sanitized stack
filenames. Maps are excluded from rsync and removed from the public destination
if previously deployed. Source maps contain application source code; upload
tokens stay in the deploy process and are not inlined by Bun.

Mobile events use `tearleads-android@<git-sha>` or `tearleads-ios@<git-sha>` and
`staging-app` / `production-app`. Vite emits hidden maps; uploads use
`app:///assets/` URLs matching the packaged JavaScript frames. Maps are removed
from `dist` after the upload attempt, including failures. The pinned CLI
[associates matching JavaScript and hidden map filenames](https://github.com/getsentry/sentry-cli/blob/3.7.0/src/utils/sourcemaps.rs#L105)
and adds references to uploaded artifacts; matching release, dist, and canonical
URLs provide symbolication without transmitting debug metadata.

Electrobun events use `tearleads-electrobun@<git-sha>` and a dist per build
target, `<tier>-app-<os>-<arch>`, as a commit's builds share URLs.
The target is Hutch's `ELECTROBUN_OS`/`ELECTROBUN_ARCH` (`macos-arm64`,
`linux-x64`, `linux-arm64`; others stop). `ELECTROBUN_RELEASE_TIER` selects
`staging` or `production`; unset is a local build that reads no secrets and
reports nothing. Release with `scripts/{build,upload}MacosRelease.sh <tier>` or
`scripts/{build,upload}LinuxRelease.sh <tier>`.
`scripts/withSentryReleaseEnv.ts` resolves that tier's DSN and full commit into
the public `BUN_PUBLIC_SENTRY_ELECTROBUN_*` defines for the Electrobun build and
its inherited `postBuild` packaging hook. It drops every inherited Sentry name
first, so exported configuration cannot reroute events and the token never
reaches a bundle. A configured tier with a missing or malformed DSN stops the
build.

Release builds emit external maps for the renderer chunk and the main-process
bundle. The main process reads its configuration from a build-time define with
no runtime environment fallback. Before Electrobun signs or archives the app,
the packaging hook copies each script and its map, with repository-relative
sources, to `build/sentry-sourcemaps/<dist>`, then deletes every map in the
build directory, even after a failure. The release shell unsets its exported
upload token; after the build, the wrapper reads it from `.secrets/root.env`,
uploads the staged files with `app:///` URLs, removes them, and exits non-zero
on failure so nothing is published. Publishing requires a clean checkout before
any Bun process runs and again before upload. `BUN_OPTIONS` and `BUN_INSPECT*`
are unset first; Bun launches add `--no-env-file --config=/dev/null`. The
wrapper refuses those variables and `DYLD_*`, and reads `SENTRY_*` names only
from `.secrets`.

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
directory and, before publishing, uploads it via `uploadLinuxSourceMaps.ts`
(`BUILD_GIT_SHA` must be the clean `HEAD`; exactly two regular-file pairs under
the `linux-x64` dist).

API releases use `tearleads-api@<git-sha>`
and `staging` / `production`. Bun embeds maps in the executable and resolves
stacks to source positions before filtering; only allowlisted
repository-relative paths and positions leave the server, without source text or
machine paths.

API source archives without Git still build, with remote diagnostics disabled.

Executable tests remove the build directory and run only the copied binary.
They exercise the API's injected build configuration and real reporter for both
tiers, asserting mapped application frames without raw error text or host paths.

Run the tests in `packages/diagnostics/src`, both native and API diagnostics
folders, `packages/app-electrobun/scripts/sentry*.test.ts`,
`packages/app-electrobun/src/diagnostics`, the privacy tests in
`packages/app-web/scripts/sentry*.test.ts`, the real browser diagnostics test,
and the app boundary/logging tests before changing this integration. They
inspect emitted envelopes with synthetic private values. After account setup,
deploy staging first and confirm an error event
arrives with symbolicated frames, the expected project/release, and only
approved breadcrumbs before enabling production. SDK transport tests can verify
sanitization locally; live ingestion and server-side symbolication require the
account values above.
