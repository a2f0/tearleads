import { afterEach, expect, test } from "bun:test";
import type { SymCrypt } from "@symcrypt/client-sdk";
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
  const symcryptRef: { current: SymCrypt | null } = { current: null };
  const hostConfig = createIdentityManagerHostConfig();
  const wrapper = ({ children }: PropsWithChildren) => (
    <IdentityManagerTestRuntime
      hostConfig={hostConfig}
      onSymCryptReady={(sdk) => {
        symcryptRef.current = sdk;
      }}
    >
      {children}
    </IdentityManagerTestRuntime>
  );
  const view = renderHook(() => useAuthenticateAction(), { wrapper });
  await waitFor(() => {
    expect(symcryptRef.current).toBeTruthy();
  });
  const symcrypt = symcryptRef.current;
  if (!symcrypt) {
    throw new Error("Expected SymCrypt SDK to be available after render.");
  }
  return { symcrypt, view };
}

test("derives the login-failure reason from the live network state", async () => {
  const originalWebSocket = globalThis.WebSocket;
  try {
    Reflect.set(globalThis, "WebSocket", TestWebSocket);
    const { symcrypt, view } = await renderAuthenticateAction();

    // With no signing key pair, login() resolves false without a request, so the
    // reason comes purely from the network store.
    act(() => {
      symcrypt.network.setOnline(false);
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
      symcrypt.network.setOnline(true);
    });
    await act(async () => {
      await view.result.current.authenticate();
    });
    expect(view.result.current.error).toBe("Authentication failed.");
  } finally {
    Reflect.set(globalThis, "WebSocket", originalWebSocket);
  }
});
