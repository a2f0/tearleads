# RevenueCat Billing

Tearleads uses [RevenueCat](https://www.revenuecat.com/) for the organization
**sync** subscription across web, iOS, and Android. This documents how the
integration is wired; the actual keys, project/app/offering IDs, and operational
state live in the git-ignored `.secrets/revenuecat.md`, not here.

## Entitlement

The app gates org sync on a single entitlement, **`sync`**
(`DEFAULT_SYNC_ENTITLEMENT_ID` in
[`webPurchases.ts`](../../packages/app-web/src/webPurchases.ts) and
[`capacitorPurchases.ts`](../../packages/app-capacitor/src/capacitorPurchases.ts)).
It can be overridden per target via `BUN_PUBLIC_REVENUECAT_SYNC_ENTITLEMENT` (web)
or `VITE_REVENUECAT_SYNC_ENTITLEMENT` (capacitor); both default to `sync`.

## Public SDK keys (client)

Each platform reads a **public** RevenueCat SDK key at build time. These are safe
to inline in the shipped client bundle. When a key is absent the app degrades to
an "unavailable" purchases stub (the billing panel shows "Purchases aren't
available right now").

| Platform | Env var | How it's injected |
| --- | --- | --- |
| Web | `BUN_PUBLIC_REVENUECAT_WEB_API_KEY` | Set in `.secrets/<tier>.env`; `deployAppWeb.sh` sources tier secrets and passes it to `bun build --env='BUN_PUBLIC_*'`, which inlines it. |
| iOS | `VITE_REVENUECAT_IOS_API_KEY` | `.secrets/root.env`, loaded by Fastlane and inlined by Vite. |
| Android | `VITE_REVENUECAT_ANDROID_API_KEY` | `.secrets/root.env`, same path. |

Local web dev:

```sh
BUN_PUBLIC_REVENUECAT_WEB_API_KEY=<key> bun run --filter=app-web dev
```

### Web key types

- A **Test Store** key (`test_…`) simulates purchases with no payment processor —
  the SDK shows a success/fail/cancel modal and grants the entitlement. Ideal for
  dev/staging. Never ship a `test_` key to a production build with real users.
- A **Web Billing** key (`rcb_…`) drives real Stripe checkout and requires a
  connected Stripe account. For a package to appear in `getOfferings()`, its
  product must have a **price** in the currency the SDK resolves for the visitor;
  Test Store product prices are set only at product-creation time in the dashboard.

## Webhook (server)

RevenueCat posts subscription events to `POST {api}/billing/revenuecat/webhook`
([`revenuecatWebhook.ts`](../../packages/api/src/routes/billing/revenuecatWebhook.ts)).
The route authenticates a shared secret sent in the `Authorization` header against
`REVENUECAT_WEBHOOK_AUTH_HEADER` and fails closed (503) when it is unset.

- The server value comes from `.secrets/root.env` and is rendered into the API
  server's systemd `EnvironmentFile` by the ansible playbook
  ([`api.env.j2`](../../ansible/playbooks/templates/etc/tearleads/api.env.j2)), so
  it only reaches a deployed server via the **ansible** deploy step (not
  `--skip-infra`).
- Register the endpoint in the RevenueCat dashboard, or via the v2 API
  (`POST /v2/projects/{project_id}/integrations/webhooks`), with the `Authorization`
  value set to match `REVENUECAT_WEBHOOK_AUTH_HEADER`.
