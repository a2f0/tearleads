# app-web

The browser deployment target. It renders the [shared app](../app/README.md)
with web adapters (Sentry diagnostics, a service worker, Stripe direct
checkout, and click tracking) and serves the client SDK's SQLite worker and
WebAssembly beside the bundle. Like every deployment target, it is not a
library: other packages must not import it.

One bundle serves two Cloudflare Workers Static Assets sites per tier: the app
(`app.tearleads.com`) and the two-pane demo (`demo.tearleads.com`), selected
at build time by `BUN_PUBLIC_APP_VARIANT`.

## Local development

From the repository root, with the API running:

```sh
bun run --filter=@tearleads/api dev   # API at http://127.0.0.1:3001
bun run --filter=app-web dev          # web app at http://localhost:3000
```

`dev` rebuilds the client SDK first and serves with hot reload. Renderer
settings are build-time defines such as `BUN_PUBLIC_API_BASE_URL` and
`BUN_PUBLIC_WS_URL`.

## Build and deploy

```sh
bun run --cwd packages/app-web build
packages/app-web/scripts/deployAppWeb.sh staging   # or prod
```

`build` writes `dist/`, its static assets, brand images, tier metadata, and the
service worker. `deployAppWeb.sh` builds the app and demo variants for the
tier and publishes `tearleads-app-<tier>` and `tearleads-demo-<tier>`; the
tier's edge Terraform stack attaches the hostnames. The full tier deployments
(`scripts/deploy/deployStaging.sh`, `scripts/deploy/deployProduction.sh`)
include it. See the [infrastructure guide](../../docs/developer/infrastructure.md#public-hostnames)
for hostnames and indexing, and
[click tracking](../../docs/developer/click-tracking.md) and the
[Stripe checkout client](../../docs/developer/stripe-checkout-client.md) for
the web-only integrations.

## Tests

```sh
bun run --cwd packages/app-web test   # build and deploy script tests
bun run --cwd packages/app-web e2e    # Playwright against a local server
```

The end-to-end suite serves the app on port 3100 (`APP_WEB_PORT`). Shared
screenshots are captured from `screenshots/` by the repository's screenshot
workflow (see the [script index](../../scripts/README.md#screenshot-seed-and-capture)),
not per deploy.
