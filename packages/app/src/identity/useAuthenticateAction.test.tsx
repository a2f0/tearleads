import { afterEach, expect, test } from "bun:test";
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
