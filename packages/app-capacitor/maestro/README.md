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

## Prerequisites

Maestro must be installed (`curl -fsSL https://get.maestro.mobile.dev | bash`).

## iOS (simulator)

```sh
# Build + install the debug app on a booted simulator
cd packages/app-capacitor
bun run build                                   # web assets
CAPACITOR_BUILD_CONFIGURATION=Debug bunx cap sync ios
xcodebuild -project ios/App/App.xcodeproj -scheme App \
  -configuration Debug -sdk iphonesimulator \
  -derivedDataPath build -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=NO build
xcrun simctl boot 'iPhone 16' || true
xcrun simctl install booted build/Build/Products/Debug-iphonesimulator/App.app

# Run the flows
maestro --platform ios test maestro/offline-second-identity.yaml
maestro --platform ios test maestro/first-identity-offline.yaml
```

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
