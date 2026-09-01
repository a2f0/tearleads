import type { Tearleads } from "@tearleads/client-sdk";
import { createSQLiteRuntime } from "@tearleads/client-sdk/sqlite";
import { cleanup } from "@testing-library/react";
import { type PropsWithChildren, useEffect } from "react";
import {
  APP_HOST_PROFILES,
  type AppHostConfig,
  createAppHostConfig,
} from "../../src/host/AppHostConfig";
import { AppRuntimeProvider } from "../../src/providers/AppRuntimeProvider";
import { useTearleads } from "../../src/providers/sdk/TearleadsProvider";
import { withManualIdentity } from "./manualIdentityProfile";
import { MockWorker } from "./mockWorker";
import { createSharedMemoryLocalKeyringFactory } from "./sharedMemoryLocalKeyring";

// Shared by the identity-manager suites, which drive the manual identity flow
// (Generate Key Pair / Register) and so disable the boot-time autopilot.
//
// Each caller gets its own keyring instance: the factory closes over a Map, and
// bun runs every test file in one process, so a module-level config would leak
// identity keys between files.
export function createIdentityManagerHostConfig(
  options: { readonly browserManagedKeyring?: boolean } = {},
): AppHostConfig {
  const base = createAppHostConfig({
    apiBaseUrl: "http://localhost:3001",
    createSQLiteRuntime: () =>
      createSQLiteRuntime({
        workerConstructor: MockWorker,
      }),
    profile: withManualIdentity(APP_HOST_PROFILES.app),
    wsUrl: "ws://events.example.test",
  });

  // A host-supplied keyring marks the keychain host-managed, which disables PIN
  // locking outright (canManagePinCode, LocalKeyringLockProvider.tsx), so PIN
  // tests must opt into the browser-managed keychain instead. Every other test
  // needs a keyring: without one the SQLite cipher-key resolver refuses to boot
  // (by design — no development-key fallback), leaving the database permanently
  // in "error" and the assertions running against a degraded app.
  return options.browserManagedKeyring
    ? base
    : base.withOverrides({
        createLocalKeyring: createSharedMemoryLocalKeyringFactory(),
      });
}

// These suites assert UI, not transport, so the socket never connects.
export class TestWebSocket extends EventTarget {
  constructor(readonly url: string | URL) {
    super();
  }

  close() {}
}

function TearleadsProbe({
  onReady,
}: {
  onReady: (tearleads: Tearleads) => void;
}) {
  const tearleads = useTearleads();

  useEffect(() => {
    onReady(tearleads);
  }, [onReady, tearleads]);

  return null;
}

export function IdentityManagerTestRuntime({
  children,
  hostConfig,
  onTearleadsReady,
}: PropsWithChildren<{
  hostConfig: AppHostConfig;
  onTearleadsReady: (tearleads: Tearleads) => void;
}>) {
  return (
    <AppRuntimeProvider autoProvisionEnabled={false} hostConfig={hostConfig}>
      <TearleadsProbe onReady={onTearleadsReady} />
      {children}
    </AppRuntimeProvider>
  );
}

export async function cleanupIdentityManagerTestEnvironment(): Promise<void> {
  cleanup();
  // cleanup() unmounts the tree, which only queues TearleadsProvider's dispose
  // (a macrotask, so a StrictMode remount can cancel it). Flush it before the
  // next test starts: with a keyring the database really boots, so an
  // undisposed coordinator would keep issuing requests and sharing the keyring
  // across tests. Mirrors cleanupPaneTestEnvironment.
  await new Promise((resolve) => setTimeout(resolve, 0));
  globalThis.localStorage?.clear();
}
