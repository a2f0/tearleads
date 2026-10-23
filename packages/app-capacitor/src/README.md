# Capacitor Source

This directory is the composition layer for the Capacitor deployment target.
`index.tsx` builds the app host configuration from adapters in these focused
areas:

- `billing/` owns native purchases, RevenueCat bridge integration, subscription
  management, and the native-store contract tests.
- `device/` owns app-lifecycle connection refresh, keyboard, network, camera
  scanning, and status-bar integration.
- `diagnostics/` owns the native Sentry configuration and the source-map
  release pipeline tests.
- `files/` owns cache staging, native sharing, and native file viewing.

Tests stay beside the adapter or native contract they cover; shared test kits,
fixtures, and release-script tests live under `../tests/`. Reusable behavior
belongs in `app` or `@tearleads/client-sdk`; this package only composes those
facades with Capacitor plugins and must not become a reusable dependency.

`scripts/buildWorker.ts` copies the SDK's prebuilt SQLite worker and WASM
(`@tearleads/client-sdk/sqlite/*`) and the PDF.js worker assets into
`public/`.
