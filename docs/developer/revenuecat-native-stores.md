# RevenueCat Native Stores

How the App Store and Play Store lane differs from the web lane described in
[revenuecat-billing.md](./revenuecat-billing.md). Web sells through direct Stripe
checkout and keeps RevenueCat only for entitlement mirroring; the native shells
have no direct-checkout capability, so they keep RevenueCat's provider-hosted
store sheet.

## The client adapter

The billing panel expresses the split as one gate — `purchaseAvailable &&
!checkout.available` in `BillingPanel` — rather than a per-platform branch: web
supplies `createDirectCheckout` and so hides the RevenueCat subscribe list,
Capacitor supplies only `createPurchases` and so keeps it.

[`capacitorPurchases.ts`](../../packages/app-capacitor/src/capacitorPurchases.ts)
adapts `@revenuecat/purchases-capacitor` to the shared `RevenueCatBackend`. What
is specific to the native bridge, as opposed to the web one:

- **The bridge is untyped at runtime.** A `CustomerInfo` or package can arrive
  partial or nullish, so every field read is guarded rather than trusted; a bad
  payload reads as "no entitlement", never a crash.
- **A dismissed store sheet is a cancellation, not a failure.** The bridge
  serializes RevenueCat's `PurchasesError` across the native boundary, so what
  arrives is a plain object — `instanceof` cannot work the way it does on web.
  The adapter matches `code === PURCHASE_CANCELLED_ERROR` and rethrows the
  shared `PurchaseCancelledError`, which is the only rejection
  `useSubscribeAction` treats as a no-op. Without it, backing out of the sheet
  surfaces "Failed to subscribe".
- **`abortSignal` is honored before the sheet, and only before it.** A presented
  StoreKit or Play sheet has no programmatic dismissal, so the abort is checked
  on entry and again after the offerings fetch — the last await before the sheet
  goes up. It takes precedence over an unknown package so an abandoned flow's
  outcome stays a pre-sheet abort.
- **Configure binds the known buyer.** `Purchases.configure` receives the
  `appUserID` when the sdk has one; configuring anonymously and aliasing on the
  following `logIn` leaves a stray anonymous customer per fresh install.
- **Org binding rides the subscriber attribute.** A native store purchase
  carries no transaction metadata, so `orgId` is set as a customer-level
  subscriber attribute immediately before the purchase and the webhook resolves
  against it. Unlike the Web Billing metadata this is **mutable** — a later
  purchase for another org overwrites it — so it cannot attribute a purchase
  that completes after another has started.

The key is selected by `Capacitor.getPlatform()`, and the Capacitor web preview
(`cap run` in a browser) always gets the unavailable stub: it has no store
bridge, regardless of which keys are inlined.

## Getting the SDK key into a dev build

Fastlane's `Dotenv.load` puts the whole of `.secrets/root.env` into the
environment before it shells out to `bun run build`, and Vite folds
`VITE_`-prefixed `process.env` vars into `import.meta.env` — that is the entire
chain for a store release.

The dev run-on-device scripts have no Fastlane in the path, so `runIos.sh` and
`runAndroid.sh` read the same file through
[`exportRevenueCatKeys.sh`](../../scripts/exportRevenueCatKeys.sh). Without it a
simulator or device build inlines no key, `createCapacitorPurchases()` returns
the unavailable stub, and the billing panel offers no purchase to exercise. Each
script prints whether its platform's key made it in. An already-exported value
wins, so a one-off key can be passed inline.

## Sandbox events

A purchase made against a store sandbox — StoreKit sandbox, TestFlight, Play
internal testing — costs the tester nothing but reaches the RevenueCat webhook as
an event otherwise **indistinguishable** from a paid one: same type, same
entitlement, same subscriber attributes. The only difference is the event's
`environment` field (`SANDBOX` / `PRODUCTION`).

Stripe-store events are exempt from the guard: RevenueCat marks Stripe
*test-mode* transactions `SANDBOX` too, and gating them would stop a tier that
tests direct Stripe checkout with test-mode keys from applying its own web
billing. What stands in for the guard there is Stripe's own attribution — a
foreign-mode subscription resolves through neither the durable binding nor the
exact `sub_…` lookup, both of which run against that tier's own Stripe key and
fail closed.

`classifyRevenueCatEvent` therefore ignores sandbox events unless the tier sets
`REVENUECAT_ALLOW_SANDBOX_EVENTS=true`. It fails closed, so production simply
omits the variable; set it on the tier where native purchases are exercised, or
sandbox testing there will look like a webhook that silently does nothing.

- Both halves are ignored, not just grants. Applying a sandbox *revoke* against
  a production tier could disable sync an organization actually paid for.
- An ignored sandbox event is still recorded and acknowledged, so RevenueCat
  stops redelivering it, and the drop is logged with the event's type, store,
  and environment. The stored row records the ignore but not the environment, so
  the log line is what identifies it as a sandbox drop. It is claimed by event
  id, so flipping the flag on afterwards does **not** reprocess it — make a
  fresh purchase.
- An event with **no** `environment` is treated as production: RevenueCat has not
  always sent the field, and a redelivered old event must keep its paid meaning.

Because this is a tier-level policy rendered by ansible
([`api.env.j2`](../../ansible/playbooks/templates/etc/tearleads/api.env.j2)), it
only reaches a deployed server through the **ansible** deploy step, like the
webhook secret.

## Not yet decided

The native lane can observe and mirror entitlements today, but what it *sells*
is unrecorded — there is no store product, no RevenueCat offering, and no seat
semantics for a store purchase. Until that is settled:

- A store subscription carries no quantity. Stripe is the seat-quantity authority
  for web (see [revenuecat-billing.md](./revenuecat-billing.md#per-seat-behavior)),
  and neither the App Store nor Play Billing can carry the
  server-authoritative Members count the way a Stripe subscription item does.
- Cancel is provider-managed. The panel's inline cancel is Stripe-only; a store
  subscription surfaces the RevenueCat management URL instead, which resolves to
  the platform's own subscriptions page.
