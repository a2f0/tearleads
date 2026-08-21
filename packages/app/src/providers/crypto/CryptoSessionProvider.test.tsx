import { expect, mock, spyOn, test } from "bun:test";
import { act, cleanup, render } from "@testing-library/react";
import * as DatabaseProvider from "../db/DatabaseProvider";
import * as AppHostConfigProvider from "../host/AppHostConfigProvider";
import * as IdentityProvider from "../identity/IdentityProvider";
import * as LocalKeyringLockProvider from "../local-keyring/LocalKeyringLockProvider";
import * as LogProvider from "../logging/LogProvider";
import * as SymCryptProvider from "../sdk/SymCryptProvider";
import {
  type CryptoSessionContextValue,
  CryptoSessionProvider,
  useCryptoSession,
} from "./CryptoSessionProvider";

test("crypto session context changes only with its exposed state", async () => {
  const login = mock((_challengeHex?: string) => Promise.resolve(true));
  const logout = mock(() => undefined);
  const identity = { signingKeyPair: {} as object | null };
  let sessionListener: () => void = () => undefined;
  let sessionSnapshot = {
    authToken: null,
    containerId: null,
    defaultOrganizationId: null,
    isAuthenticated: false,
    organizationId: null,
    userId: null as string | null,
  };
  const symcrypt = {
    identity,
    session: {
      bootstrapLocalRootContainer: () => Promise.resolve(),
      login,
      logout,
      setContainerId: () => undefined,
      setContext: () => undefined,
      setOrganizationId: () => undefined,
      setUserId: () => undefined,
      get snapshot() {
        return sessionSnapshot;
      },
      subscribe: (listener: () => void) => {
        sessionListener = listener;
        return () => undefined;
      },
    },
  } as unknown as ReturnType<typeof SymCryptProvider.useSymCrypt>;
  const spies = [
    spyOn(SymCryptProvider, "useSymCrypt").mockReturnValue(symcrypt),
    spyOn(LogProvider, "useLog").mockReturnValue({
      entries: [],
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
      signingFingerprint: null,
      signingKeyPair: {},
    } as ReturnType<typeof IdentityProvider.useIdentity>),
    spyOn(LocalKeyringLockProvider, "useLocalKeyringLock").mockReturnValue({
      createLocalKeyring: undefined,
      isLocked: true,
    } as ReturnType<typeof LocalKeyringLockProvider.useLocalKeyringLock>),
  ];
  const values: CryptoSessionContextValue[] = [];

  function SessionProbe() {
    values.push(useCryptoSession());
    return null;
  }

  const probe = <SessionProbe />;
  function Harness({ tick }: { tick: number }) {
    return (
      <>
        <output>{tick}</output>
        <CryptoSessionProvider>{probe}</CryptoSessionProvider>
      </>
    );
  }

  try {
    const view = render(<Harness tick={0} />);
    expect(values).toHaveLength(1);
    const firstValue = values[0];

    view.rerender(<Harness tick={1} />);
    expect(values).toHaveLength(1);
    expect(values[0]).toBe(firstValue);
    expect(Object.is(firstValue?.login, firstValue?.loginWithChallenge)).toBe(
      false,
    );

    await act(async () => {
      sessionSnapshot = { ...sessionSnapshot, userId: "user-1" };
      sessionListener();
    });
    expect(values).toHaveLength(2);
    expect(values[1]?.userId).toBe("user-1");
    expect(values[1]?.login).toBe(firstValue?.login);

    await act(async () => {
      expect(await firstValue?.login()).toBe(true);
      expect(await firstValue?.loginWithChallenge("challenge")).toBe(true);
      expect(
        await (
          firstValue?.login as (incidentalArgument: string) => Promise<boolean>
        )("ignored"),
      ).toBe(true);
    });
    expect(login.mock.calls).toEqual([[undefined], ["challenge"], [undefined]]);

    identity.signingKeyPair = null;
    await act(async () => {
      expect(await firstValue?.login()).toBe(false);
    });
    expect(login).toHaveBeenCalledTimes(3);

    firstValue?.logout();
    expect(logout).toHaveBeenCalledTimes(1);
  } finally {
    cleanup();
    for (const spy of spies) {
      spy.mockRestore();
    }
  }
});
