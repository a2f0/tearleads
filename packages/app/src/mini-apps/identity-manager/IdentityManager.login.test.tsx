import { afterEach, expect, test } from "bun:test";
import type { Tearleads } from "@tearleads/client-sdk";
import { generateSigningSeedAndKeyPair } from "@tearleads/crypto";
import { act, render, waitFor } from "@testing-library/react";
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

    await waitFor(() => {
      expect(tearleadsRef.current).toBeTruthy();
    });
    const tearleads = tearleadsRef.current;
    if (!tearleads) {
      throw new Error("Expected Tearleads SDK to be available after render.");
    }

    await act(async () => {
      await tearleads.identity.setKeyPairs({
        encapsulationKeyPair: null,
        signingKeyPair: generateSigningSeedAndKeyPair(),
      });
    });

    expect(tearleads.session.userId).toBeNull();
    expect(tearleads.session.isAuthenticated).toBe(false);
    expect(await view.findByRole("button", { name: "Login" })).toBeTruthy();
  } finally {
    Reflect.set(globalThis, "WebSocket", originalWebSocket);
  }
});

test("logged-out identity hides the active sessions section", async () => {
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

    await waitFor(() => {
      expect(tearleadsRef.current).toBeTruthy();
    });
    const tearleads = tearleadsRef.current;
    if (!tearleads) {
      throw new Error("Expected Tearleads SDK to be available after render.");
    }

    await act(async () => {
      await tearleads.identity.setKeyPairs({
        encapsulationKeyPair: null,
        signingKeyPair: generateSigningSeedAndKeyPair(),
      });
    });

    expect(tearleads.session.isAuthenticated).toBe(false);
    expect(view.queryByText("Active Sessions")).toBeNull();
    expect(view.queryByRole("table")).toBeNull();
  } finally {
    Reflect.set(globalThis, "WebSocket", originalWebSocket);
  }
});
