import { afterEach, expect, spyOn, test } from "bun:test";
import type { Tearleads } from "@tearleads/client-sdk";
import { LEGAL_TERMS_VERSION } from "@tearleads/validators/legalTerms";
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
  AutoProvisioningStatusContext,
  useAutoProvisioningStatus,
} from "./autoProvisioningStatus";
import {
  createLegalTermsAgreementStore,
  LegalTermsAgreementContext,
} from "./legalTermsAgreement";
import { useRegisterCurrentIdentity } from "./useRegisterCurrentIdentity";

afterEach(cleanupIdentityManagerTestEnvironment, MOCK_SERVER_RESET_TIMEOUT_MS);

/**
 * Publishes the runtime's status, but as an identity recovered from its
 * passphrase on this launch, which the autopilot asks no agreement of.
 */
function RecoveredIdentity({ children }: PropsWithChildren) {
  const status = useAutoProvisioningStatus();
  return (
    <AutoProvisioningStatusContext.Provider
      value={{ ...status, legalTerms: "not-required", recovered: true }}
    >
      {children}
    </AutoProvisioningStatusContext.Provider>
  );
}

async function renderRegistration(options: { recovered?: boolean } = {}) {
  const sdkRef: { current: Tearleads | null } = { current: null };
  const hostConfig = createIdentityManagerHostConfig();
  const agreement = createLegalTermsAgreementStore();
  const wrapper = ({ children }: PropsWithChildren) => (
    <LegalTermsAgreementContext.Provider value={agreement}>
      <IdentityManagerTestRuntime
        hostConfig={hostConfig}
        onTearleadsReady={(sdk) => {
          sdkRef.current = sdk;
        }}
      >
        {options.recovered ? (
          <RecoveredIdentity>{children}</RecoveredIdentity>
        ) : (
          children
        )}
      </IdentityManagerTestRuntime>
    </LegalTermsAgreementContext.Provider>
  );
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
  const sdk = sdkRef.current;
  if (!sdk) throw new Error("SDK was not initialized");
  return { agreement, sdk, view };
}

test("without an agreement, a key this device already binds signs back in, and any other waits", async () => {
  const originalWebSocket = globalThis.WebSocket;
  Reflect.set(globalThis, "WebSocket", TestWebSocket);
  try {
    const { sdk, view } = await renderRegistration();
    // A key made here has no account, so Register asks first.
    expect(view.result.current.registration.legalTermsRequired).toBe(true);
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

test("Register asks a recovered identity for the agreement, then registers with it, signing in to an account it already has", async () => {
  const originalWebSocket = globalThis.WebSocket;
  Reflect.set(globalThis, "WebSocket", TestWebSocket);
  try {
    const { agreement, sdk, view } = await renderRegistration({
      recovered: true,
    });
    // It may never have registered (created offline), so Register asks.
    expect(view.result.current.registration.legalTermsRequired).toBe(true);
    // The account it already has answers the registration as a duplicate.
    const register = spyOn(sdk.session, "registerIdentity").mockResolvedValue(
      null,
    );
    const login = spyOn(sdk.session, "login").mockImplementation(
      async () => true,
    );
    try {
      // Without the agreement nothing registers or signs in.
      await act(async () => {
        expect(
          await view.result.current.registration.registerCurrentIdentity(),
        ).toBe(false);
      });
      expect(register).not.toHaveBeenCalled();
      expect(login).not.toHaveBeenCalled();

      act(() => agreement.agree());
      expect(view.result.current.registration.legalTermsRequired).toBe(false);
      await act(async () => {
        expect(
          await view.result.current.registration.registerCurrentIdentity(),
        ).toBe(true);
      });
      expect(register).toHaveBeenCalledTimes(1);
      expect(register.mock.calls[0]?.[0]).toMatchObject({
        acceptedLegalTermsVersion: LEGAL_TERMS_VERSION,
      });
      expect(login).toHaveBeenCalledTimes(1);
    } finally {
      login.mockRestore();
      register.mockRestore();
    }
    view.unmount();
  } finally {
    Reflect.set(globalThis, "WebSocket", originalWebSocket);
  }
}, 15_000);
