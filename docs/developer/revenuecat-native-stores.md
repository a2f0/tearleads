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
- **iOS purchase failures retain content-free diagnostics.** The first-party
  `RevenueCatPurchasePlugin` purchases through RevenueCat's public Swift API and
  returns only active entitlement IDs. On failure it preserves the RevenueCat
  code, cancellation flag, numeric backend subcode, and StoreKit domain/code.
  Android and every non-purchase operation continue through RevenueCat's
  official Capacitor plugin. The System Monitor includes those bounded values
  but still excludes receipt, account, and free-form provider text.
- **A dismissed store sheet is a cancellation, not a failure.** The bridge
  serializes RevenueCat's `PurchasesError` across the native boundary, so what
  arrives is a plain object — `instanceof` cannot work the way it does on web.
  The adapter matches `code === PURCHASE_CANCELLED_ERROR` and rethrows the
  shared `PurchaseCancelledError`, which is the only rejection
  `useSubscribeAction` treats as a no-op. Without it, backing out of the sheet
  surfaces "Failed to subscribe".
- **`abortSignal` is honored before the native purchase call, and only before
  it.** A presented StoreKit or Play sheet has no programmatic dismissal, so the
  abort is checked on entry and again after the adapter's offerings fetch. The
  iOS diagnostic bridge performs a fresh native offerings fetch to resolve the
  package after that point. The abort takes precedence over an unknown package
  so an abandoned flow's outcome stays a pre-sheet abort.
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

## Fastest path: RevenueCat Test Store

Use the Test Store first to prove the app-side flow before waiting on App Store
Connect or Play Console. The project's current `default` offering already has a
`$rc_monthly` package whose Test Store product is `sync_monthly`, attached to
the `sync` entitlement. `@revenuecat/purchases-capacitor` 13.2.1 is newer than
RevenueCat's minimum Test Store-compatible Capacitor SDK (11.2.6).

Pass the public Test Store key as a one-build override. The run scripts preserve
an already-exported value, so the platform keys in `.secrets/root.env` remain
untouched:

```sh
VITE_REVENUECAT_IOS_API_KEY=test_... ./scripts/runIos.sh
VITE_REVENUECAT_ANDROID_API_KEY=test_... ./scripts/runAndroid.sh
```

For an end-to-end staging test, point the mobile bundle at the reachable staging
API instead of the local default:

```sh
VITE_API_BASE_URL=https://api.tearleads.de \
VITE_REVENUECAT_IOS_API_KEY=test_... \
./scripts/runIos.sh
```

Then sign in, open Organization Manager → Billing as an organization admin, and
verify this sequence:

1. The `Sync` monthly option and its price load from the current offering.
2. Subscribe opens the RevenueCat Test Store sheet; cancelling returns without
   a failure message.
3. Completing the purchase activates the `sync` entitlement for the signed-in
   app user in RevenueCat.
4. The RevenueCat customer has the selected organization's `orgId` subscriber
   attribute.
5. With sandbox events enabled on staging, the webhook updates the organization
   billing snapshot and the activation-pending state clears.
6. Restore Purchases completes and the entitlement remains active.

This proves the Capacitor bridge, shared billing UI, identity, org attribution,
webhook, and entitlement mapping. It does not exercise StoreKit or Google Play
Billing. Never submit a build containing a `test_...` key; RevenueCat requires a
platform-specific public key in store builds.

## Dedicated staging store apps

The native staging apps use `com.tearleads.staging.app` on both platforms so
they can coexist with production and keep sandbox store history isolated. The
Android `staging` build variant and the iOS `App-Staging` / `Release-Staging`
pair are selected by `NATIVE_RELEASE_TIER=staging`; the staging release wrappers
set this automatically:

```sh
./scripts/buildAndroidStagingRelease.sh
./scripts/buildIosStagingRelease.sh
./scripts/uploadAndroidStagingRelease.sh
./scripts/uploadIosStagingRelease.sh
```

The production `App` scheme and staging `App-Staging` scheme are both committed
as shared Xcode schemes because Fastlane archives them non-interactively.
Android staging inherits the release build type and deliberately uses the same
upload keystore as production; package IDs and separate store records isolate
the apps, not their signing key.

Builds using the former `com.tearleads.app.staging` identifier can coexist with
the current staging app, but their local data does not carry over because each
identifier has its own app container and keychain prefix. Delete an old staging
install when it is no longer needed; production data is unaffected. The
RevenueCat staging records were renamed in place. Retire any developer-portal
or store test records created with the former identifier manually because the
release lanes never delete external records.

One-time store setup is still required; the release lanes are intentionally
readonly for signing and store records:

1. Register `com.tearleads.staging.app` in Apple Developer and create its App
   Store Connect app record with the In-App Purchase capability.
2. Use the team's match administration workflow to create and commit an App
   Store distribution profile for `com.tearleads.staging.app`. The repo's
   `ios:fetch:appstore-profile:staging` lane only verifies/fetches it with
   `readonly: true`; it cannot generate a missing profile.
3. Create the `com.tearleads.staging.app` Play Console app, grant the configured
   Google Play service account access, and create an internal testing track.
4. Create the corresponding Apple and Google apps in RevenueCat and connect
   their store credentials before adding the public SDK keys below.

Query both staging stores without building with
`bun run --cwd packages/app-capacitor store:build-numbers:staging`.

Create separate RevenueCat Apple and Google apps with that platform identifier,
then set their public keys in `.secrets/staging.env` as
`VITE_REVENUECAT_IOS_API_KEY` and `VITE_REVENUECAT_ANDROID_API_KEY`. Fastlane
loads release credentials from `root.env`, but imports only allowlisted native
RevenueCat client settings from the server-oriented `staging.env`. Explicit
caller overrides still win when they differ from the production platform key.
If staging has no platform key, or resolves to the production key, it fails the
release guard before the store build begins. The production key in `root.env`
is the default comparison baseline. Env-only CI and key-rotation workflows may
instead export the independent
`NATIVE_RELEASE_PRODUCTION_VITE_REVENUECAT_IOS_API_KEY` or
`NATIVE_RELEASE_PRODUCTION_VITE_REVENUECAT_ANDROID_API_KEY` baseline. Without
either the root default or an explicit baseline, staging fails closed. Staging
may override the shared
`VITE_REVENUECAT_SYNC_ENTITLEMENT` when its project uses a different entitlement
identifier. Production releases likewise reject the resolved platform key
unless it exactly matches its independent production baseline. The allowlist
controls dotenv imports only; callers remain responsible for variables they
export explicitly. Add any future root `VITE_*` setting that staging must
inherit intentionally to `NATIVE_SHARED_VITE_ENV_NAMES`; otherwise it is
stripped from staging dotenv imports.

The staging server must also have `REVENUECAT_ALLOW_SANDBOX_EVENTS=true` during
its Ansible deploy. This controls webhook application only; it is separate from
the public SDK keys bundled into the native clients.

The wrappers set their public API default before Fastlane loads dotenv files.
Export `VITE_API_BASE_URL` explicitly when overriding the default; the release
guard requires the exact selected-tier API host and permits WebSocket hosts only
on the selected tier's domain. Fastlane repeats these checks after dotenv is
resolved, so values from `root.env` cannot bypass them. Do not put an API
override in `.secrets/staging.env`.

## Apple sandbox / TestFlight

Before testing the real Apple purchase sheet:

1. In App Store Connect, create the auto-renewable subscription under the app
   being tested (`com.tearleads.staging.app` for staging) and finish its required
   localization, price, and review metadata.
2. Connect that Apple app to RevenueCat, including its In-App Purchase key, and
   import the product. Attach it to `$rc_monthly` in the current `default`
   offering and to the `sync` entitlement.
3. Keep `VITE_REVENUECAT_IOS_API_KEY` set to that Apple app's public `appl_...`
   key. The Xcode project records the In-App Purchase capability and Swift 5;
   StoreKit does not use a code-signing entitlement for in-app purchases, so
   App Store Connect and RevenueCat configuration remain authoritative.
   The project also pins `purchases-ios-spm` to the exact version resolved by
   `@revenuecat/purchases-capacitor`; update that pin and regenerate
   `Package.resolved` in lockstep whenever the Capacitor dependency changes.
4. Create an App Store Connect sandbox tester. For a development-signed build,
   attempt a purchase once and then sign in under **Settings > Developer >
   Sandbox Apple Account**; the production Media & Purchases account can remain
   signed in for this build type.
5. For TestFlight, use a regular Apple Account to download the beta, then sign
   out under **Settings > Apple Account > Media & Purchases**. Do not enter the
   sandbox tester there: sandbox accounts are not iTunes or App Store download
   accounts. Instead, sign in under **Settings > Developer > Sandbox Apple
   Account**, and leave Media & Purchases signed out while testing. Signing the
   regular account back in makes TestFlight purchases use that account rather
   than the configured sandbox tester. TestFlight purchases still run in the
   sandbox environment and do not charge either account.
6. After purchasing, tap **Manage subscription**. iOS presents StoreKit's
   in-app subscription-management sheet for the account StoreKit is currently
   using; dismissing it refreshes the billing snapshot.
7. Repeat the cancel/restore checks above and confirm the transaction appears
   with sandbox data enabled in RevenueCat.

An Xcode StoreKit configuration file is useful for local StoreKit behavior, but
its product must still exist in RevenueCat and its certificate must be uploaded
to the RevenueCat Apple app. A physical device or TestFlight remains the final
check for the real store integration.

## Google Play sandbox

Before testing the real Google Play purchase sheet:

1. In Play Console, create and activate the subscription product and base plan
   for application ID `com.tearleads.app`.
2. Connect that Google app and its service credentials to RevenueCat, import the
   product, and attach it to `$rc_monthly` plus the `sync` entitlement.
3. Keep `VITE_REVENUECAT_ANDROID_API_KEY` set to that Google app's public
   `goog_...` key. The activity uses `singleTop`, so returning from a banking or
   verification app does not cancel the purchase flow.
4. Upload a signed bundle to a Play testing track, make it available in the
   tester's country, add the account as both a track tester and a license tester,
   and open the track opt-in URL with that account.
5. Test on a device signed into only that licensed tester account (or a Play
   Services emulator), then confirm purchase/cancel/restore and RevenueCat's
   sandbox transaction.

The Google Billing permission is contributed by the SDK's Play Billing
dependency during manifest merging.

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
is unrecorded — there is no Apple/Google store product and no seat semantics for
a store purchase. Until that is settled:

- A store subscription carries no quantity. Stripe is the seat-quantity authority
  for web (see [revenuecat-billing.md](./revenuecat-billing.md#per-seat-behavior)),
  and neither the App Store nor Play Billing can carry the
  server-authoritative Members count the way a Stripe subscription item does.
- Cancel is provider-managed. The panel's inline cancel is Stripe-only; a store
  subscription surfaces **Manage subscription** instead. Apple management URLs
  open StoreKit's in-app sheet on iOS, while other provider URLs retain the
  external-page behavior.

The Test Store checklist above is therefore an integration proof, not a product
decision. Before real store products are offered, decide whether a mobile
subscription licenses one organization at a fixed capacity, is single-user
only, or maps to another server-enforced seat model. Store subscriptions do not
carry Stripe-style item quantity.
