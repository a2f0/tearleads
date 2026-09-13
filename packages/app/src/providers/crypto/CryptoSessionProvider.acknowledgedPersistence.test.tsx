import { expect, spyOn, test } from "bun:test";
import { act, cleanup, render } from "@testing-library/react";
import * as DatabaseProvider from "../db/DatabaseProvider";
import * as AppHostConfigProvider from "../host/AppHostConfigProvider";
import * as IdentityProvider from "../identity/IdentityProvider";
import * as LocalKeyringLockProvider from "../local-keyring/LocalKeyringLockProvider";
import * as LogProvider from "../logging/LogProvider";
import * as TearleadsProvider from "../sdk/TearleadsProvider";
import { CryptoSessionProvider } from "./CryptoSessionProvider";
import * as SessionPersistence from "./localCryptoSessionPersistence";

test("only a server-acknowledged user ID is persisted with the crypto session", async () => {
  const sessionListeners = new Set<() => void>();
  const session = {
    bootstrapLocalRootContainer: () => Promise.resolve(),
    login: () => Promise.resolve(true),
    logout: () => undefined,
    setContainerId: () => undefined,
    setContext: () => undefined,
    setOrganizationId: () => undefined,
    setUserId: () => undefined,
    snapshot: {
      authToken: "token-1",
      containerId: "root-1",
      defaultOrganizationId: "org-1",
      isAuthenticated: true,
      isRoot: false,
      organizationId: "org-1",
      rootAcknowledgments: [],
      userId: "locally-chosen-user",
    },
    subscribe: (listener: () => void) => {
      sessionListeners.add(listener);
      return () => sessionListeners.delete(listener);
    },
    userIdAcknowledged: false,
  };
  const tearleads = {
    identity: { signingFingerprint: "fingerprint", signingKeyPair: {} },
    session,
  } as unknown as ReturnType<typeof TearleadsProvider.useTearleads>;
  const persisted: Array<string | null> = [];
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
      signingFingerprint: "fingerprint",
      signingKeyPair: {},
    } as ReturnType<typeof IdentityProvider.useIdentity>),
    spyOn(LocalKeyringLockProvider, "useLocalKeyringLock").mockReturnValue({
      createLocalKeyring: undefined,
      isLocked: true,
    } as ReturnType<typeof LocalKeyringLockProvider.useLocalKeyringLock>),
    spyOn(
      SessionPersistence,
      "useLocalCryptoSessionPersistence",
    ).mockReturnValue({} as SessionPersistence.LocalCryptoSessionPersistence),
    spyOn(
      SessionPersistence,
      "restorePersistedCryptoSession",
    ).mockResolvedValue(null),
    spyOn(
      SessionPersistence,
      "queueCryptoSessionPersistence",
    ).mockImplementation(async ({ context }) => {
      persisted.push(context.userId);
      return true;
    }),
  ];
  try {
    render(
      <CryptoSessionProvider>
        <span>session</span>
      </CryptoSessionProvider>,
    );
    await act(async () => {});
    // A user ID the server never acknowledged for this identity (setUserId)
    // is persisted as absent, not as this identity's account.
    expect(persisted).toEqual([null]);

    await act(async () => {
      session.userIdAcknowledged = true;
      for (const listener of sessionListeners) listener();
    });
    expect(persisted).toEqual([null, "locally-chosen-user"]);
  } finally {
    cleanup();
    for (const spy of spies) spy.mockRestore();
  }
});
