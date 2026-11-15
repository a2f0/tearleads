import { createSQLiteRuntime } from "@tearleads/client-sdk/sqlite";

// Capacitor serves the web bundle from the scheme root (https://localhost/ on
// Android, capacitor://localhost/ on iOS). The worker URL must be root-absolute:
// a relative one resolves against the current route, so a worker created after
// navigating (for example on /app/identity-manager/) loads a missing asset.
const CAPACITOR_SQLITE_WORKER_URL = "/worker.js";

// Dedicated worker (not the cross-tab shared-owner coordinator). A Capacitor
// WebView is a single tab, so cross-tab coordination buys nothing; and the app
// keeps ONE dedicated worker across identity switches (see
// AppHostConfig.reuseDatabaseWorker) by closing the current database and
// re-initializing the same worker onto the next one, which requires a dedicated
// worker (a cross-tab client's `close` stops the shared owner). When that reuse
// fails, for example when the outgoing close times out, the app terminates the
// worker and creates a fresh one from this same URL.
export function createCapacitorSQLiteRuntime(
  workerConstructor: typeof globalThis.Worker = globalThis.Worker,
) {
  return createSQLiteRuntime({
    sharedWorkerConstructor: null,
    workerConstructor,
    workerUrl: CAPACITOR_SQLITE_WORKER_URL,
  });
}
