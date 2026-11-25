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
import "../../test/helpers/msw/server";
import { MOCK_SERVER_RESET_TIMEOUT_MS } from "../../test/helpers/msw/server";
import { useIdentity } from "../providers/identity/IdentityProvider";
import {
  createLegalTermsAgreementStore,
  LegalTermsAgreementContext,
} from "./legalTermsAgreement";
import { useRegisterCurrentIdentity } from "./useRegisterCurrentIdentity";

afterEach(cleanupIdentityManagerTestEnvironment, MOCK_SERVER_RESET_TIMEOUT_MS);

test("without an agreement, a key this device already binds signs back in, and any other waits", async () => {
  const originalWebSocket = globalThis.WebSocket;
  Reflect.set(globalThis, "WebSocket", TestWebSocket);
  const sdkRef: { current: Tearleads | null } = { current: null };
  const hostConfig = createIdentityManagerHostConfig();
  const wrapper = ({ children }: PropsWithChildren) => (
    <LegalTermsAgreementContext.Provider
      value={createLegalTermsAgreementStore()}
    >
      <IdentityManagerTestRuntime
        hostConfig={hostConfig}
        onTearleadsReady={(sdk) => {
          sdkRef.current = sdk;
        }}
      >
        {children}
      </IdentityManagerTestRuntime>
    </LegalTermsAgreementContext.Provider>
  );
  try {
    const view = renderHook(
      () => ({
        identity: useIdentity(),
        registration: useRegisterCurrentIdentity(),
      }),
      { wrapper },
    );
    await act(async () => {
      await view.result.current.identity.generateKey();
    });
    await waitFor(() => {
      expect(view.result.current.registration.canRegisterCurrentIdentity).toBe(
        true,
      );
    });
    // A key made here has no account, so Register asks first.
    expect(view.result.current.registration.legalTermsRequired).toBe(true);
    const sdk = sdkRef.current;
    if (!sdk) throw new Error("SDK was not initialized");
    const register = spyOn(sdk.session, "registerIdentity");
    const login = spyOn(sdk.session, "login").mockImplementation(
      async () => true,
    );
    const boundUserId = spyOn(sdk.session, "boundUserId");
    try {
      // Nothing registers or signs in for a key no account holds.
      await act(async () => {
        expect(
          await view.result.current.registration.registerCurrentIdentity(),
        ).toBe(false);
      });
      expect(boundUserId).toHaveBeenCalledTimes(1);
      expect(login).not.toHaveBeenCalled();

      // A key this device binds to an account only signs back in.
      boundUserId.mockImplementation(async () => crypto.randomUUID());
      await act(async () => {
        expect(
          await view.result.current.registration.registerCurrentIdentity(),
        ).toBe(true);
      });
      expect(login).toHaveBeenCalledTimes(1);
      expect(register).not.toHaveBeenCalled();
    } finally {
      boundUserId.mockRestore();
      login.mockRestore();
      register.mockRestore();
    }
    view.unmount();
  } finally {
    Reflect.set(globalThis, "WebSocket", originalWebSocket);
  }
}, 15_000);
