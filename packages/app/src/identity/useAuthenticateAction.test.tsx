import { afterEach, expect, spyOn, test } from "bun:test";
import type { Tearleads } from "@tearleads/client-sdk";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import {
  cleanupIdentityManagerTestEnvironment,
  createIdentityManagerHostConfig,
  IdentityManagerTestRuntime,
  TestWebSocket,
} from "../../test/helpers/identityManagerTestRuntime";
import "../../test/helpers/mswServer";
import * as CryptoSessionProvider from "../providers/crypto/CryptoSessionProvider";
import * as LogProvider from "../providers/logging/LogProvider";
import * as TearleadsProvider from "../providers/sdk/TearleadsProvider";
import { IDENTITY_ACKNOWLEDGMENT_MISMATCH_MESSAGE } from "./identityAcknowledgmentMismatch";
import {
  describeAuthenticationFailure,
  useAuthenticateAction,
} from "./useAuthenticateAction";

afterEach(cleanupIdentityManagerTestEnvironment);

test("describeAuthenticationFailure calls out a lost connection", () => {
  expect(describeAuthenticationFailure({ online: true })).toBe(
    "Authentication failed.",
  );
  expect(describeAuthenticationFailure({ online: false })).toBe(
    "Authentication failed: no network connection.",
  );
});

test("describeAuthenticationFailure names an identity acknowledgment refusal over connectivity", () => {
  expect(
    describeAuthenticationFailure({ identityMismatch: true, online: false }),
  ).toBe(IDENTITY_ACKNOWLEDGMENT_MISMATCH_MESSAGE);
});

test("a login refused for a different acknowledged account is not reported as a network failure", async () => {
  const refusal = Object.assign(
    new Error("Login user ID differs from the acknowledged identity"),
    { code: "object_mismatch", name: "KeyingVerificationError" },
  );
  const logged: Array<{ message: string; error: unknown }> = [];
  const spies = [
    spyOn(CryptoSessionProvider, "useCryptoSession").mockReturnValue({
      login: async () => {
        throw refusal;
      },
    } as unknown as CryptoSessionProvider.CryptoSessionContextValue),
    spyOn(LogProvider, "useLog").mockReturnValue({
      log: () => undefined,
      logError: (message: string, error: unknown) => {
        logged.push({ error, message });
      },
    } as unknown as ReturnType<typeof LogProvider.useLog>),
    spyOn(TearleadsProvider, "useTearleads").mockReturnValue({
      network: { online: false },
    } as unknown as ReturnType<typeof TearleadsProvider.useTearleads>),
  ];
  try {
    const view = renderHook(() => useAuthenticateAction());
    await act(async () => {
      expect(await view.result.current.authenticate()).toBe(false);
    });
    expect(view.result.current.error).toBe(
      IDENTITY_ACKNOWLEDGMENT_MISMATCH_MESSAGE,
    );
    expect(logged).toEqual([
      {
        error: refusal,
        message: "Authentication refused by identity acknowledgment",
      },
    ]);
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
});

async function renderAuthenticateAction() {
  const tearleadsRef: { current: Tearleads | null } = { current: null };
  const hostConfig = createIdentityManagerHostConfig();
  const wrapper = ({ children }: PropsWithChildren) => (
    <IdentityManagerTestRuntime
      hostConfig={hostConfig}
      onTearleadsReady={(sdk) => {
        tearleadsRef.current = sdk;
      }}
    >
      {children}
    </IdentityManagerTestRuntime>
  );
  const view = renderHook(() => useAuthenticateAction(), { wrapper });
  await waitFor(() => {
    expect(tearleadsRef.current).toBeTruthy();
  });
  const tearleads = tearleadsRef.current;
  if (!tearleads) {
    throw new Error("Expected Tearleads SDK to be available after render.");
  }
  return { tearleads, view };
}

test("derives the login-failure reason from the live network state", async () => {
  const originalWebSocket = globalThis.WebSocket;
  try {
    Reflect.set(globalThis, "WebSocket", TestWebSocket);
    const { tearleads, view } = await renderAuthenticateAction();

    // With no signing key pair, login() resolves false without a request, so the
    // reason comes purely from the network store.
    act(() => {
      tearleads.network.setOnline(false);
    });
    await act(async () => {
      expect(await view.result.current.authenticate()).toBe(false);
    });
    expect(view.result.current.error).toBe(
      "Authentication failed: no network connection.",
    );

    act(() => {
      view.result.current.clearError();
    });
    expect(view.result.current.error).toBeNull();

    act(() => {
      tearleads.network.setOnline(true);
    });
    await act(async () => {
      await view.result.current.authenticate();
    });
    expect(view.result.current.error).toBe("Authentication failed.");
  } finally {
    Reflect.set(globalThis, "WebSocket", originalWebSocket);
  }
});
