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

## Direct Stripe checkout (issue #1654, server side)

An alternative web purchase path that processes subscriptions on **our own
Stripe account** (the one already connected to RevenueCat) so the payment form
can be fully styled, while RevenueCat remains the entitlement system:

- `GET /billing/stripe/options`, `POST
  /organizations/:id/billing/stripe/checkout` (admin-gated; returns the
  PaymentIntent client secret for a Payment Element), and `POST
  /organizations/:id/billing/stripe/portal` (Stripe Billing Portal link) live
  in [`stripeCheckout.ts`](../../packages/api/src/routes/billing/stripeCheckout.ts).
- `POST /billing/stripe/webhook` verifies Stripe's signature over the raw
  body; on the FIRST paid invoice of a subscription it reads the
  `userId`/`orgId` metadata our checkout wrote onto the subscription, then
  runs a three-step association: **create the RevenueCat customer** (v2;
  an existing one answers 409, which is success), **set its `orgId`
  attribute** (v2 — unlike v1 this does not upsert the customer, hence the
  create first), and **post the receipt** (v1, `fetch_token` = subscription
  id, `X-Platform: stripe`, authenticated with the Stripe app public key).
  RevenueCat then owns the lifecycle and emits the same webhook events the
  org billing flow already consumes. The attribute is belt-and-braces: for
  Stripe-store events the authoritative org binding is the Stripe
  subscription's own immutable metadata.
- Configuration (all required; routes answer 503 / fail closed otherwise):
  `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_SYNC_PRICE_ID`,
  `REVENUECAT_STRIPE_PUBLIC_API_KEY` (the RC project's Stripe app public
  key). The customer/attribute half of the association reuses the
  `REVENUECAT_V2_SECRET_KEY` + `REVENUECAT_PROJECT_ID` pair already
  configured for the management-URL lookup (shared via
  [`revenueCatConfig.ts`](../../packages/api/src/billing/revenueCatConfig.ts))
  — no separate legacy v1 secret key. Set in `.secrets/<tier>.env`; rendered
  by ansible into the API's EnvironmentFile like the RevenueCat webhook
  secret.
- One-time dashboard steps: register the Stripe product id in the RevenueCat
  catalog and attach it to the `sync` entitlement; register the webhook
  endpoint in Stripe (`invoice.paid` events suffice).

The client half (Payment Element UI behind `BUN_PUBLIC_STRIPE_PUBLISHABLE_KEY`)
is described in the next section.

## Direct Stripe checkout (client side)

The web client can run the card form **itself** rather than embedding the
provider's checkout, which is what makes the fields styleable from the app's
own theme tokens.

- `DirectCheckoutCapability`
  ([`directCheckout.ts`](../../packages/client-sdk/src/client/directCheckout.ts))
  is the provider-agnostic seam, injected through
  `AppHostConfig.createDirectCheckout` exactly like `createPurchases`. The web
  shell supplies a Stripe implementation
  ([`webDirectCheckout.ts`](../../packages/app-web/src/webDirectCheckout.ts));
  every other shell gets `createUnavailableDirectCheckout`, so billing UI
  gates on `isAvailable` instead of branching per platform.
- Enabled by `BUN_PUBLIC_STRIPE_PUBLISHABLE_KEY` (inlined at build time by
  `deployAppWeb.sh` — the `BUN_PUBLIC_` prefix is required). Absent, the
  capability is the unavailable stub and the panel simply shows nothing extra.
- The script itself loads from `@stripe/stripe-js/pure`, not the package's main
  entry. Importing the main entry downloads Stripe.js — and its fraud-signal
  beacons — as an import side effect, which would run at startup for every
  visitor because the web shell imports this module from its entry point.
  `/pure` defers the fetch to the first `loadStripe()` call, i.e. the first
  time someone actually opens the checkout.
- The subscription is pinned server-side to `card`
  (`payment_settings[payment_method_types][]`). The Payment Element otherwise
  offers whatever the Stripe dashboard has enabled, and any redirect-based
  method (Amazon Pay, Cash App, iDEAL) breaks the client's
  `redirect: "if_required"` confirm — the buyer would see only a generic
  failure. Pinning keeps the offered methods matched to the flow we implement,
  whatever the dashboard says.
- **Cancelling** is inline, like the checkout — `POST
  /organizations/:id/billing/stripe/cancel` sets `cancel_at_period_end` on the
  subscription, and a confirm row in the panel drives it. No card entry, so no
  iframe and no off-site page: an org that bought here does not get sent to
  Stripe's hosted portal to leave. Cancellation takes effect at the **end of
  the paid period**, so the org keeps the sync it paid for and RevenueCat flips
  the entitlement through the same webhook path a lapsed renewal takes — which
  is why the client refreshes the billing snapshot rather than assuming
  `canSync` changed.
- **Default flow**: where the direct checkout can run (web with a publishable
  key), it *replaces* the RevenueCat subscribe list rather than rendering
  alongside it — `BillingPanel` gates `purchaseAvailable` on
  `!checkout.available`. Native shells have no direct-checkout capability, so
  they keep the provider-hosted store sheet automatically.
- **The Stripe billing portal** route (`/billing/stripe/portal`) stays as an
  escape hatch for card updates and invoice history, but is not wired into the
  panel UI. If it ever is, the session must be minted **on click** — Stripe
  portal URLs expire in minutes, so resolving one at panel load would hand the
  admin an expired link. Card update (SetupIntent + Payment Element) and
  invoice history are the inline alternatives when those are wanted.
- **Styling**: the payment fields are still Stripe-hosted iframes (that is what
  keeps us in PCI SAQ A), but on our own account Stripe's Appearance API
  accepts far more than RevenueCat exposes — font family, font size, input
  padding, and per-theme colors.
  [`checkoutAppearance.ts`](../../packages/app/src/mini-apps/org-manager/billing/checkoutAppearance.ts)
  resolves the app's tokens by applying them to a throwaway probe element and
  reading back the **computed** values: an iframe cannot dereference
  `var(--color-dark)`, and custom properties compute to their authored token
  (`1rem`, an unevaluated `color-mix(...)`) rather than a used value. Reading
  through the live panel means new themes work without touching this code.
- **Flow** (`useDirectCheckoutFlow`): load option → create checkout on the
  server → mount the element into the panel's host → confirm → hand off to the
  existing activation poll, because the entitlement arrives asynchronously via
  Stripe → RevenueCat → our webhook. A decline keeps the element mounted so
  the buyer can correct their card; cancel is just an unmount. None of the
  abort/orphan machinery the provider-hosted flow needs applies here, since we
  own the element's lifecycle.
