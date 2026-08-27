# Stripe Checkout Client

The web client runs the card form inside the SymCrypt billing panel. Stripe
still hosts the sensitive fields in iframes, but the app owns the surrounding
flow and can style it from its theme tokens.

## Platform seam and configuration

- `DirectCheckoutCapability`
  ([`directCheckout.ts`](../../packages/client-sdk/src/client/billing/directCheckout.ts))
  is injected through `AppHostConfig.createDirectCheckout`. The web shell
  supplies [`webDirectCheckout.ts`](../../packages/app-web/src/webDirectCheckout.ts);
  other shells use `createUnavailableDirectCheckout`, so shared UI gates on
  capability instead of platform branches.
- `BUN_PUBLIC_STRIPE_PUBLISHABLE_KEY` enables the web capability and is inlined
  by `deployAppWeb.sh`. There is no RevenueCat web-purchase fallback.
- Stripe loads from `@stripe/stripe-js/pure`, deferring Stripe.js and its fraud
  signals until someone opens checkout instead of downloading them at startup.
- The server pins the subscription to `card`. Redirect-based methods are not
  compatible with the client's `redirect: "if_required"` confirmation flow.

## Purchase flow

`useDirectCheckoutFlow` loads the server-selected option, creates checkout,
mounts the Payment Element, confirms, and hands off to activation polling. The
entitlement arrives asynchronously through Stripe, RevenueCat, and the
SymCrypt webhook. A decline leaves the element mounted for correction; cancel
unmounts it.

The surrounding SymCrypt form requires a billing email before inline checkout.
Confirmation sends it as the PaymentMethod billing email while the embedded
Payment Element hides its duplicate email field. On the first paid invoice, the
server first applies the entitlement, then copies the saved payment-method
address onto the Stripe Customer before acknowledging the webhook. Hosted
Checkout collects a missing Customer email itself. This address is billing
recovery data; it is not part of the key-derived SymCrypt identity.

The payment fields remain Stripe-hosted for PCI SAQ A. The Appearance API is
fed computed SymCrypt theme values by
[`checkoutAppearance.ts`](../../packages/app/src/mini-apps/org-manager/billing/checkoutAppearance.ts).
It resolves actual colors and sizes because an iframe cannot dereference app
CSS variables. The Stripe base theme is `night` for dark surfaces and `stripe`
for light surfaces.

The "Pay on Stripe instead" fallback creates a hosted Checkout Session and
opens it in a new tab, with same-tab navigation when a popup is blocked. It
uses the same admin gate, authoritative Members count, customer, metadata, and
`invoice.paid` association path. Return URLs share the portal route's origin
validation.

## Subscription management

Stripe cancellation is inline. `POST
/organizations/:id/billing/stripe/cancel` sets `cancel_at_period_end`; sync
continues through the paid period, and RevenueCat later sends the entitlement
loss. The management endpoint exposes direct cancellation on every app surface,
so a web purchase can also be cancelled from a native shell.

Lost-key cancellation uses Stripe's shareable no-code portal login from the
public website's **Manage subscription** footer link. Stripe emails a secure
login link to the Customer address, so this path does not require SymCrypt
authentication. The Stripe portal must allow cancellation at period end and
its login link must be configured as
`PUBLIC_STRIPE_CUSTOMER_PORTAL_URL` when the website is built. After the paid
period ends, the old organization loses sync; the buyer can subscribe again
under a newly derived identity whenever they choose.

Production and staging website deployments fail their build when the portal
URL is missing or is not hosted at `https://billing.stripe.com`. Local builds
may omit it and render the not-configured fallback.

Stripe selects the most recently created active Customer when several Customer
objects share an email. SymCrypt currently creates a Customer per buyer and
organization to keep authenticated portal sessions organization-scoped. A
buyer with several simultaneous web subscriptions might therefore need to
cancel them from newest to oldest as each ceases to be active, or contact
support for the older Customer; do not describe the no-code link as a
multi-organization subscription chooser.

Cancellation and the optional portal resolve the live `sub_…` by exact `orgId`
metadata instead of trusting `organization_billing.provider_subscription_id`.
RevenueCat may store an `si_…` subscription-item id there. The metadata match is
rechecked so a pooled customer cannot expose another organization's billing.

For a native-store subscription, the panel opens RevenueCat's exact management
URL, which routes to the App Store or Play subscription page. The server never
tries to cancel a store subscription through Stripe.

The `/billing/stripe/portal` route remains available for future card-update or
invoice-history UI. A portal session must be minted on click because its URL is
short-lived.
