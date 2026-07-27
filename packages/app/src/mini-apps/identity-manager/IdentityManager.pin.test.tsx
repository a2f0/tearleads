import { afterEach, expect, test } from "bun:test";
import type { Tearleads } from "@tearleads/client-sdk";
import { fireEvent, render, waitFor } from "@testing-library/react";
import {
  cleanupIdentityManagerTestEnvironment,
  createIdentityManagerHostConfig,
  IdentityManagerTestRuntime,
  TestWebSocket,
} from "../../../test/helpers/identityManagerTestRuntime";
import "../../../test/helpers/mswServer";
import { IdentityManager } from "./IdentityManager";

const BROWSER_KEYRING_HOST_CONFIG = createIdentityManagerHostConfig({
  browserManagedKeyring: true,
});

afterEach(cleanupIdentityManagerTestEnvironment);

test("PIN lock setup waits for a generated local key pair", async () => {
  const originalIndexedDB = globalThis.indexedDB;
  const hadIndexedDB = "indexedDB" in globalThis;
  const originalWebSocket = globalThis.WebSocket;
  const tearleadsRef: { current: Tearleads | null } = { current: null };

  try {
    Reflect.set(globalThis, "indexedDB", originalIndexedDB ?? {});
    Reflect.set(globalThis, "WebSocket", TestWebSocket);
    const view = render(
      <IdentityManagerTestRuntime
        hostConfig={BROWSER_KEYRING_HOST_CONFIG}
        onTearleadsReady={(sdk) => {
          tearleadsRef.current = sdk;
        }}
      >
        <IdentityManager />
      </IdentityManagerTestRuntime>,
    );

    fireEvent.click(view.getByRole("button", { name: "PIN Lock" }));

    await waitFor(() => {
      expect(tearleadsRef.current).toBeTruthy();
      expect(
        view.getByText("Generate a key pair first to enable PIN locking."),
      ).toBeTruthy();
    });
  } finally {
    Reflect.set(globalThis, "WebSocket", originalWebSocket);
    if (hadIndexedDB) {
      Reflect.set(globalThis, "indexedDB", originalIndexedDB);
    } else {
      Reflect.deleteProperty(globalThis, "indexedDB");
    }
  }
});
