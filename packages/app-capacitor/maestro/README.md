# Maestro end-to-end flows

[Maestro](https://maestro.mobile.dev) flows that drive the real Capacitor app on
a simulator/emulator. These cover behavior that unit tests cannot: identity
provisioning depends on the WebView's real SQLite worker + OPFS, which the
in-process test doubles do not exercise. Provisioning a local identity is
purely local, so these run with **no backend running**.

These are manual native gates. The repository's build-and-test CI jobs are
currently workflow-dispatch-only to conserve Actions credits, and no hosted
Android/iOS simulator job invokes Maestro yet. Run both flows on both platforms
before shipping a change to native database or identity lifecycle behavior.

## Flows

- `first-identity-offline.yaml` — a fresh install auto-generates the first
  identity offline and reaches a usable, keyed state.
- `offline-second-identity.yaml` — provisioning a **second** identity from the
  Identity Manager works offline, yields a genuinely new active identity, then
  repeatedly switches between both identities. Regression test for the
  second-identity provisioning and stale transition-waiter hangs (creating a
  second identity tore down the first identity's SQLite worker and could not
  construct a new one on a WebView; the app now reuses one dedicated worker
  across switches — see `AppHostConfig.reuseDatabaseWorker`).
- `review/subscription-review-screenshots.yaml` — registers or logs in a
  persistent simulator identity against the production API, opens the real
  native Billing surface, verifies the three RevenueCat/StoreKit tiers and
  prices, and captures one App Store review screenshot per tier. Its `review/`
  location keeps this credentialed production flow out of the general offline
  Maestro runner.

## Prerequisites

Maestro must be installed (`curl -fsSL https://get.maestro.mobile.dev | bash`).

## Scripted

`scripts/runMaestroTests.sh [ios|android]` (default `ios`) runs the steps below
end to end: build, sync, native compile, simulator/emulator install, then every
flow in this directory.

## iOS (simulator)

```sh
# Build + install the debug app on a booted simulator. Keep DerivedData
# outside the repo: its SPM checkouts hang ls-lint in the pre-commit hook.
cd packages/app-capacitor
bun run build                                   # web assets
CAPACITOR_BUILD_CONFIGURATION=Debug bunx cap sync ios
xcodebuild -project ios/App/App.xcodeproj -scheme App \
  -configuration Debug -sdk iphonesimulator \
  -derivedDataPath "$TMPDIR/symcrypt-maestro-derived-data" \
  -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=NO build
xcrun simctl boot 'iPhone 16' || true
xcrun simctl install booted \
  "$TMPDIR/symcrypt-maestro-derived-data/Build/Products/Debug-iphonesimulator/App.app"

# Run the flows
maestro --platform ios test maestro/offline-second-identity.yaml
maestro --platform ios test maestro/first-identity-offline.yaml
```

### App Store subscription review screenshots

Run the repository wrapper from any directory:

```sh
./scripts/takeSubscriptionReviewScreenshots.sh
```

It builds and installs the production-id Capacitor shell on an available
`iPhone 16` simulator, points account registration at the production API, runs
the dedicated Maestro flow, and writes these gitignored 1179x2556, non-alpha
PNGs:

```text
.screenshots/app-store-review/subscription-solo.png
.screenshots/app-store-review/subscription-team-5.png
.screenshots/app-store-review/subscription-team-10.png
```

The three products share one catalog screen, so the runner captures that
review-ready screen once for each subscription record. Maestro verifies every
product title and price first; the runner uses `simctl` for the final files
because its framebuffer capture preserves Apple's exact accepted dimensions.

The runner creates and reuses a dedicated `SymCrypt Subscription Review`
iPhone 16 simulator so it never authenticates an unrelated simulator identity
against production. Its first run creates one production screenshot identity;
later runs reuse it. Set `IOS_SCREENSHOT_RUNTIME_VERSION` to override the tested
iOS 18.0 runtime, or `IOS_SCREENSHOT_DEVICE_UDID` to select an existing dedicated
simulator with that exact name, model, and runtime. Set
`SUBSCRIPTION_SCREENSHOT_OUTPUT_DIR` to change the output directory. Override
`VITE_API_BASE_URL` only when a different public API environment is intentional;
dev-only URLs are rejected before simulator state changes. Tests can point
`SUBSCRIPTION_SCREENSHOT_REVENUECAT_ENV_FILE` at an isolated dotenv fixture.

These are native review screenshots, not App Store product-page marketing
screenshots. Do not substitute the resized-browser output from
`scripts/takeScreenshots.sh`: the web shell follows the Stripe purchase path,
while App Review needs evidence of the native App Store subscription surface.

## Android (emulator)

```sh
cd packages/app-capacitor
bun run build
CAPACITOR_BUILD_CONFIGURATION=Debug bunx cap sync android
(cd android && ./gradlew assembleDebug)
# Boot an emulator, then:
adb install -r android/app/build/outputs/apk/debug/app-debug.apk

maestro --platform android test maestro/offline-second-identity.yaml
maestro --platform android test maestro/first-identity-offline.yaml
```

The flows use `launchApp: { clearState: true }`, so each run starts from a clean
install. They match on WebView text (`Explorer`, `Identity Manager`, `Register`,
`New Identity`, …), so the same flow runs unchanged on both platforms.
