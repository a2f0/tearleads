// Contract for the renderer -> Bun telemetry-consent bridge. The main process
// reports its own failures, but the user's anonymous-telemetry choice lives in
// the renderer's storage, so the renderer posts it here at boot and on every
// change (see src/renderer/mainProcessTelemetryConsent.ts). Kept in one module
// both build targets import so the path and header can't drift.

export const ELECTROBUN_TELEMETRY_CONSENT_PATH =
  "/__electrobun/telemetry-consent";

// Carries the choice. Being a custom header, it also rejects cross-origin
// simple POSTs, which cannot set one, so no other page can opt the user in.
export const ELECTROBUN_TELEMETRY_CONSENT_HEADER =
  "x-electrobun-telemetry-consent";
