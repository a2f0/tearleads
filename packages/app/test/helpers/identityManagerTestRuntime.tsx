import type { SymCrypt } from "@symcrypt/client-sdk";
import { createSQLiteRuntime } from "@symcrypt/client-sdk/sqlite";
import { cleanup } from "@testing-library/react";
import { type PropsWithChildren, useEffect } from "react";
import {
  APP_HOST_PROFILES,
  type AppHostConfig,
  createAppHostConfig,
} from "../../src/host/AppHostConfig";
import { AppRuntimeProvider } from "../../src/providers/AppRuntimeProvider";
import { useSymCrypt } from "../../src/providers/sdk/SymCryptProvider";
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

function SymCryptProbe({ onReady }: { onReady: (symcrypt: SymCrypt) => void }) {
  const symcrypt = useSymCrypt();

  useEffect(() => {
    onReady(symcrypt);
  }, [onReady, symcrypt]);

  return null;
}

export function IdentityManagerTestRuntime({
  children,
  hostConfig,
  onSymCryptReady,
}: PropsWithChildren<{
  hostConfig: AppHostConfig;
  onSymCryptReady: (symcrypt: SymCrypt) => void;
}>) {
  return (
    <AppRuntimeProvider autoProvisionEnabled={false} hostConfig={hostConfig}>
      <SymCryptProbe onReady={onSymCryptReady} />
      {children}
    </AppRuntimeProvider>
  );
}

export async function cleanupIdentityManagerTestEnvironment(): Promise<void> {
  cleanup();
  // cleanup() unmounts the tree, which only queues SymCryptProvider's dispose
  // (a macrotask, so a StrictMode remount can cancel it). Flush it before the
  // next test starts: with a keyring the database really boots, so an
  // undisposed coordinator would keep issuing requests and sharing the keyring
  // across tests. Mirrors cleanupPaneTestEnvironment.
  await new Promise((resolve) => setTimeout(resolve, 0));
  globalThis.localStorage?.clear();
}
