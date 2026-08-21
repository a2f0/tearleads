# Capacitor Source

This directory is the composition layer for the Capacitor deployment target.
`index.tsx` builds the app host configuration from adapters in these focused
areas:

- `billing/` owns native purchases, RevenueCat bridge integration, subscription
  management, and the native-store contract tests.
- `device/` owns app-lifecycle, keyboard, network, camera, and status-bar
  integration.
- `files/` owns cache staging, native sharing, and native file viewing.

Tests stay beside the adapter or native contract they cover; shared test
fixtures live under `../tests/`. Reusable behavior belongs in `app` or
`@symcrypt/client-sdk`; this package should only compose those facades with
Capacitor plugins and must not become a reusable dependency.

The database worker bundle is built by `scripts/buildWorker.ts` from the public
`@symcrypt/sqlite-worker/assets` entrypoint rather than from a local source
shim.
