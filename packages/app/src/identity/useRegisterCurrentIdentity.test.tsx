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
import { useIdentity } from "../providers/identity/IdentityProvider";
import { useRegisterCurrentIdentity } from "./useRegisterCurrentIdentity";

afterEach(cleanupIdentityManagerTestEnvironment);

test.each([false, true])(
  "registration recovery authenticates only the unchanged identity (replace: %s)",
  async (replaceIdentity) => {
    const originalWebSocket = globalThis.WebSocket;
    Reflect.set(globalThis, "WebSocket", TestWebSocket);
    const sdkRef: { current: Tearleads | null } = { current: null };
    const hostConfig = createIdentityManagerHostConfig();
    const wrapper = ({ children }: PropsWithChildren) => (
      <IdentityManagerTestRuntime
        hostConfig={hostConfig}
        onTearleadsReady={(sdk) => {
          sdkRef.current = sdk;
        }}
      >
        {children}
      </IdentityManagerTestRuntime>
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
        expect(
          view.result.current.registration.canRegisterCurrentIdentity,
        ).toBe(true);
      });
      const sdk = sdkRef.current;
      if (!sdk) throw new Error("SDK was not initialized");
      const snapshot = sdk.identity.snapshot;
      const login = spyOn(sdk.session, "login").mockResolvedValue(true);
      const register = spyOn(
        sdk.session,
        "registerIdentity",
      ).mockImplementation(async () => {
        if (replaceIdentity) await sdk.identity.generate();
        return null;
      });
      try {
        await act(async () => {
          expect(
            await view.result.current.registration.registerCurrentIdentity(),
          ).toBe(!replaceIdentity);
        });
        expect(register).toHaveBeenCalledTimes(1);
        expect(login).toHaveBeenCalledTimes(replaceIdentity ? 0 : 1);
        expect(sdk.identity.snapshot === snapshot).toBe(!replaceIdentity);
      } finally {
        register.mockRestore();
        login.mockRestore();
      }
      view.unmount();
    } finally {
      Reflect.set(globalThis, "WebSocket", originalWebSocket);
    }
  },
  15_000,
);
