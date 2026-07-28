import { afterEach, expect, test } from "bun:test";
import type { Tearleads } from "@tearleads/client-sdk";
import { createIdentitySeedPhraseFromEntropy } from "@tearleads/crypto";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import {
  cleanupIdentityManagerTestEnvironment,
  createIdentityManagerHostConfig,
  IdentityManagerTestRuntime,
  TestWebSocket,
} from "../../../test/helpers/identityManagerTestRuntime";
import "../../../test/helpers/mswServer";
import { IdentityManager } from "./IdentityManager";

const TEST_HOST_CONFIG = createIdentityManagerHostConfig();

afterEach(cleanupIdentityManagerTestEnvironment);

test("identity manager exposes the recovery key for seed-backed identities", async () => {
  const originalWebSocket = globalThis.WebSocket;
  const tearleadsRef: { current: Tearleads | null } = { current: null };

  try {
    Reflect.set(globalThis, "WebSocket", TestWebSocket);
    const view = render(
      <IdentityManagerTestRuntime
        hostConfig={TEST_HOST_CONFIG}
        onTearleadsReady={(sdk) => {
          tearleadsRef.current = sdk;
        }}
      >
        <IdentityManager />
      </IdentityManagerTestRuntime>,
    );

    fireEvent.click(view.getByRole("button", { name: "Recovery Key" }));

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
    expect(view.queryByText("Available")).toBeNull();
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
        hostConfig={TEST_HOST_CONFIG}
        onTearleadsReady={(sdk) => {
          tearleadsRef.current = sdk;
        }}
      >
        <IdentityManager />
      </IdentityManagerTestRuntime>,
    );

    fireEvent.click(view.getByRole("button", { name: "Recovery Key" }));

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
      target: {
        value: `\n${seedPhrase.toUpperCase().replaceAll(" ", "  ")}\n`,
      },
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
