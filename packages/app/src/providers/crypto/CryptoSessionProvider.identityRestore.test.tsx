import { expect, mock, spyOn, test } from "bun:test";
import { act, cleanup, render } from "@testing-library/react";
import * as DatabaseProvider from "../db/DatabaseProvider";
import * as AppHostConfigProvider from "../host/AppHostConfigProvider";
import * as IdentityProvider from "../identity/IdentityProvider";
import * as LocalKeyringLockProvider from "../local-keyring/LocalKeyringLockProvider";
import * as LogProvider from "../logging/LogProvider";
import * as TearleadsProvider from "../sdk/TearleadsProvider";
import { CryptoSessionProvider } from "./CryptoSessionProvider";

import * as SessionPersistence from "./localCryptoSessionPersistence";

test("a persisted session cannot bind to an identity switched before React cleanup", async () => {
  const setContext = mock(() => undefined);
  let resolveRestore: (
    value: SessionPersistence.PersistedCryptoSessionContext | null,
  ) => void = () => {};
  const restored =
    new Promise<SessionPersistence.PersistedCryptoSessionContext | null>(
      (resolve) => {
        resolveRestore = resolve;
      },
    );
  const login = mock((_challengeHex?: string) => Promise.resolve(true));
  const logout = mock(() => undefined);
  const identity = {
    signingKeyPair: {} as object | null,
    signingFingerprint: "old-fingerprint",
  };

  const sessionSnapshot = {
    authToken: null,
    containerId: null,
    defaultOrganizationId: null,
    isAuthenticated: false,
    organizationId: null,
    userId: null as string | null,
  };
  const tearleads = {
    identity,
    session: {
      bootstrapLocalRootContainer: () => Promise.resolve(),
      login,
      logout,
      setContainerId: () => undefined,
      setContext,
      setOrganizationId: () => undefined,
      setUserId: () => undefined,
      get snapshot() {
        return sessionSnapshot;
      },
      subscribe: (listener: () => void) => {
        void listener;
        return () => undefined;
      },
    },
  } as unknown as ReturnType<typeof TearleadsProvider.useTearleads>;
  const spies = [
    spyOn(TearleadsProvider, "useTearleads").mockReturnValue(tearleads),
    spyOn(LogProvider, "useLog").mockReturnValue({
      log: () => undefined,
      logError: () => undefined,
    }),
    spyOn(AppHostConfigProvider, "useAppHostConfig").mockReturnValue(
      {} as ReturnType<typeof AppHostConfigProvider.useAppHostConfig>,
    ),
    spyOn(DatabaseProvider, "useDatabase").mockReturnValue({
      client: null,
      ensureIdentityReady: () => Promise.resolve(),
      status: "idle",
    } as unknown as ReturnType<typeof DatabaseProvider.useDatabase>),
    spyOn(IdentityProvider, "useIdentity").mockReturnValue({
      signingFingerprint: "old-fingerprint",
      signingKeyPair: {},
    } as ReturnType<typeof IdentityProvider.useIdentity>),
    spyOn(LocalKeyringLockProvider, "useLocalKeyringLock").mockReturnValue({
      createLocalKeyring: undefined,
      isLocked: true,
    } as ReturnType<typeof LocalKeyringLockProvider.useLocalKeyringLock>),
  ];

  const extraSpies = [
    spyOn(
      SessionPersistence,
      "useLocalCryptoSessionPersistence",
    ).mockReturnValue({} as SessionPersistence.LocalCryptoSessionPersistence),
    spyOn(SessionPersistence, "restorePersistedCryptoSession").mockReturnValue(
      restored,
    ),
    spyOn(
      SessionPersistence,
      "queueCryptoSessionPersistence",
    ).mockImplementation(async () => true),
  ];
  try {
    render(
      <CryptoSessionProvider>
        <span>session</span>
      </CryptoSessionProvider>,
    );
    await act(async () => {
      // The SDK has switched synchronously; React still exposes the previous
      // fingerprint and has not run the old effect's cleanup.
      identity.signingFingerprint = "new-fingerprint";
      resolveRestore({
        authToken: null,
        isAuthenticated: false,
        isRoot: false,
        userId: "old-user",
        organizationId: "old-org",
        defaultOrganizationId: "old-org",
        containerId: "old-root",
      });
      await restored;
    });
    expect(setContext).not.toHaveBeenCalled();
  } finally {
    cleanup();
    for (const spy of [...spies, ...extraSpies]) spy.mockRestore();
  }
});
