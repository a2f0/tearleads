import { afterEach, expect, test } from "bun:test";
import type { Tearleads } from "@tearleads/client-sdk";
import { createSQLiteRuntime } from "@tearleads/client-sdk/sqlite";
import { createIdentitySeedPhraseFromEntropy } from "@tearleads/crypto";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import { type PropsWithChildren, useEffect } from "react";
import { withManualIdentity } from "../../../test/helpers/manualIdentityProfile";
import { MockWorker } from "../../../test/helpers/mockWorker";
import "../../../test/helpers/mswServer";
import { createSharedMemoryLocalKeyringFactory } from "../../../test/helpers/sharedMemoryLocalKeyring";
import { APP_HOST_PROFILES, AppHostConfig } from "../../host/AppHostConfig";
import { AppRuntimeProvider } from "../../providers/AppRuntimeProvider";
import { useTearleads } from "../../providers/sdk/TearleadsProvider";
import { IdentityManager } from "./IdentityManager";

class TestWebSocket extends EventTarget {
  constructor(readonly url: string | URL) {
    super();
  }

  close() {}
}

const TEST_HOST_CONFIG = new AppHostConfig(
  "http://localhost:3001",
  "ws://events.example.test",
  () =>
    createSQLiteRuntime({
      workerConstructor: MockWorker,
    }),
).withOverrides({
  createLocalKeyring: createSharedMemoryLocalKeyringFactory(),
  profile: withManualIdentity(APP_HOST_PROFILES.app),
});

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

function IdentityManagerTestRuntime({
  children,
  onTearleadsReady,
}: PropsWithChildren<{ onTearleadsReady: (tearleads: Tearleads) => void }>) {
  return (
    <AppRuntimeProvider
      autoProvisionEnabled={false}
      hostConfig={TEST_HOST_CONFIG}
    >
      <TearleadsProbe onReady={onTearleadsReady} />
      {children}
    </AppRuntimeProvider>
  );
}

afterEach(() => {
  cleanup();
  globalThis.localStorage?.clear();
});

test("identity manager exposes the recovery key for seed-backed identities", async () => {
  const originalWebSocket = globalThis.WebSocket;
  const tearleadsRef: { current: Tearleads | null } = { current: null };

  try {
    Reflect.set(globalThis, "WebSocket", TestWebSocket);
    const view = render(
      <IdentityManagerTestRuntime
        onTearleadsReady={(sdk) => {
          tearleadsRef.current = sdk;
        }}
      >
        <IdentityManager />
      </IdentityManagerTestRuntime>,
    );

    await waitFor(() => {
      expect(tearleadsRef.current).toBeTruthy();
    });

    const tearleads = tearleadsRef.current;
    if (!tearleads) {
      throw new Error("Expected Tearleads SDK to be available after render.");
    }

    const seedPhrase = createIdentitySeedPhraseFromEntropy(
      new Uint8Array(32).fill(0xab),
    );

    await act(async () => {
      await tearleads.identity.importSeedPhrase(seedPhrase);
    });

    expect(await view.findByDisplayValue(seedPhrase)).toBeTruthy();
    expect(
      await view.findByRole("button", { name: "Copy recovery key" }),
    ).toBeTruthy();
    expect(
      await view.findByRole("button", { name: "Download Recovery Key" }),
    ).toBeTruthy();
  } finally {
    Reflect.set(globalThis, "WebSocket", originalWebSocket);
  }
});

test("identity manager restores a recovery key from a typed passphrase", async () => {
  const originalWebSocket = globalThis.WebSocket;
  const tearleadsRef: { current: Tearleads | null } = { current: null };

  try {
    Reflect.set(globalThis, "WebSocket", TestWebSocket);
    const view = render(
      <IdentityManagerTestRuntime
        onTearleadsReady={(sdk) => {
          tearleadsRef.current = sdk;
        }}
      >
        <IdentityManager />
      </IdentityManagerTestRuntime>,
    );

    await waitFor(() => {
      expect(tearleadsRef.current).toBeTruthy();
    });

    const tearleads = tearleadsRef.current;
    if (!tearleads) {
      throw new Error("Expected Tearleads SDK to be available after render.");
    }

    const seedPhrase = createIdentitySeedPhraseFromEntropy(
      new Uint8Array(32).fill(0xcd),
    );
    const restoreInput = await view.findByLabelText("Restore passphrase");

    fireEvent.change(restoreInput, {
      target: { value: seedPhrase.toUpperCase() },
    });
    fireEvent.click(
      view.getByRole("button", { name: "Restore from Passphrase" }),
    );

    await waitFor(() => {
      expect(tearleads.identity.seedPhrase).toBe(seedPhrase);
    });
    expect(await view.findByDisplayValue(seedPhrase)).toBeTruthy();
    expect(view.getByText("Recovery key restored.")).toBeTruthy();
  } finally {
    Reflect.set(globalThis, "WebSocket", originalWebSocket);
  }
});
