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
  AutoProvisioningStatusContext,
  useAutoProvisioningStatus,
} from "./autoProvisioningStatus";
import {
  createLegalTermsAgreementStore,
  LegalTermsAgreementContext,
} from "./legalTermsAgreement";
import { useRegisterCurrentIdentity } from "./useRegisterCurrentIdentity";

afterEach(cleanupIdentityManagerTestEnvironment, MOCK_SERVER_RESET_TIMEOUT_MS);

/** Publishes the runtime's status, but as an identity needing no agreement. */
function NoAgreementNeeded({ children }: PropsWithChildren) {
  const status = useAutoProvisioningStatus();
  return (
    <AutoProvisioningStatusContext.Provider
      value={{ ...status, legalTerms: "not-required" }}
    >
      {children}
    </AutoProvisioningStatusContext.Provider>
  );
}

async function renderRegistration(
  options: { noAgreementNeeded?: boolean } = {},
) {
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
        {options.noAgreementNeeded ? (
          <NoAgreementNeeded>{children}</NoAgreementNeeded>
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
  return { sdk, view };
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

test("without an agreement, an identity needing none (recovered from its passphrase) signs back in", async () => {
  const originalWebSocket = globalThis.WebSocket;
  Reflect.set(globalThis, "WebSocket", TestWebSocket);
  try {
    const { sdk, view } = await renderRegistration({ noAgreementNeeded: true });
    expect(view.result.current.registration.legalTermsRequired).toBe(false);
    const register = spyOn(sdk.session, "registerIdentity");
    const login = spyOn(sdk.session, "login").mockImplementation(
      async () => true,
    );
    try {
      // The device binds no account to it yet, but it has one to sign in to.
      await act(async () => {
        expect(
          await view.result.current.registration.registerCurrentIdentity(),
        ).toBe(true);
      });
      expect(login).toHaveBeenCalledTimes(1);
      expect(register).not.toHaveBeenCalled();
    } finally {
      login.mockRestore();
      register.mockRestore();
    }
    view.unmount();
  } finally {
    Reflect.set(globalThis, "WebSocket", originalWebSocket);
  }
}, 15_000);
