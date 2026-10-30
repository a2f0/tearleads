# Hosted click analytics

The website and browser app explicitly initialize `@a2f0/ct-client` in their
deployment entrypoints. The shared app, SDK, Capacitor, and Electrobun packages
never initialize CT. Production builds collect only on these exact HTTPS origins:

| App dimension | Production | Staging |
| --- | --- | --- |
| `website` | `tearleads.com` | `website-staging.tearleads.com` |
| `web-app` | `app.tearleads.com` | `app-staging.tearleads.com` |
| `demo` | `demo.tearleads.com` | `demo-staging.tearleads.com` |

Each request uses site `tearleads`, environment `production` or `staging`, and
page `/`. Page paths, query strings, fragments, text, form values, and user or
document identifiers are omitted. The client captures trusted clicks on generic
element types, excludes editable controls and `data-ct-ignore` subtrees, and
does not create persistent visitor identifiers. Do not add user data to CT labels.

Tearleads honors Global Privacy Control and Do Not Track. Keep `overrideGpc`
false. The CT extension and saved per-origin `ct:opt-out` preference also stop
capture and discard queued events. Automated browsers and local development do
not collect clicks; tests intercept every collector request before it can leave
the browser.

CT is operated by Tearleads, LLC, hosted by Cloudflare, and posts to
`https://ct.a2f0.net/v1/clicks`. Its collector retains the connection IP and
Cloudflare's approximate country, region, and city data with each click for 90
days. The dashboard and read API require an administrator session; registration
is disabled and accounts are provisioned through CT's CLI. See the
[CT repository](https://github.com/a2f0/ct) for administration and retention.

[`packages/app-web/e2e/click-tracking.spec.ts`](../../packages/app-web/e2e/click-tracking.spec.ts)
tests all six origins and privacy signals with real browser clicks and
intercepted HTTP requests. The website's publication test
([`packages/website/src/legalPublication.test.ts`](../../packages/website/src/legalPublication.test.ts))
checks that built pages load the CT initializer and publish the full privacy
notice. Frontend-only deployment uses `packages/app-web/scripts/deployAppWeb.sh
<prod|staging>` and `packages/website/scripts/deployWebsite.sh <prod|staging>
--skip-terraform`. The collector's registered origins must be deployed before
these clients.
