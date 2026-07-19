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

## Embedded checkout & styling (web)

On web the Web Billing checkout renders **inside the org-manager billing
panel** instead of a full-page overlay: `BillingPanel` passes a host element
through `PurchasesCapability.purchaseSync({ checkoutHost })`, which the web
backend forwards to the SDK's `purchase({ htmlTarget })`. Each purchase
attempt actually mounts into its own child of that host, because the SDK
empties its target element on teardown — a shared element would let an
abandoned attempt settling late wipe a replacement checkout's UI. The SDK's embedded
layout root sizes itself for a fixed-height viewport (`container-type: size`
plus `height: 100%`/`overflow-y: auto`), which in an auto-height host either
collapses to 0px or nests a second scrollbar; `BillingCheckout.css`
downgrades the containment to `inline-size` (the SDK's container queries are
width-only) and frees the heights so the checkout flows with the panel's own
scroll. If the host
is missing the SDK falls back to its fullscreen modal, and native (Capacitor)
flows ignore the option entirely.

The SDK hides its own close control in embedded mode, so the panel provides
the exit path: a Cancel row shown for the whole embedded purchase (platforms
gate it via `PurchasesCapability.supportsEmbeddedCheckout`, so it never shows
over a native store sheet). Cancelling (ours or the provider's) is normalized
to `PurchaseCancelledError`, which the billing UI treats as a no-op rather
than a failed purchase, and the host element cancels the purchase whenever it
leaves the DOM (admin role revoked, billing view lost, panel closed).
Cancelling only dismisses the UI — a payment the provider had already taken
can still land afterwards, and the flow honors that late success by running
the normal activation refresh. A cancel that fires before the checkout has
mounted aborts the purchase via an `AbortSignal` instead, so the SDK never
renders a checkout nothing controls; a cancel after the SDK purchase started
additionally closes and reconfigures the SDK singleton, because the SDK keeps
checkout-session state on one shared helper and a retry must not share it
with the abandoned purchase.

### Org attribution

Each web purchase carries its `orgId` in **transaction metadata**
(`purchase({ metadata })`), which RevenueCat delivers back on
`INITIAL_PURCHASE`/`NON_RENEWING_PURCHASE` webhook events. The webhook prefers
that metadata over the `orgId` *subscriber attribute* because the attribute is
customer-level and mutable — a later purchase for another org overwrites it,
which would misattribute a purchase that completes after its checkout was
dismissed. The attribute is still written before every purchase as the
fallback for native store purchases, which carry no metadata. When verifying
in staging, confirm a purchase's webhook event resolved the org even if you
started another org's checkout in between.

Styling comes from two layers:

- **Dashboard branding** (RevenueCat → Web Billing app → Look & feel) sets the
  base colors/font/shapes the SDK ships as `BrandingAppearance`. Keep it close
  to the app so the unthemed flash and any fallback modal look right.
- **`BillingCheckout.css`** re-themes the embedded widget with the app's theme
  tokens by overriding the SDK's `--rc-*` custom properties (with
  `!important`, since the SDK inlines its branding). This keeps the checkout
  in sync with Light/Dark. The text inputs (email and card fields) are
  **Stripe-hosted iframes** page CSS cannot reach: the SDK builds their
  Stripe `appearance` from the dashboard branding (form background → input
  background, shapes → radius, text colors derived from the background) and
  hard-codes the font size and padding — so input colors are a dashboard
  setting, and input row height/font size are not adjustable at all.

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
