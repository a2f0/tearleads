# Private error diagnostics

The web app, Android and iOS WebViews, and API report to separate Sentry
projects for staging and production. Reporting is disabled without the
corresponding DSN. Development, the two-identity demo, Electrobun, and the
website remain local.

## Account setup

The `tearleads` organization uses these projects:

| Target | Staging | Production |
| --- | --- | --- |
| Web | `tearleads-web-staging` | `tearleads-web-production` |
| API | `tearleads-api-staging` | `tearleads-api-production` |
| Android | `tearleads-android-staging` | `tearleads-android-production` |
| iOS | `tearleads-ios-staging` | `tearleads-ios-production` |

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

All mini-apps record opening and route changes. Explorer additionally records
root/Trash/folder/document views and explicit context-menu actions. Notes
records moving documents to Trash; Backup / Restore records export/import
actions. To instrument another action, use `useDiagnosticBreadcrumb()` or the
typed `diagnosticAction` prop on `MiniAppButton` / `MenuItem`. Add vocabulary to
`@tearleads/diagnostics/activity` deliberately. Never derive it from text, IDs,
or routes.

## Mobile and API coverage

Mobile uses the same private JavaScript client, error boundaries, System Monitor
adapter, and mini-app vocabulary as web. The packaged asset manifest restricts
frames to exact generated code files, and must match the platform, tier, and
commit. Pending events flush when the app pauses. Native crash collection,
watchdogs, native breadcrumbs, and native attachments are disabled; this setup
captures JavaScript failures inside the WebView.

The API captures unexpected HTTP errors (500+, including temporary database
failures) and failures during WebSocket handshakes. Expected client errors and
organization entitlement failures keep their existing responses and stay local.
Each captured API error has an independent scope and no breadcrumbs, preventing
activity from different requests from mixing. Background task failures and
process/native crashes are outside this integration.

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
folders, and the privacy tests in `packages/app-web/scripts/sentry*.test.ts`,
the real browser diagnostics test, and the app boundary/logging tests before
changing this integration. They inspect emitted envelopes with synthetic private
values. After account setup, deploy staging first and confirm an error event
arrives with symbolicated frames, the expected project/release, and only
approved breadcrumbs before enabling production. SDK transport tests can verify
sanitization locally; live ingestion and server-side symbolication require the
account values above.
