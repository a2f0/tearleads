# Stripe Checkout Client

The web client runs the card form inside the Tearleads billing panel. Stripe
still hosts the sensitive fields in iframes, but the app owns the surrounding
flow and can style it from its theme tokens.

## Platform seam and configuration

- `DirectCheckoutCapability`
  ([`directCheckout.ts`](../../packages/client-sdk/src/client/directCheckout.ts))
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
Tearleads webhook. A decline leaves the element mounted for correction; cancel
unmounts it.

The payment fields remain Stripe-hosted for PCI SAQ A. The Appearance API is
fed computed Tearleads theme values by
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
