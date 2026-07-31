# RevenueCat Billing

Tearleads sells the organization **sync** subscription as the same three fixed
capacity tiers on every platform. Web checkout uses Stripe; native checkout uses
the App Store or Play through RevenueCat. RevenueCat mirrors every subscription
into the cross-platform `sync` entitlement and emits the lifecycle events that
activate or revoke server sync.

This documents how the integration is wired; the actual keys,
project/app/offering IDs, and operational state live in the git-ignored
`.secrets/revenuecat.md`, not here.

## Provider responsibilities

| Concern | Authority |
| --- | --- |
| Which accounts consume seats | The server's signed effective `Members`-group reachability |
| Tier selection and capacity enforcement | The server, from the effective Members roster |
| Web tier changes, prorations, and invoices | Stripe Price IDs |
| Native tier changes and receipts | App Store / Play products through RevenueCat |
| Web payment UI | Direct Stripe Payment Element or the Stripe-hosted Checkout fallback |
| Cross-platform `sync` entitlement and grant/revoke events | RevenueCat |

New web purchases use direct Stripe checkout. A RevenueCat Web Billing package
does not participate in the product flow, so
[`createWebPurchases`](../../packages/app-web/src/webPurchases.ts) configures the
RevenueCat capability with `purchasesEnabled: false`: identification and
entitlement reads remain available, while package listing returns no options and
purchase attempts fail closed. Keep RevenueCat's provider-hosted flow for
native stores ([revenuecat-native-stores.md](./revenuecat-native-stores.md))
only. Native purchases are offered only for the buyer's personal organization;
custom organizations always subscribe on the web.

## Fixed tiers

| Tier | Monthly price | Capacity | Canonical product stem |
| --- | ---: | ---: | --- |
| Solo | $5 USD | 1 member | `sync_solo_monthly` |
| Team (up to 5) | $10 USD | 5 members | `sync_team_5_monthly` |
| Team (up to 10) | $20 USD | 10 members | `sync_team_10_monthly` |

Stripe represents these as three recurring Prices, each with subscription-item
quantity `1`. Apple, Google, and RevenueCat Test Store represent them as three
products. `organization_billing.seat_count` stores the tier capacity (1, 5, or
10), not the number of currently active members.

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
an unavailable RevenueCat capability. On web this affects entitlement
observation, not the direct Stripe purchase path; the Stripe path has its own
publishable key.

| Platform | Env var | How it's injected |
| --- | --- | --- |
| Web | `BUN_PUBLIC_REVENUECAT_WEB_API_KEY` | Set in `.secrets/<tier>.env`; `deployAppWeb.sh` sources tier secrets and passes it to `bun build --env='BUN_PUBLIC_*'`, which inlines it. |
| iOS | `VITE_REVENUECAT_IOS_API_KEY` | `.secrets/root.env`, loaded by Fastlane and inlined by Vite. |
| Android | `VITE_REVENUECAT_ANDROID_API_KEY` | `.secrets/root.env`, same path. |

Local web development with fixed-tier checkout enabled:

```sh
BUN_PUBLIC_REVENUECAT_WEB_API_KEY=<key> \
BUN_PUBLIC_STRIPE_PUBLISHABLE_KEY=<key> \
bun run --filter=app-web dev
```

### Web key types

- A **Test Store** key (`test_…`) can simulate RevenueCat purchases upstream,
  but Tearleads disables that purchase API on web. Test fixed-tier enrollment
  through direct checkout with Stripe test-mode keys instead.
- A **Web Billing** key (`rcb_…`) may still observe entitlements from the
  connected Stripe account, but it does not enable Tearleads web purchases. Do
  not re-enable the embedded adapter without the same server-authoritative tier
  contract.

## RevenueCat webhook (server)

RevenueCat posts subscription events to `POST {api}/billing/revenuecat/webhook`
([`revenuecatWebhook.ts`](../../packages/api/src/routes/billing/revenuecatWebhook.ts)).
The route authenticates a shared secret sent in the `Authorization` header against
`REVENUECAT_WEBHOOK_AUTH_HEADER` and fails closed (503) when it is unset.

Grant events update the organization's active billing period and reconcile its
effective Members roster; revoke events disable sync. For Stripe-store events,
the webhook first resolves exact `sub_…`/`si_…` IDs through the durable seat
binding, with exact Stripe subscription metadata as the `sub_…` fallback.
Mutable attributes are never trusted; unresolved state changes return 503
unclaimed for retry. Event
quantities never update Stripe seats.

- The server value comes from `.secrets/root.env` and is rendered into the API
  server's systemd `EnvironmentFile` by the ansible playbook
  ([`api.env.j2`](../../ansible/playbooks/templates/etc/tearleads/api.env.j2)), so
  it only reaches a deployed server via the **ansible** deploy step (not
  `--skip-infra`).
- Register the endpoint in the RevenueCat dashboard, or via the v2 API
  (`POST /v2/projects/{project_id}/integrations/webhooks`), with the `Authorization`
  value set to match `REVENUECAT_WEBHOOK_AUTH_HEADER`.
- Store-sandbox events are ignored unless the tier sets
  `REVENUECAT_ALLOW_SANDBOX_EVENTS=true` —
  [revenuecat-native-stores.md](./revenuecat-native-stores.md#sandbox-events).

## Direct Stripe checkout (server side)

This is the only supported path for a new web subscription. It processes the
subscription on **our own Stripe account** (the one connected to RevenueCat),
selects the smallest fixed Price that covers the authoritative roster, and
leaves RevenueCat responsible for mirroring the resulting entitlement lifecycle:

- `GET /organizations/:id/billing/stripe/options`, `POST
  /organizations/:id/billing/stripe/checkout` (admin-gated; returns the
  PaymentIntent client secret for a Payment Element), `POST
  /organizations/:id/billing/stripe/checkout-session` (hosted fallback), `POST
  /organizations/:id/billing/stripe/cancel`, and `POST
  /organizations/:id/billing/stripe/portal` live in
  [`stripeCheckout.ts`](../../packages/api/src/routes/billing/stripeCheckout.ts).
- The client does not supply a seat count. The checkout eligibility workflow
  counts unique users reachable through the organization's current `Members`
  group in the same server transaction as the admin and duplicate-subscription
  checks. Checkout rejects an empty effective roster and sends the resulting
  positive count to choose Solo, Team 5, or Team 10. Both inline and hosted
  checkout send the selected Price with subscription-item quantity `1`.
- Inline and hosted checkout share one durable, organization-scoped unpaid
  attempt, capturing buyer, mode, and seat quantity before Stripe is called.
  Identical retries reuse its idempotency token; another buyer, mode, or seat
  count gets 409. Inline attempts rotate after 24 hours. Hosted Sessions expire
  after 45 minutes with a five-minute overlap guard; retries stop before
  Stripe's 30-minute `expires_at` minimum. Existing incomplete subscriptions
  also block hosted checkout, preventing a late inline payment from coexisting.
- `POST /billing/stripe/webhook` verifies Stripe's signature over the raw
  body and consumes `invoice.paid` for both `subscription_create` and
  `subscription_cycle`. It always fetches the subscription from Stripe and
  validates the configured price item instead of trusting the event body.
  - On the first paid invoice, the server persists the exact `sub_…`, `si_…`,
    price, tier capacity, customer, organization, and period binding before it
    associates the receipt with RevenueCat. Association creates the RevenueCat
    customer (v2; 409 already exists is success), sets its `orgId` attribute
    (v2), then posts the receipt (v1, `fetch_token` = subscription id,
    `X-Platform: stripe`, authenticated with the Stripe app public key).
  - On a paid renewal invoice, the server refreshes the Stripe binding and
    resets that period's paid-capacity baseline to the capacity represented by
    the renewed Price. The invoice id makes the baseline update idempotent. No RevenueCat
    association call is needed again.
  - Stripe-store RevenueCat events use the durable exact item/subscription
    binding, or exact `sub_…` metadata lookup. They never fall back to the
    mutable RevenueCat customer attribute.
- Server configuration for offering or creating checkout (all required; the
  options list is empty and creation answers 503 when the set is incomplete):
  `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
  `STRIPE_SYNC_SOLO_PRICE_ID`, `STRIPE_SYNC_TEAM_5_PRICE_ID`,
  `STRIPE_SYNC_TEAM_10_PRICE_ID`,
  `REVENUECAT_STRIPE_PUBLIC_API_KEY` (the RC project's Stripe app public
  key). The customer/attribute half of the association reuses the
  `REVENUECAT_V2_SECRET_KEY` + `REVENUECAT_PROJECT_ID` pair already
  configured for the management-URL lookup (shared via
  [`revenueCatConfig.ts`](../../packages/api/src/billing/revenueCatConfig.ts))
  — no separate legacy v1 secret key. Shared provider credentials may live in
  `.secrets/root.env`, while each `STRIPE_WEBHOOK_SECRET` must live in the
  matching `.secrets/<tier>.env`; Ansible renders the merged values into the
  API's EnvironmentFile. End-to-end entitlement activation also requires
  `REVENUECAT_WEBHOOK_AUTH_HEADER` and a matching RevenueCat webhook.
- Stripe gives every webhook endpoint its own signing secret. Staging and
  production therefore need separate `STRIPE_WEBHOOK_SECRET` values in their
  tier env files; do not leave one shared root value when both endpoints are
  enabled. The publishable key, secret key, and all three price ids must likewise belong
  to the same Stripe mode for that tier.
- One-time provider steps: create one Stripe product with the three monthly
  Prices listed above; attach that Stripe product to the `sync` entitlement in
  RevenueCat; register the webhook endpoint in Stripe with `invoice.paid`
  enabled. The API maps the exact Stripe Price from its immutable subscription
  binding because RevenueCat's Stripe event identifies the catalog Product, not
  the selected Price. Both initial and renewal paid invoices are required for
  correct seat-period accounting.

The client half is described below. Reporting details live in
[billing-history.md](./billing-history.md).

## Fixed-tier behavior

Seat accounting follows the effective Members roster, not client-supplied
roster rows and not the RevenueCat subscriber count. Assignments identify which
accounts consume the fixed capacity stored in `organization_billing.seat_count`.

- **Initial web enrollment:** the server chooses the smallest tier covering the
  current roster. Checkout rejects an empty roster and any roster above 10.
- **Web growth across a boundary:** moving from 1→2 members switches Solo to
  Team 5; moving from 5→6 switches Team 5 to Team 10. The worker changes the
  Stripe Price at quantity `1` with `proration_behavior=create_prorations`.
- **Web shrinkage:** a lower renewal tier is selected without a current-period
  credit (`proration_behavior=none`). Already-paid capacity remains available
  through the period.
- **Growth within a tier:** no provider change is needed. Released assignments
  can be reused by replacement members while the organization stays under its
  capacity.
- **Native growth:** Apple and Google do not expose Stripe-style quantity.
  Adding a member above the purchased product's capacity is rejected until the
  admin completes the corresponding store product upgrade.
- **Renewal:** the renewed Stripe Price or native product re-establishes the
  tier capacity for the new billing period.

An active Stripe subscription stays on at least Solo if its roster becomes
empty; cancel it rather than expecting a zero-price renewal. Trials can still
have zero licensed seats.

Roster writes only enqueue an absolute desired state in
`organization_billing_stripe_seats`; they do not call Stripe while holding the
roster transaction open. This keeps access changes durable even when Stripe is
temporarily unavailable.

## Stripe seat synchronization worker

[`stripeSeatSync.ts`](../../packages/api/scripts/stripeSeatSync.ts) drains the
durable capacity targets. It validates the subscription metadata, configured
tier Price, item id, and period directly against Stripe before applying an
update. Database leases prevent two workers from owning the same row, stable
idempotency keys make a retried prorated increase safe, failures back off, and a
daily audit rechecks otherwise-settled subscriptions for drift.
If Stripe has already advanced to a new billing period, the worker first
rebinds that authoritative period and retries as a fresh claim, so an old-period
high-water can never be applied after renewal. Only locally `active` billing
rows are claimed, and capacity growth is prorated only while Stripe reports the
subscription `active` or `trialing`; a `past_due` subscription backs off without
creating another charge.

The API build emits `packages/api/dist/tearleads-stripe-seat-sync`; the deploy
scripts copy it to `/opt/tearleads/bin/tearleads-stripe-seat-sync`. Ansible
installs `tearleads-stripe-seat-sync.service` and a persistent systemd timer
that runs every minute; each timer run processes at most 100 due organizations
and writes a JSON `{attempted, failed, synced}` summary to the journal. The API
deploy scripts also run the database migration, but the first rollout must run
the server Ansible playbook to install/enable the timer and render its
`/etc/tearleads/api.env` configuration.

Operational checks:

```sh
sudo systemctl status tearleads-stripe-seat-sync.timer
sudo systemctl start tearleads-stripe-seat-sync.service
sudo journalctl -u tearleads-stripe-seat-sync.service
```

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
  `deployAppWeb.sh` — the `BUN_PUBLIC_` prefix is required). This is required
  for new web purchases. When it is absent, direct checkout is unavailable and
  the disabled RevenueCat purchase capability is not a fallback.
- The script itself loads from `@stripe/stripe-js/pure`, not the package's main
  entry. Importing the main entry downloads Stripe.js — and its fraud-signal
  beacons — as an import side effect, which would run at startup for every
  visitor because the web shell imports this module from its entry point.
  `/pure` defers the fetch to the first `loadStripe()` call, i.e. the first
  time someone actually opens the checkout.
- The server pins the subscription to `card`; redirect-based methods are not
  compatible with the client's `redirect: "if_required"` confirmation flow.
- **Cancelling a Stripe subscription** is inline — `POST
  /organizations/:id/billing/stripe/cancel` sets `cancel_at_period_end` on the
  subscription, and a confirm row in the panel drives it. No card entry, so no
  iframe and no off-site page: an org that bought here does not get sent to
  Stripe's hosted portal to leave. Cancellation takes effect at the **end of
  the paid period**, so the org keeps the sync it paid for and RevenueCat flips
  the entitlement through the same webhook path a lapsed renewal takes — which
  is why the client refreshes the billing snapshot rather than assuming
  `canSync` changed. The management endpoint identifies the configured Stripe
  Price and exposes this direct cancellation on every app surface, so a web
  purchase can also be cancelled from a native shell.
  - **Resolving the `sub_…` to cancel** (and the Billing Portal, if wired):
    both search Stripe by the org's `orgId` metadata (`findLiveOrgSubscription`)
    rather than reading the billing row's `providerSubscriptionId`. That column
    is written only by the RevenueCat webhook, and for a Stripe purchase
    RevenueCat reports the subscription **item** id (`si_…`), never the `sub_…`
    that Stripe's cancel/portal APIs need. Searching Stripe is authoritative and
    self-heals subscriptions bought before this resolver existed. The `orgId`
    match is re-checked on the result so a pooled customer can never leak
    another org's billing.
- **Native-store cancellation on web:** the panel opens RevenueCat's exact
  subscription management URL, which routes to the App Store or Play
  subscription page. The server never attempts to cancel a store subscription
  through Stripe.
- **Default flow**: web always disables the RevenueCat subscribe list and uses
  direct checkout when the publishable key and server option are available.
  Native shells keep their provider-hosted store sheets because they do not set
  `purchasesEnabled: false` and have no direct-checkout capability.
- **The Stripe billing portal** route (`/billing/stripe/portal`) stays as an
  escape hatch for card updates and invoice history, but is not wired into the
  panel UI. If it ever is, the session must be minted **on click** — Stripe
  portal URLs expire in minutes, so resolving one at panel load would hand the
  admin an expired link. Card update (SetupIntent + Payment Element) and
  invoice history are the inline alternatives when those are wanted.
- **Styling**: Stripe-hosted fields use the Appearance API. The app resolves its
  computed theme tokens in
  [`checkoutAppearance.ts`](../../packages/app/src/mini-apps/org-manager/billing/checkoutAppearance.ts),
  and `webDirectCheckout.ts` selects Stripe's light or dark base theme.
- **Hosted-page alternative**: a "Pay on Stripe instead" link creates a hosted
  Stripe **Checkout Session** (`POST …/billing/stripe/checkout-session`) and
  opens it in a new tab, falling back to same-tab navigation if the browser
  blocks the popup. It reuses everything: the same admin gate and
  server-authoritative Members count, the same per-(user, org) customer, and
  `orgId`/`userId` stamped onto the subscription via
  `subscription_data[metadata]` so the same `invoice.paid` webhook associates it
  and `findLiveOrgSubscription` can cancel it. The success/cancel URLs are the
  origin-validated `returnUrl`, sharing the portal's `withReturnUrl` guard.
- **Flow** (`useDirectCheckoutFlow`): load option → create checkout on the
  server → mount the element into the panel's host → confirm → hand off to the
  existing activation poll, because the entitlement arrives asynchronously via
  Stripe → RevenueCat → our webhook. A decline keeps the element mounted so
  the buyer can correct their card; cancel is just an unmount. None of the
  abort/orphan machinery the provider-hosted flow needs applies here, since we
  own the element's lifecycle.
