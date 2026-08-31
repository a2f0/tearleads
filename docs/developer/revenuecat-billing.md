# RevenueCat Billing

SymCrypt sells the organization **sync** subscription as the same three fixed
capacity tiers on every platform. Web checkout uses Stripe; native checkout uses
the App Store or Play through RevenueCat. RevenueCat mirrors every subscription
into the cross-platform `sync` entitlement and emits the lifecycle events that
activate or revoke server sync.

This documents how the integration is wired; the actual keys,
project/app/offering IDs, and operational state live in the git-ignored
`.secrets/revenuecat.md`, not here.

Provider MCP registration, CLI fallbacks, the declarative provisioning order,
and the current external-account handoff live in
[payment-provider-mcp.md](./payment-provider-mcp.md).

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

## Native restore and subscription moves

An App Store or Play subscription belongs to the store account, not to an app
installation or a SymCrypt key identity. A fresh SymCrypt identity on the
same store account therefore cannot buy the product again. Billing presents a
user-confirmed recovery flow instead:

1. The dialog tells the user to recover the original identity first if they
   need its encrypted data.
2. RevenueCat restore/sync runs under the new SymCrypt user id without changing
   the customer-level `orgId` attribution.
3. `POST /organizations/:id/billing/native/:store/claim` verifies the current
   App User ID's active subscription through RevenueCat v2. The client never
   supplies the product, receipt id, billing period, or seat capacity.
4. One database transaction disables and unbinds the previous personal
   organization, activates the destination at the verified product's fixed
   capacity, and reconciles its seats. A target with a different native
   subscription or any Stripe identity is rejected.
5. Only after the server accepts the claim does the client stamp the destination
   personal organization as `orgId` for later native lifecycle events.

RevenueCat `TRANSFER` webhooks use the same verified claim workflow. Transfer
events do not include `app_user_id`; the server resolves the registered
SymCrypt user from `transferred_to`, then queries RevenueCat before changing
billing. The provider subscription id has a unique database index, so only one
organization can own it. Billing history shows `TRANSFER_OUT` on the source and
`TRANSFER_IN` on the destination.

This is a greenfield ownership invariant, not a legacy-data migration: the
initial Postgres and SQLite migrations intentionally add the unique index
without deduplicating billing rows. Prelaunch environments with conflicting
fixture data must be reset before applying it. One store subscription funds one
personal organization even when Apple or Google exposes the receipt through
family sharing; restoring it moves that single billing entitlement rather than
minting capacity for another organization. A stale lifecycle grant for the old
organization is stored as ignored and emits an operator warning.

This moves billing entitlement only. It does not copy the old organization's
encrypted documents, keys, or identity. The store restore must be initiated on
a device signed into the Apple or Google account that owns the purchase; after
the server activates the personal organization, sync is cross-platform.

Set the RevenueCat project's restore behavior to **Transfer to new App User
ID**. Do not auto-restore during app launch: Apple restore/sync should follow an
explicit user action, and both stores can present account UI.

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

Old Solo aliases remain accepted for receipts. Google and Test Store use the
stems above; App Store prefixes them with `symcrypt_` because Apple reserves
the old IDs.

## Entitlement

The app gates org sync on a single entitlement, **`sync`**
(`DEFAULT_SYNC_ENTITLEMENT_ID` in
[`webPurchases.ts`](../../packages/app-web/src/webPurchases.ts) and
[`capacitorPurchases.ts`](../../packages/app-capacitor/src/billing/capacitorPurchases.ts)).
Override it per target via `BUN_PUBLIC_REVENUECAT_SYNC_ENTITLEMENT` (web) or
`VITE_REVENUECAT_SYNC_ENTITLEMENT` (capacitor); both default to `sync`.

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
  but SymCrypt disables that purchase API on web. Test fixed-tier enrollment
  through direct checkout with Stripe test-mode keys instead.
- A **Web Billing** key (`rcb_…`) may still observe entitlements from the
  connected Stripe account, but it does not enable SymCrypt web purchases. Do
  not re-enable the embedded adapter without the same server-authoritative tier
  contract.

## Provider deadlines

Provider setup, identity, checkout preparation, and ordinary calls have
30-second deadlines. Native restore and checkout allow ten minutes for store
authentication or reconnection. A lost callback requires an app restart; its
eventual arrival clears the block.

`PurchaseIdentityPendingError` means a call timed out before reaching the
provider, including while queued behind checkout or restore; retry after that
flow settles. `PurchaseProviderStalledError` means active provider work exceeded
its deadline; restart the app. Timed-out provider work stays serialized and may
still take effect.

A native-move server claim has its own 30-second deadline. A timeout releases
the queue and gets billing-server-specific retry guidance. HTTP may still
succeed without the RevenueCat binding; retrying safely completes both steps.

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

Paid grant events with an unknown product stem also return 503 without claiming
the event id. This lets a corrected catalog mapping recover through RevenueCat
redelivery instead of permanently recording a charged purchase as ignored.
New native purchase events also return 503 unclaimed when the locked
organization has an unexpired web checkout attempt or a durable Stripe
subscription identity. Clear the stale attempt or cancel the web subscription,
then redeliver the RevenueCat event; ordinary renewals of an existing native
subscription are not blocked by this new-purchase guard.
Promotional grants must cite one of the same tier stems. The server stores them
as `promotional:<stem>` so they remain non-native, then derives their capacity
from the canonical active-roster tiers rather than imposing a store-purchase cap.

RevenueCat Web Billing grants are unsupported and are recorded as ignored; web
enrollment must arrive through the Stripe integration. A valid native grant is
never discarded after payment if the roster changed between option display and
the store callback: the purchased tier is activated, the mismatch is logged,
seat reconciliation is deferred, and later roster growth remains blocked until
the admin upgrades or reduces the roster. An oversized Stripe grant is claimed,
applied without seat reconciliation, and logged for operator repair instead of
returning an unbounded 503.

- The server value comes from `.secrets/root.env` and is rendered into the API
  server's systemd `EnvironmentFile` by the ansible playbook
  ([`api.env.j2`](../../ansible/playbooks/templates/etc/symcrypt/api.env.j2)),
  so it only reaches a deployed server via the **ansible** deploy step (not
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
  enabled. The publishable key, secret key, and all three price ids must
  likewise belong to the same Stripe mode for that tier.
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
  admin completes the corresponding store product upgrade. The billing snapshot
  carries the server-authoritative active-member count, so native clients hide
  tiers that cannot cover the signed Members projection before opening a store
  sheet.
- **Renewal:** the renewed Stripe Price or native product re-establishes the
  tier capacity for the new billing period.

An active Stripe subscription stays on at least Solo if its roster becomes
empty; cancel it rather than expecting a zero-price renewal. Trials grant the
largest canonical tier (10 licensed seats) for their full duration.

Roster writes only enqueue an absolute desired state in
`organization_billing_stripe_seats`; they do not call Stripe while holding the
roster transaction open. This keeps access changes durable even when Stripe is
temporarily unavailable.

## Billing maintenance worker

[`stripeSeatSync.ts`](../../packages/api/scripts/stripeSeatSync.ts) first
persists due free-trial expirations, then drains durable Stripe capacity
targets. Trial failures persist error and backoff state without starving the
batch. Retries start at one minute, cap at one hour, and continue until success.
After eight attempts, the JSON summary flags the row; its count and error stay
durable. Paid activation clears that retry state. Stripe reconciliation
validates metadata, tier Price, item id, and period. The stored Price may lag a
provider update whose database completion is retrying. Leases, stable
idempotency keys, backoff, and daily audits handle overlap and drift.
If Stripe has already advanced to a new billing period, the worker first
rebinds that authoritative period and retries as a fresh claim, so an old-period
high-water can never be applied after renewal. Only locally `active` billing
rows are claimed, and capacity growth is prorated only while Stripe reports the
subscription `active` or `trialing`; a `past_due` subscription backs off without
creating another charge.

Greenfield invariant: recreate databases before deployment.
Resetting billing rows is insufficient; the rewritten
`0000_greenfield_baseline` is not a forward migration. No compatibility or
lifecycle backfill path exists.

The API build emits `packages/api/dist/symcrypt-stripe-seat-sync`; the deploy
scripts copy it to `/opt/symcrypt/bin/symcrypt-stripe-seat-sync`. Ansible
installs `symcrypt-stripe-seat-sync.service` and its one-minute timer. Each run
processes up to 100 trials plus 100 Stripe targets and journals
`{stripeSeatSync, trialExpiry}`. API deploys run migrations; the first rollout
must run server Ansible to install the timer and render `/etc/symcrypt/api.env`.

Operational checks:

```sh
sudo systemctl status symcrypt-stripe-seat-sync.timer
sudo systemctl start symcrypt-stripe-seat-sync.service
sudo journalctl -u symcrypt-stripe-seat-sync.service
```

## Direct Stripe checkout (client side)

The provider seam, Payment Element lifecycle, hosted fallback, cancellation
behavior, and styling details live in
[stripe-checkout-client.md](./stripe-checkout-client.md).
