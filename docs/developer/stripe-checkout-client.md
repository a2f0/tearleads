# Stripe Checkout Client

The web client runs the card form inside the Tearleads billing panel. Stripe
hosts the sensitive fields in iframes, but the app owns the surrounding
flow and can style it from its theme tokens.

## Platform seam and configuration

- `DirectCheckoutCapability`
  ([`directCheckout.ts`](../../packages/client-sdk/src/client/billing/directCheckout.ts))
  is injected through `AppHostConfig.createDirectCheckout`. The web shell
  supplies [`webDirectCheckout.ts`](../../packages/app-web/src/webDirectCheckout.ts);
  other shells use `createUnavailableDirectCheckout`, so shared UI gates on
  capability instead of platform branches.
- `BUN_PUBLIC_STRIPE_PUBLISHABLE_KEY` enables the web capability and is inlined
  by [`deployAppWeb.sh`](../../packages/app-web/scripts/deployAppWeb.sh). There
  is no [RevenueCat](revenuecat-billing.md) web-purchase fallback.
- Stripe loads from `@stripe/stripe-js/pure`, deferring Stripe.js and its fraud
  signals from startup until someone opens checkout.
- The server pins the subscription to `card`, and the form offers only `card`
  (`allowedPaymentMethodTypes`). Redirect-based methods are not compatible
  with the client's `redirect: "if_required"` confirmation flow.

## Purchase flow

Nothing exists on the server until the buyer pays.
`useDirectCheckoutFlow` loads every plan whose capacity covers the
organization's roster, smallest first, and the panel lists each with its own
Subscribe. Subscribe mounts the Payment Element in Stripe's deferred mode
(`mode: "subscription"`) for that plan's amount and currency. While the form
is open, a plan picker switches to another offered plan: the session
re-prices the form in place (`elements.update`), keeping what the buyer typed,
and Pay then starts the new plan. On Pay, the session validates the form
(`elements.submit()`), then asks the server to start the subscription at the
chosen plan's `priceId` and confirms the returned PaymentIntent. Success hands
off to activation polling; the entitlement arrives asynchronously through
Stripe, RevenueCat, and the
[Tearleads webhook](revenuecat-billing.md#direct-stripe-checkout-server-side).

Stripe does not check the form's amount against the PaymentIntent it
confirms, so the server starts only a configured plan whose Stripe Price is
still offered, and only while that plan covers the roster. If the roster has
outgrown the chosen plan since
the plans loaded, or its Price was retired, Pay gets a 409
`billing_checkout_plan_unavailable`: nothing is charged, the form closes, and
the panel reloads the plans, offering none until they arrive. Switching plans
after a declined Pay replaces the unpaid subscription at the next Pay. A
decline leaves the element mounted for correction, and the next Pay for the
same plan resumes the same subscription; cancel unmounts it.

The surrounding Tearleads form requires a billing email before inline checkout.
Confirmation sends it as the PaymentMethod billing email while the embedded
Payment Element hides its duplicate email field. On the first paid invoice, the
server first applies the entitlement, then copies the saved payment-method
address onto the Stripe Customer before acknowledging the webhook. Hosted
Checkout collects a missing Customer email itself. This address is billing
recovery data; it is not part of the key-derived Tearleads identity.

The payment fields remain Stripe-hosted for PCI SAQ A.
[`checkoutAppearance.ts`](../../packages/app/src/mini-apps/org-manager/billing/checkoutAppearance.ts)
feeds the Appearance API computed Tearleads theme values, resolving actual
colors and sizes because an iframe cannot dereference app CSS variables. The
Stripe base theme is `night` for dark surfaces and `stripe` for light surfaces.

The "Pay on Stripe instead" fallback (behind the `stripe-hosted-checkout`
feature flag) sits under the open form and creates a hosted Checkout Session
for the plan the form shows, opening it in a new tab, with same-tab navigation
when a popup is blocked. It uses the same admin gate, plan check against the
authoritative [Members](../glossary/principals.md#organization-members-group)
count, customer, metadata, and `invoice.paid` association path. The checkout
state runs one way to pay at a time: Stripe's page can be opened only while
the form is collecting, while it opens Pay and the plan picker wait, and the
form closes once the buyer is on Stripe's page. Every answer names the form
that asked: only that form navigates (this tab included, when a pop-up
blocker forces same-tab navigation) and closes, so a late answer for a
cancelled or replaced form changes nothing. On the server, opening Stripe's
page retires the form's unpaid subscription, and the next Pay or plan after
the buyer leaves Stripe's page, or cancels before it opens, expires that
Session, so neither can be paid alongside the other
([attempt rules](revenuecat-billing.md#direct-stripe-checkout-server-side)).
A refusal returns to the form with a notice; a plan the server no longer
offers closes the form and reloads the plans, as at Pay.
Return URLs share the portal route's origin validation.

## Subscription management

Stripe cancellation is inline. `POST /organizations/:id/billing/stripe/cancel`
sets `cancel_at_period_end`; sync continues through the paid period, and
RevenueCat later sends the entitlement loss. The billing snapshot exposes
`canCancelDirectly` on every app surface, so a web purchase can also be
cancelled from a native shell. This flag is independent of `subscriptionSource`:
a native takeover can retain a Stripe subscription that still needs
cancellation. The management endpoint returns only a native store URL; a failed
lookup does not hide Stripe cancel. Members can read the
[organization-level](../glossary/principals.md#organization) cancellation flag;
the cancellation endpoint requires an administrator.

An administrator of an organization with an active Stripe subscription changes
its plan in the billing panel, wherever web checkout runs (never inside a
store app, which allows only the store's own purchases). The panel lists every
plan that covers the roster from the checkout options, marked Upgrade,
Downgrade, Current plan, or Scheduled, with Keep plan on the current plan
while a smaller one is scheduled. Every choice is confirmed first: an upgrade
as a charge of the prorated difference now that applies once paid, a
downgrade as a change at renewal on the period's end date with no credit, and
Keep plan as cancelling the scheduled change. The switcher's state machine
(`model/stripePlanChangeMachine.ts`) runs one change at a time, starting it
only on the confirmation that enters `changing`, and refreshes the billing
snapshot after it. Each request names the capacity the plans were shown
against, so a plan that changed meanwhile is refused rather than charged
differently than shown. A declined upgrade says nothing changed and points to
the website's **Manage subscription** page for a new card; a plan the server
refuses shows its reason and reloads the plans and the billing snapshot. The
plans are also read again when the roster changes elsewhere, since they must
cover it. Switching organization starts a fresh switcher, so a pending
choice or a change in flight never carries over, and an answer that arrives
after the switcher closed or moved to another organization is dropped. The
[server rules](billing-plan-changes.md) cover every platform.

Lost-key cancellation uses Stripe's shareable no-code portal login from the
public website's **Manage subscription** footer link. Stripe emails a secure
login link to the Customer address, so this path does not require Tearleads
authentication. The Stripe portal must allow cancellation at period end, and its
login link must be set as `PUBLIC_STRIPE_CUSTOMER_PORTAL_URL` when the website
is built. After the paid period ends, the old organization
[loses sync](billing-lapse-recovery.md); the buyer
can subscribe again under a newly derived identity whenever they choose.

Production and staging website deployments fail their build when the portal
URL is missing or is not hosted at `https://billing.stripe.com`. Local builds
may omit it and render the not-configured fallback.

Stripe selects the most recently created active Customer when several Customer
objects share an email. Tearleads creates a Customer per buyer and
organization to keep authenticated portal sessions organization-scoped. A
buyer with several simultaneous web subscriptions might therefore need to
cancel them from newest to oldest as each ceases to be active, or contact
support for the older Customer; do not describe the no-code link as a
multi-organization subscription chooser.

Cancellation and the optional portal resolve the live `sub_…` by exact `orgId`
metadata instead of trusting `organization_billing.provider_subscription_id`.
RevenueCat may store an `si_…` subscription-item id there. The metadata match is
rechecked so a pooled customer cannot expose another organization's billing.

For a [native-store](revenuecat-native-stores.md) subscription, the panel opens
RevenueCat's exact management URL, which routes to the App Store or Play
subscription page. The server never tries to cancel a store subscription through
Stripe.

`POST /organizations/:id/billing/stripe/portal` mints an authenticated Stripe
portal session (`ApiClient.createStripePortal`); the billing panel does not
use it. A portal session must be minted on click because its URL is
short-lived.
