import { afterEach, expect, test } from "bun:test";
import type { SymCrypt } from "@symcrypt/client-sdk";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
} from "@symcrypt/crypto";
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

test("local-only identity can log in without a persisted user id", async () => {
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

    fireEvent.click(view.getByRole("button", { name: "General" }));

    await waitFor(() => {
      expect(symcryptRef.current).toBeTruthy();
    });
    const symcrypt = symcryptRef.current;
    if (!symcrypt) {
      throw new Error("Expected SymCrypt SDK to be available after render.");
    }

    await act(async () => {
      await symcrypt.identity.setKeyPairs({
        encapsulationKeyPair: generateKemSeedAndKeyPair(),
        signingKeyPair: generateSigningSeedAndKeyPair(),
      });
    });

    expect(symcrypt.session.userId).toBeNull();
    expect(symcrypt.session.isAuthenticated).toBe(false);
    expect(await view.findByRole("button", { name: "Login" })).toBeTruthy();
  } finally {
    Reflect.set(globalThis, "WebSocket", originalWebSocket);
  }
});

test("logged-out active sessions gate and perform login", async () => {
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

    fireEvent.click(view.getByRole("button", { name: "Active Sessions" }));

    await waitFor(() => {
      expect(symcryptRef.current).toBeTruthy();
    });
    const symcrypt = symcryptRef.current;
    if (!symcrypt) {
      throw new Error("Expected SymCrypt SDK to be available after render.");
    }

    expect(view.queryByRole("button", { name: "Login" })).toBeNull();

    await act(async () => {
      await symcrypt.identity.setKeyPairs({
        encapsulationKeyPair: generateKemSeedAndKeyPair(),
        signingKeyPair: generateSigningSeedAndKeyPair(),
      });
    });

    expect(symcrypt.session.isAuthenticated).toBe(false);
    expect(
      view.getByText("Log in to view and manage active sessions."),
    ).toBeTruthy();
    expect(view.getByRole("button", { name: "Login" })).toBeTruthy();
    expect(view.queryByRole("table")).toBeNull();

    fireEvent.click(view.getByRole("button", { name: "Login" }));

    expect(await view.findByRole("table")).toBeTruthy();
    expect(
      view.queryByText("Log in to view and manage active sessions."),
    ).toBeNull();
  } finally {
    Reflect.set(globalThis, "WebSocket", originalWebSocket);
  }
});
