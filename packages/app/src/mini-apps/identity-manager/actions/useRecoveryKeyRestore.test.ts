import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { act, cleanup, fireEvent, renderHook } from "@testing-library/react";
import type { FormEvent } from "react";
import * as Session from "../../../providers/crypto/CryptoSessionProvider";
import * as Identity from "../../../providers/identity/IdentityProvider";
import * as Lock from "../../../providers/local-keyring/LocalKeyringLockProvider";
import * as Logging from "../../../providers/logging/LogProvider";
import { useRecoveryKeyRestore } from "./useRecoveryKeyRestore";

const restoreSeedPhrase = mock((_phrase: string) => Promise.resolve());
const login = mock(() => Promise.resolve(true));
const feedback = {
  setError: mock(() => undefined),
  setStatus: mock(() => undefined),
};
const state = { locked: false, transitioning: false };
const restorers: Array<() => void> = [];
const submit = {
  preventDefault: () => undefined,
} as FormEvent<HTMLFormElement>;

beforeEach(() => {
  state.locked = false;
  state.transitioning = false;
  restoreSeedPhrase.mockReset();
  restoreSeedPhrase.mockImplementation(() => Promise.resolve());
  login.mockClear();
  const identity = spyOn(Identity, "useIdentity").mockImplementation(() => ({
    createIdentity: async () => false,
    destroyKey: async () => false,
    generateKey: async () => false,
    persistSession: async () => false,
    switchIdentity: async () => false,
    restoreKeyPackage: async () => undefined,
    restoreSeedPhrase,
    seedPhrase: null,
    signingKeyPair: null,
    encapsulationKeyPair: null,
    signingFingerprint: "identity-a",
    identityDestroyed: false,
    identityTransitionInFlight: state.transitioning,
    localIdentities: [],
    localIdentityRestoreSettled: true,
    localIdentityRestoredFingerprint: null,
    localIdentitySwitchingAvailable: true,
  }));
  const session = spyOn(Session, "useCryptoSession").mockReturnValue({
    login,
    loginWithChallenge: async () => true,
    logout: () => undefined,
    authToken: null,
    userId: null,
    organizationId: null,
    containerId: null,
    isAuthenticated: false,
    isRoot: false,
    sessionRestoreSettled: true,
    setUserId: () => undefined,
    setOrganizationId: () => undefined,
    setContainerId: () => undefined,
  });
  const lock = spyOn(Lock, "useLocalKeyringLock").mockImplementation(
    () =>
      ({ isLocked: state.locked }) as ReturnType<
        typeof Lock.useLocalKeyringLock
      >,
  );
  const logging = spyOn(Logging, "useLog").mockReturnValue({
    log: () => undefined,
    logError: () => undefined,
  } as ReturnType<typeof Logging.useLog>);
  restorers.push(
    () => identity.mockRestore(),
    () => session.mockRestore(),
    () => lock.mockRestore(),
    () => logging.mockRestore(),
  );
});
afterEach(() => {
  cleanup();
  for (const restore of restorers.splice(0)) restore();
});

test("concurrent submits perform one restore and one login", async () => {
  const pending = Promise.withResolvers<void>();
  restoreSeedPhrase.mockImplementation(() => pending.promise);
  const view = renderHook(() => useRecoveryKeyRestore(feedback));
  act(() => view.result.current.setRestorePassphrase("recovery phrase"));
  await act(async () => {
    const first = view.result.current.restoreRecoveryKey(submit);
    await view.result.current.restoreRecoveryKey(submit);
    expect(restoreSeedPhrase).toHaveBeenCalledTimes(1);
    expect(login).not.toHaveBeenCalled();
    pending.resolve();
    await first;
  });
  expect(login).toHaveBeenCalledTimes(1);
  expect(view.result.current.restorePassphrase).toBe("");
});

test("identity transitions block restores until the transition completes", async () => {
  state.transitioning = true;
  const view = renderHook(() => useRecoveryKeyRestore(feedback));
  act(() => view.result.current.setRestorePassphrase("recovery phrase"));
  expect(view.result.current.canRestore).toBe(false);
  await act(() => view.result.current.restoreRecoveryKey(submit));
  expect(restoreSeedPhrase).not.toHaveBeenCalled();
  state.transitioning = false;
  view.rerender();
  expect(view.result.current.canRestore).toBe(true);
  await act(() => view.result.current.restoreRecoveryKey(submit));
  expect(restoreSeedPhrase).toHaveBeenCalledTimes(1);
});

test("locking discards a staged phrase and unlocking cannot revive it", () => {
  const view = renderHook(() => useRecoveryKeyRestore(feedback));
  act(() => view.result.current.setRestorePassphrase("recovery phrase"));
  state.locked = true;
  view.rerender();
  expect(view.result.current.restorePassphrase).toBe("");
  expect(view.result.current.canRestore).toBe(false);
  state.locked = false;
  view.rerender();
  expect(view.result.current.restorePassphrase).toBe("");
  expect(restoreSeedPhrase).not.toHaveBeenCalled();
});

test.each(["visibilitychange", "pagehide"])(
  "%s clears a staged restore phrase on backgrounding",
  (event) => {
    const view = renderHook(() => useRecoveryKeyRestore(feedback));
    act(() =>
      view.result.current.setRestorePassphrase("staged recovery phrase"),
    );
    const visibility = Object.getOwnPropertyDescriptor(
      document,
      "visibilityState",
    );
    try {
      if (event === "visibilitychange") {
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          value: "hidden",
        });
        fireEvent(document, new Event(event));
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          value: "visible",
        });
        fireEvent(document, new Event(event));
      } else {
        fireEvent(window, new Event(event));
        fireEvent(window, new Event("pageshow"));
      }
      expect(view.result.current.restorePassphrase).toBe("");
      expect(restoreSeedPhrase).not.toHaveBeenCalled();
    } finally {
      if (visibility)
        Object.defineProperty(document, "visibilityState", visibility);
      else Reflect.deleteProperty(document, "visibilityState");
    }
  },
);
