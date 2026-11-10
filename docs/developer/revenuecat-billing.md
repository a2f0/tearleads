# RevenueCat Billing

Tearleads sells the [organization](../glossary/principals.md#organization) **sync**
subscription as the same three fixed capacity tiers on every platform. Web
checkout uses Stripe; native checkout uses the App Store or Play through
RevenueCat. RevenueCat mirrors every subscription into the cross-platform `sync`
entitlement and emits the lifecycle events that activate or revoke server sync.

This page covers the wiring; keys, project/app/offering IDs, and operational
state live in the git-ignored `.secrets/prod/revenuecat.md`.

Provider MCP registration, CLI fallbacks, the declarative provisioning order,
and the external-account handoff live in
[payment-provider-mcp.md](./payment-provider-mcp.md).

## Provider responsibilities

| Concern | Authority |
| --- | --- |
| Which accounts consume seats | The server's signed effective `Members`-group reachability |
| Tier selection | The buyer, among the plans whose capacity covers the server's effective Members roster |
| Capacity enforcement | The server: the purchased plan's capacity, assigned to roster members as seats |
| Web tier changes, prorations, and invoices | Stripe Price IDs |
| Native tier changes and receipts | App Store / Play products through RevenueCat |
| Web payment UI | Direct Stripe Payment Element or the Stripe-hosted Checkout fallback |
| Cross-platform `sync` entitlement and grant/revoke events | RevenueCat |

New web purchases use direct Stripe checkout. The web shell loads no RevenueCat
SDK: RevenueCat's web role is server-side, mirroring the Stripe receipt into
the `sync` entitlement and delivering lifecycle webhooks. Keep
RevenueCat's provider-hosted flow for native stores
([revenuecat-native-stores.md](./revenuecat-native-stores.md)) only. Native
purchases are personal-org only; restore always creates a new org.

Organization billing has no separate `past_due` state. RevenueCat
`BILLING_ISSUE` is informational; access continues only while the current
paid period remains valid, and [expiration](./billing-lapse-recovery.md) follows
the disabled and retention lifecycle. Stripe's upstream `past_due` status still
prevents competing subscriptions and unsafe seat prorations.

## Native restore and subscription moves

An App Store or Play subscription belongs to the store account, not to an app
installation or a Tearleads key identity. A fresh Tearleads identity on the
same store account therefore cannot buy the product again. Billing presents a
user-confirmed recovery flow instead:

1. The dialog tells the user to recover the original identity first if they
   need its encrypted data.
2. RevenueCat restore/sync runs under the new Tearleads user id without changing
   the customer-level `orgId` attribution.
3. Once the receipt exposes `sync`, the client creates a fresh organization.
4. `POST /organizations/:id/billing/native/:store/claim` verifies the current
   App User ID's active subscription through RevenueCat v2. The client never
   supplies the product, receipt id, billing period, or seat capacity.
5. One database transaction disables and unbinds the previous
   organization, activates the destination at the verified product's fixed
   capacity, and reconciles its seats. A target with a different native
   subscription or any Stripe identity is rejected.
6. After acceptance, the client sets its `orgId` and switches to it. The
   personal organization remains the default.

RevenueCat `TRANSFER` webhooks use the same verified claim workflow. Transfer
events do not include `app_user_id`; the server resolves the registered
Tearleads user from `transferred_to`, then queries RevenueCat before changing
billing. Billing history shows `TRANSFER_OUT` on the source and `TRANSFER_IN`
on the destination.

Both database dialects enforce one owner per provider subscription with a unique
index. One store subscription funds one organization even when Apple or Google
exposes the receipt through family sharing; restoring it moves that single
billing entitlement rather than minting capacity for another organization. A
stale lifecycle grant for the old organization is stored as ignored and emits an
operator warning. Native grants require the personal org unless continuing a
verified restore binding.

This moves billing entitlement only. It does not copy the old organization's
encrypted documents, keys, or identity. The store restore must be initiated on
a device signed into the Apple or Google account that owns the purchase; after
the server activates the new organization, sync is cross-platform.

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

The Tearleads App Store, Google, and Test Store catalogs use only the stems
above, with staging and Play base-plan suffixes. Any other product identifier
is rejected; there is no receipt alias translation.

## Entitlement

The app gates org sync on a single entitlement, **`sync`**
(`DEFAULT_SYNC_ENTITLEMENT_ID` in
[`capacitorPurchases.ts`](../../packages/app-capacitor/src/billing/capacitorPurchases.ts)).
Override it for the native shell via `VITE_REVENUECAT_SYNC_ENTITLEMENT`; it
defaults to `sync`.

## Public SDK keys (native client)

The native shell reads a **public** RevenueCat SDK key at build time; these are
safe to inline in the shipped bundle. Without a key the app degrades to an
unavailable purchases capability. The web shell has no RevenueCat key: its
purchase path is direct Stripe checkout, configured by
`BUN_PUBLIC_STRIPE_PUBLISHABLE_KEY` alone.

| Platform | Env var | How it's injected |
| --- | --- | --- |
| iOS | `VITE_REVENUECAT_IOS_API_KEY` | `.secrets/prod/shared.env` (staging: `.secrets/staging/app.env`), loaded by Fastlane and inlined by Vite. |
| Android | `VITE_REVENUECAT_ANDROID_API_KEY` | Same files and path. |

Local web development with fixed-tier checkout enabled:

```sh
BUN_PUBLIC_STRIPE_PUBLISHABLE_KEY=<key> bun run --filter=app-web dev
```

A RevenueCat **Web Billing** key (`rcb_…`) has no consumer in this repository.
Do not add a web RevenueCat adapter without the same server-authoritative tier
contract that direct checkout enforces.

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
`REVENUECAT_WEBHOOK_AUTH_HEADER` and [fails closed](../glossary/access.md#fail-closed)
(503) when it is unset.

Grant events update the organization's active billing period and reconcile its
effective
[Members roster](../glossary/principals.md#organization-members-group); revoke
events disable sync. For Stripe-store events, the webhook first resolves exact
`sub_…`/`si_…` IDs through the durable seat binding, with exact Stripe
subscription metadata as the `sub_…` fallback. Mutable attributes are never
trusted; unresolved state changes return 503 unclaimed for retry. Event
quantities never update Stripe seats.

Paid grant events with an unknown product stem also return 503 without claiming
the event id, so a corrected catalog mapping recovers through RevenueCat
redelivery instead of permanently recording a charged purchase as ignored. New
native purchases stay unclaimed when the locked organization has an active web
checkout attempt, non-native billing identity, or durable Stripe identity.
Resolve the conflict and redeliver the event. Ordinary native renewals bypass
this new-purchase guard. Promotional grants must cite one of the same tier
stems. The server stores them as `promotional:<stem>` so they remain non-native,
then derives their capacity from the canonical active-roster tiers rather than
imposing a store-purchase cap.

RevenueCat Web Billing grants are unsupported and are recorded as ignored; web
enrollment must arrive through the Stripe integration. A valid native grant is
never discarded after payment if the roster changed between option display and
the store callback: the purchased tier is activated, the mismatch is logged,
seat reconciliation is deferred, and later roster growth remains blocked until
the admin upgrades or reduces the roster. An oversized Stripe grant is claimed,
applied without seat reconciliation, and logged for operator repair instead of
returning an unbounded 503.

- The server value comes from `.secrets/<tier>/shared.env` and is synced as a
  Worker secret by
  [`packages/api/scripts/deployApi.sh`](../../packages/api/scripts/deployApi.sh),
  so it reaches a deployed tier on every API deploy.
- Register the endpoint in the RevenueCat dashboard, or via the v2 API
  (`POST /v2/projects/{project_id}/integrations/webhooks`), with the `Authorization`
  value set to match `REVENUECAT_WEBHOOK_AUTH_HEADER`.
- Store-sandbox events are ignored unless the tier sets
  `REVENUECAT_ALLOW_SANDBOX_EVENTS=true` —
  [revenuecat-native-stores.md](./revenuecat-native-stores.md#sandbox-events).

## Direct Stripe checkout (server side)

This is the only supported path for a new web subscription. It processes the
subscription on **our own Stripe account** (the one connected to RevenueCat),
offers every fixed Price whose capacity covers the authoritative roster,
charges the one the buyer chooses, and leaves RevenueCat responsible for
mirroring the resulting entitlement lifecycle:

- `GET /organizations/:id/billing/stripe/options` (every covering plan,
  smallest first, also for a subscribed organization choosing a new plan),
  `POST /organizations/:id/billing/stripe/checkout`
  (admin-gated; called at Pay with the chosen plan's `priceId`, it starts the
  subscription and returns the PaymentIntent client secret the deferred-mode
  Payment Element confirms), `POST
  /organizations/:id/billing/stripe/checkout-session` (hosted fallback, also
  given the chosen `priceId`), `POST /organizations/:id/billing/stripe/plan`
  ([plan changes](#changing-plans)), `POST
  /organizations/:id/billing/stripe/cancel`, and `POST
  /organizations/:id/billing/stripe/portal` live in
  [`stripeCheckout.ts`](../../packages/api/src/routes/billing/stripeCheckout.ts).
- The client does not supply a seat count. The checkout eligibility workflow
  counts unique users reachable through the organization's current `Members`
  group in the same server transaction as the admin and duplicate-subscription
  checks, and rejects an empty roster or one above 10. The buyer may choose
  any plan whose capacity covers that count, including more capacity than the
  roster needs; both inline and hosted checkout send the chosen Price with
  subscription-item quantity `1`. Stripe does not check the inline form's
  amount against the PaymentIntent, so checkout starts only a configured
  plan whose Stripe Price is still active, and only while it covers the
  roster counted inside the reservation; otherwise it returns 409
  `billing_checkout_plan_unavailable` before reserving anything, and the
  client reloads the options.
- Inline and hosted checkout share one durable, organization-scoped unpaid
  attempt, capturing buyer, mode, and the chosen plan's capacity before Stripe
  is called. Identical retries reuse its idempotency token; another buyer gets
  a 409 until the attempt expires. When the same buyer chooses another plan or
  the other way to pay, the next checkout rotates the attempt; a roster change
  that the chosen plan still covers keeps the attempt.
  Before offering its own checkout, every checkout retires the buyer's unpaid
  checkouts from other attempts, and only after confirming that its own
  attempt is still the reserved one: it voids the first invoice of their
  incomplete subscriptions, found through the consistent subscription list
  rather than search, and expires their open hosted Sessions, found through
  the customer's Session list and each Session's `checkoutAttemptId`
  metadata. Voiding cancels the old PaymentIntent and expires its
  subscription; an expired Session can no longer be paid. Stripe refuses once
  the payment has succeeded or the Session has completed, and that refusal
  stays a 409, as does another attempt's Session completed within the last 50
  minutes, whose payment may still be settling. A request whose attempt was
  replaced meanwhile retires nothing and gets a 409, voiding the subscription
  or expiring the Session it had already created. So a buyer who leaves
  Stripe's page, or cancels before it opens, can pay in the form at once.
  Inline attempts rotate after 24 hours. Hosted Sessions expire after 45
  minutes with a five-minute overlap guard; a hosted retry with less than
  Stripe's 30-minute `expires_at` minimum left rotates to a new Session.
  Another buyer's incomplete subscription also blocks hosted checkout,
  preventing a late inline payment from coexisting.
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
    the renewed Price. The invoice id makes the baseline update idempotent, and
    no further RevenueCat association call is needed.
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
  [`revenueCatConfig.ts`](../../packages/api/src/billing/revenueCatConfig.ts)).
  Shared provider credentials may live in
  `.secrets/<tier>/shared.env`, while each `STRIPE_WEBHOOK_SECRET` must live in
  the matching `.secrets/<tier>/app.env`; the API deploy syncs the merged
  values as Worker secrets. End-to-end entitlement activation also requires
  `REVENUECAT_WEBHOOK_AUTH_HEADER` and a matching RevenueCat webhook.
- Stripe gives every webhook endpoint its own signing secret. Staging and
  production therefore need separate `STRIPE_WEBHOOK_SECRET` values in their
  tier `app.env` files; do not leave one shared value when both endpoints are
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

- **Initial web enrollment:** the buyer chooses any tier whose capacity covers
  the current roster, including more than the roster needs. Checkout rejects an
  empty roster, any roster above 10, and a chosen tier the roster outgrows.
- **Roster growth never changes the plan:** adding members charges nothing and
  never switches the tier on any platform. Members beyond the licensed
  capacity get no seat until an administrator upgrades or removes members.
  Released assignments can be reused by replacement members while the
  organization stays under its capacity.
- **Renewal:** the renewed Stripe Price or native product re-establishes the
  tier capacity for the new billing period.

### Changing plans

An administrator changes the plan on every platform under the same rules:

| Change | Web (Stripe) | iOS (App Store) | Android (Play) |
| --- | --- | --- | --- |
| Upgrade | Prorated difference charged now; applies once paid | Prorated now; applies at once | Prorated now; applies at once |
| Billing date | Unchanged | Resets to the upgrade day | Unchanged |
| Downgrade | At renewal, no credit | At renewal, no credit | At renewal, no credit |
| Below the roster | Refused by the server (409) | Not offered | Not offered |
| Undo a scheduled downgrade | Choose the current plan | Store subscription settings | Store subscription settings |

- **Upgrade, web:** `POST /organizations/:id/billing/stripe/plan` switches the
  subscription item to the larger Price with
  `proration_behavior=always_invoice` and
  `payment_behavior=pending_if_incomplete`, so Stripe applies the new Price
  only once the prorated invoice is paid. Capacity, the seat event, and seats
  for waiting members follow only that payment. A declined card, or one
  needing authentication, leaves a `pending_update` whose open invoice is
  voided at once: nothing is charged later and the request returns 409
  `billing_plan_change_payment_failed`, so the admin updates the card from the
  website's Manage subscription page (the Stripe Billing Portal) and retries.
  An upgrade from a period whose smaller renewal plan was already written to
  Stripe first restores the paid Price without proration, so the charge
  covers only the difference from the plan paid for.
- **Upgrade, native:** StoreKit moves to a higher service level at once and
  prorates the old subscription; Play replaces the purchase with
  `CHARGE_PRORATED_PRICE`. Capacity follows the store's effective event
  ([native stores](./revenuecat-native-stores.md#product-and-organization-policy)),
  never the informational `PRODUCT_CHANGE`.
- **Downgrade, web:** the endpoint records the smaller plan as the renewal
  quantity (`desired_renewal_quantity`) and returns `scheduled`; the seat-sync
  worker lowers the item's Price with `proration_behavior=none`, so the
  renewal invoice charges the smaller Price and the current capacity stays
  until then. A RevenueCat lifecycle event for the period already paid keeps
  that paid capacity even though the bound Price is the smaller one.
  Choosing the current plan again returns `kept` and restores the renewal
  Price, also without proration.
- **Downgrade, native:** App Store and Play (`DEFERRED`) both apply it at the
  next renewal.
- **Below the roster:** a plan smaller than the effective `Members` roster is
  refused until members are removed. On web the server refuses it with 409
  `billing_plan_change_unavailable`; the stores cannot be refused server-side,
  so native clients hide every tier below the active-member count in the
  billing snapshot.
- **Scheduled changes:** the billing snapshot's `pendingSeatCount` reports a
  scheduled smaller plan from either source, and the panel marks it
  Scheduled. If the roster grows past it, the scheduled plan stays as chosen
  and the panel says it cannot cover the roster; at renewal, members beyond
  its capacity have no seat.
- One web plan change runs at a time: an upgrade leases the Stripe seat row
  for five minutes while it is paid for, so the worker cannot write the Price
  meanwhile, and another change gets 409 `billing_plan_change_unavailable`
  until it ends. Stripe is charged only while at least half the lease
  remains; an upgrade that took longer is released unpaid with the same 409,
  so once a lease lapses the outcome in Stripe is final. The larger renewal
  plan is recorded only once the upgrade is paid, so an upgrade that fails
  or never reaches Stripe leaves a scheduled smaller plan as it was. An
  upgrade that stalls past its lease still grants the capacity it was charged
  for when it finishes, but a renewal plan chosen after the lease lapsed
  stands, and the worker reconciles the Price from Stripe. If the request
  never finishes (a lost response, a failed final transaction), the worker
  revisits the row once the lease lapses: finding Stripe at a larger Price
  than the capacity recorded for the period, it grants that capacity in the
  period the organization's billing tracks and records the larger plan as the
  renewal plan, unless a newer renewal choice was recorded while it read
  Stripe. A Stripe webhook that binds the larger Price within the paid
  period first (the upgrade's own update, or an extension) records it as the
  renewal plan the same way. Until the capacity is recorded and granted,
  every plan change, which reads Stripe first, gets 409
  `billing_plan_change_unavailable`: the worker would overwrite a newer
  renewal choice, and another plan would be priced from capacity not yet
  granted. An upgrade that finishes after the subscription renewed grants
  nothing to the new period, whose renewal invoice already charged the Price
  it renews at. That holds whichever provider reports the renewal first.
- Only a Stripe subscription that owns the organization's capacity (a priced
  binding, not one retained under native ownership) can change plan. Every
  change waits with 409 `billing_plan_change_unavailable` while Stripe has
  renewed into a period its webhooks have not bound yet, or while the
  organization's billing tracks another period than the one bound (one
  provider reported a renewal before the other), so an upgrade is always
  charged from, and a downgrade scheduled against, the period actually paid
  for. Two reports of a period are the same period when their starts differ
  by less than half its length.
- Every request names the capacity the admin chose against
  (`currentSeatCount`). If the plan changed meanwhile (a renewal, another
  admin), the request gets 409 `billing_plan_change_unavailable`, so a choice
  shown as a change at renewal is never charged as an upgrade.
- A RevenueCat event within the paid period keeps the paid capacity; only an
  event that starts a later period grants the smaller renewal plan alone. The
  capacity is computed again under the billing lock before it is applied, so
  an upgrade paid after the event was read is not overwritten, and an event
  read before the bound Price changed is retried.
- An extension that moves the paid period's end but not its start keeps the
  capacity paid for it when Stripe's webhook binds the new end, even though
  the bound Price is already a scheduled smaller plan's.
- A web plan change is offered only where web checkout runs, never inside a
  store app.

An active Stripe subscription stays on at least Solo if its roster becomes
empty, and its plans can still be listed and changed; cancel it rather than
expecting a zero-price renewal. Trials grant the largest canonical tier (10
licensed seats) for their full duration.

Roster writes only enqueue an absolute desired state in
`organization_billing_stripe_seats`, keeping the renewal plan an administrator
chose; they do not call Stripe while holding the roster transaction open, so
access changes stay durable while Stripe is unavailable.

## Billing maintenance worker

Billing maintenance persists due free-trial expirations, advances lapsed
organizations through purge, then drains durable Stripe capacity targets.
Trial failures persist error and backoff state without starving the
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
creating another charge. The item's Price is the plan the subscription renews
at (`desired_renewal_quantity`, which an administrator's
[plan change](#changing-plans) sets), written without proration and never
above the capacity paid for the current period. A row leased by a plan
upgrade is not claimed until the upgrade ends or its five-minute lease lapses.
A claim that finds a plan upgrade's open invoice (a `pending_update` the
request died before voiding) voids it, so it is never charged later. The
claim's result and any capacity it grants are recorded in one transaction,
so a failed grant leaves the claim to retry within minutes.

The API Worker's per-minute Cron Trigger (`* * * * *` in
[`packages/api/wrangler.jsonc`](../../packages/api/wrangler.jsonc)) runs these
phases through
[`src/worker/maintenance.ts`](../../packages/api/src/worker/maintenance.ts). One
probe statement (`billingMaintenancePhases`) first reads all three phases'
candidates, so an idle pass costs that statement alone; a phase runs only when
the probe found work, the purge phase selects again when a trial expired in the
same pass, and a failed probe falls back to running every phase.
[`stripeSeatSync.ts`](../../packages/api/scripts/stripeSeatSync.ts) is the
out-of-process entrypoint for local or on-demand runs (`--limit <n>`). By
default each run processes up to 100 trial expiries, 25 purge candidates, and
100 Stripe targets, and logs `{organizationPurge, stripeSeatSync, trialExpiry}`
as one JSON line. Full deployments initialize the API schema before publishing
the Worker.

## Direct Stripe checkout (client side)

The provider seam, Payment Element lifecycle, hosted fallback, cancellation
behavior, and styling details live in
[stripe-checkout-client.md](./stripe-checkout-client.md).
