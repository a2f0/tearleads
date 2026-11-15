# App Runtime Providers

This directory contains pane-level runtime providers and SDK-backed runtime
hooks: host configuration, identity and the local keyring, database lifecycle,
crypto session state, the SDK runtime
([`sdk/TearleadsProvider.tsx`](sdk/TearleadsProvider.tsx)), API and
server-event state, logging and diagnostics, billing and purchases, file saving
and viewing, sync mode, feature flags, and system bootstrap.

[`AppRuntimeProvider.tsx`](AppRuntimeProvider.tsx) owns the required runtime
provider order for a pane.
Presentation code should use that aggregate provider instead of rebuilding the
individual runtime provider stack.

[`device-reset/`](device-reset/deviceReset.ts) sits above the pane runtimes:
[`DeviceResetGate`](device-reset/DeviceResetGate.tsx) wraps the whole layout in
[`App.tsx`](../App.tsx) and performs a requested device reset before any
provider opens storage.

Domain stores and feature-level context adapters live under
[`../stores/`](../stores/).
Component-local providers may stay under [`components/`](../components/) when
they only support a
local UI subtree.
