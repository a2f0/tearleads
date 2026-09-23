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
import { useIdentityManagerIdentityMutations } from "../mini-apps/identity-manager/actions/useIdentityManagerIdentityMutations";
import { useIdentity } from "../providers/identity/IdentityProvider";
import { useRegisterCurrentIdentity } from "./useRegisterCurrentIdentity";

afterEach(cleanupIdentityManagerTestEnvironment);

test.each([
  {
    bound: false,
    replaceIdentity: false,
    loginSucceeds: true,
    replaceDuringLogin: false,
  },
  {
    bound: false,
    replaceIdentity: true,
    loginSucceeds: true,
    replaceDuringLogin: false,
  },
  {
    bound: true,
    replaceIdentity: false,
    loginSucceeds: true,
    replaceDuringLogin: false,
  },
  {
    bound: true,
    replaceIdentity: true,
    loginSucceeds: true,
    replaceDuringLogin: false,
  },
  {
    bound: true,
    replaceIdentity: false,
    loginSucceeds: false,
    replaceDuringLogin: false,
  },
  {
    bound: true,
    replaceIdentity: false,
    loginSucceeds: true,
    replaceDuringLogin: true,
  },
  {
    bound: true,
    replaceIdentity: false,
    loginSucceeds: false,
    replaceDuringLogin: true,
  },
])(
  "registration recovery handles %j",
  async ({ bound, replaceIdentity, loginSucceeds, replaceDuringLogin }) => {
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
        () => {
          const identity = useIdentity();
          const registration = useRegisterCurrentIdentity();
          const mutations = useIdentityManagerIdentityMutations({
            clearSessionError: () => {},
            clearSessions: () => {},
            destroyKey: identity.destroyKey,
            logError: () => {},
            signingFingerprint: identity.signingFingerprint,
            registerCurrentIdentity: registration.registerCurrentIdentity,
          });
          return { identity, registration, mutations };
        },
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
      const login = spyOn(sdk.session, "login").mockImplementation(async () => {
        if (replaceDuringLogin) await sdk.identity.generate();
        return loginSucceeds;
      });
      const register = spyOn(
        sdk.session,
        "registerIdentity",
      ).mockImplementation(async () => {
        if (replaceIdentity) await sdk.identity.generate();
        return bound
          ? { status: "identity-already-bound", userId: crypto.randomUUID() }
          : null;
      });
      try {
        await act(async () => {
          const result =
            view.result.current.registration.registerCurrentIdentity();
          if (
            bound &&
            !replaceIdentity &&
            !replaceDuringLogin &&
            !loginSucceeds
          ) {
            await expect(result).rejects.toThrow("clear local app data");
          } else {
            expect(await result).toBe(!replaceIdentity && !replaceDuringLogin);
          }
        });
        expect(register).toHaveBeenCalledTimes(1);
        expect(login).toHaveBeenCalledTimes(replaceIdentity ? 0 : 1);
        expect(sdk.identity.snapshot === snapshot).toBe(
          !replaceIdentity && !replaceDuringLogin,
        );
        if (
          bound &&
          !replaceIdentity &&
          !replaceDuringLogin &&
          !loginSucceeds
        ) {
          await act(async () => {
            await view.result.current.mutations.handleRegisterIdentity();
          });
          expect(view.result.current.mutations.identityError).toContain(
            "clear local app data",
          );
        }
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
