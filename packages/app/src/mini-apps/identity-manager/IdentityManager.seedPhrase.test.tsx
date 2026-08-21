import { afterEach, expect, test } from "bun:test";
import type { SymCrypt } from "@symcrypt/client-sdk";
import { createIdentitySeedPhraseFromEntropy } from "@symcrypt/crypto";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import {
  createIdentityManagerHostConfig,
  IdentityManagerTestRuntime,
  TestWebSocket,
} from "../../../test/helpers/identityManagerTestRuntime";
import { cleanupRecoveryKeyTestEnvironment } from "../../../test/helpers/recoveryKeyTestKit";
import "../../../test/helpers/mswServer";
import { IdentityManager } from "./IdentityManager";

const TEST_HOST_CONFIG = createIdentityManagerHostConfig();

afterEach(cleanupRecoveryKeyTestEnvironment);

test("identity manager exposes the recovery key for seed-backed identities", async () => {
  const originalWebSocket = globalThis.WebSocket;
  const symcryptRef: { current: SymCrypt | null } = { current: null };

  try {
    Reflect.set(globalThis, "WebSocket", TestWebSocket);
    const view = render(
      <IdentityManagerTestRuntime
        hostConfig={TEST_HOST_CONFIG}
        onSymCryptReady={(sdk) => {
          symcryptRef.current = sdk;
        }}
      >
        <IdentityManager />
      </IdentityManagerTestRuntime>,
    );

    fireEvent.click(view.getByRole("button", { name: "Recovery Key" }));

    expect(view.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Backup",
      "Recovery",
    ]);
    expect(
      view.getByRole("tab", { name: "Backup" }).getAttribute("aria-selected"),
    ).toBe("true");
    expect(view.queryByLabelText("Restore passphrase")).toBeNull();

    await waitFor(() => {
      expect(symcryptRef.current).toBeTruthy();
    });

    const symcrypt = symcryptRef.current;
    if (!symcrypt) {
      throw new Error("Expected SymCrypt SDK to be available after render.");
    }

    const seedPhrase = createIdentitySeedPhraseFromEntropy(
      new Uint8Array(32).fill(0xab),
    );

    await act(async () => {
      await symcrypt.identity.importSeedPhrase(seedPhrase);
    });

    expect(
      await view.findByRole("button", { name: "Reveal Recovery Key" }),
    ).toBeTruthy();
    // The passphrase stays off screen until the disclosure is acknowledged.
    expect(view.queryByDisplayValue(seedPhrase)).toBeNull();
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
  const symcryptRef: { current: SymCrypt | null } = { current: null };

  try {
    Reflect.set(globalThis, "WebSocket", TestWebSocket);
    const view = render(
      <IdentityManagerTestRuntime
        hostConfig={TEST_HOST_CONFIG}
        onSymCryptReady={(sdk) => {
          symcryptRef.current = sdk;
        }}
      >
        <IdentityManager />
      </IdentityManagerTestRuntime>,
    );

    fireEvent.click(view.getByRole("button", { name: "Recovery Key" }));
    fireEvent.click(view.getByRole("tab", { name: "Recovery" }));

    await waitFor(() => {
      expect(symcryptRef.current).toBeTruthy();
    });

    const symcrypt = symcryptRef.current;
    if (!symcrypt) {
      throw new Error("Expected SymCrypt SDK to be available after render.");
    }

    const seedPhrase = createIdentitySeedPhraseFromEntropy(
      new Uint8Array(32).fill(0xcd),
    );
    const restoreInput = await view.findByLabelText("Restore passphrase");
    expect(
      view.getByRole("tab", { name: "Recovery" }).getAttribute("aria-selected"),
    ).toBe("true");
    expect(
      view.queryByRole("button", { name: "Reveal Recovery Key" }),
    ).toBeNull();

    fireEvent.change(restoreInput, {
      target: {
        value: `\n${seedPhrase.toUpperCase().replaceAll(" ", "  ")}\n`,
      },
    });
    fireEvent.click(
      view.getByRole("button", { name: "Restore from Passphrase" }),
    );

    await waitFor(() => {
      expect(symcrypt.identity.seedPhrase).toBe(seedPhrase);
    });
    // A restored key is a new key: it stays hidden until acknowledged.
    fireEvent.click(view.getByRole("tab", { name: "Backup" }));
    expect(
      await view.findByRole("button", { name: "Reveal Recovery Key" }),
    ).toBeTruthy();
    expect(view.queryByDisplayValue(seedPhrase)).toBeNull();
    expect(view.getByText("Recovery key restored.")).toBeTruthy();
  } finally {
    Reflect.set(globalThis, "WebSocket", originalWebSocket);
  }
});
