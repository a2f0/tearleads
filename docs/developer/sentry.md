# Browser error diagnostics

The web app can report errors to separate Sentry projects for staging and
production. It is disabled without a tier DSN. Development, the two-identity demo,
Capacitor, Electrobun, the website, and the API are not instrumented by this setup.

## Account setup

1. Create two **React** projects in your Sentry organization, for example
   `tearleads-staging` and `tearleads-production`. Copy each project's browser DSN
   from **Settings → Projects → project → Client Keys (DSN)**.
2. Create an organization auth token for source-map uploads (`org:ci`, the
   Sentry CI integration). Keep it out of browser variables. An existing token
   with release-upload permissions can also be used.
3. In each project's security/privacy settings, enable **Prevent Storing of IP
   Addresses**. Keep server-side data scrubbing enabled. Limit allowed domains to
   `app-staging.tearleads.com` or `app.tearleads.com`, respectively.
4. Add the following values to the existing ignored secrets files. Use the actual
   organization/project slugs, which may differ from their display names.

`.secrets/root.env`:

```sh
SENTRY_ORG='your-organization-slug'
SENTRY_AUTH_TOKEN='your-private-upload-token'
```

`.secrets/staging.env`:

```sh
SENTRY_STAGING_PROJECT='tearleads-staging'
SENTRY_STAGING_DSN='https://PUBLIC_KEY@oORG.ingest.us.sentry.io/PROJECT_ID'
```

`.secrets/prod.env`:

```sh
SENTRY_PRODUCTION_PROJECT='tearleads-production'
SENTRY_PRODUCTION_DSN='https://PUBLIC_KEY@oORG.ingest.us.sentry.io/PROJECT_ID'
```

The DSNs above are placeholders: paste the complete values Sentry provides.
US, EU, and legacy hosted ingestion URLs are supported. The DSN is public; the
upload token is private and must never use a `BUN_PUBLIC_` prefix.

Once configured, run `scripts/deployStaging.sh --skip-infra` and
`scripts/deployProduction.sh --skip-infra`. Their app-web deploy steps select the
tier DSN, build, upload source maps, and then publish assets. Missing upload
credentials or an upload failure stop a configured deployment before its app
assets are published. No Terraform or Ansible secret needs to be put on the API
server for browser diagnostics.

## Collection policy

The adapter uses a private Sentry client and scope with **no automatic SDK
integrations**. It rebuilds each error from an allowlist before sending and repeats
that validation at the transport boundary. Only error envelopes can leave.

Allowed:

- Generic exception type and placeholder message; generated bundle filename,
  line, and column. Original function names and source context are excluded.
- Git release, deployment environment, and app build variant.
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
origin to Sentry's infrastructure. Requests omit credentials and the `Referer`
header. The project setting above disables storage of IP addresses. Do not enable
Sentry's recommended automatic integrations without revisiting this policy.

## Error boundaries and System Monitor

The root boundary handles shell/provider failures. Each mini-app has its own
boundary in both windowed and routed layouts, with a **Try again** action that
remounts the failed view. It does not clear the user's cache or identity.
Unhandled browser errors and promise rejections with application frames are also
reported.

System Monitor continues to gather its existing local logs through `LogProvider`.
Actual `Error` objects supplied to `logError` also go through the private adapter;
formatted messages never become remote breadcrumbs. Safe actions appear locally
as `Activity: explorer.move-to-trash`. The local report and Sentry trail can be
compared without exporting raw logs.

All mini-apps record opening and route changes. Explorer additionally records
root/Trash/folder/document views and explicit context-menu actions. Notes records
moving documents to Trash; Backup / Restore records export/import actions.
To instrument another action, use `useDiagnosticBreadcrumb()` or the typed
`diagnosticAction` prop on `MiniAppButton` / `MenuItem`. Add vocabulary to
`host/AppDiagnostics.ts` deliberately. Never derive it from text, IDs, or routes.

## Source maps and verification

Events use `tearleads-web@<git-sha>` releases and `staging-app` / `production-app`
distributions. The deploy script uploads the exact JS and linked maps with
`app:///` artifact URLs, matching the sanitized stack filenames. Maps are excluded
from rsync and removed from the public destination if previously deployed.
Source maps contain application source code; upload tokens stay in the deploy
process and are not inlined by Bun.

Run the privacy tests in `packages/app-web/scripts/sentry*.test.ts`, the real
browser diagnostics test, and the app boundary/logging tests before changing this
integration. They inspect emitted envelopes with synthetic private values.
After account setup, deploy staging first and confirm an error event arrives with
symbolicated frames, the expected project/release, and only approved breadcrumbs
before enabling production. SDK transport tests can verify sanitization locally;
live ingestion and server-side symbolication require the account values above.
