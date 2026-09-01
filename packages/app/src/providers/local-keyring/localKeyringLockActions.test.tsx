import { afterEach, expect, test } from "bun:test";
import type { LocalKeyring } from "@tearleads/client-sdk";
import { cleanup, renderHook } from "@testing-library/react";
import { useDynamicLocalKeyringFactory } from "./localKeyringLockActions";
import type {
  LocalKeyringLockEnvironment,
  LockState,
} from "./localKeyringLockSupport";

const SCOPE = { namespace: "test" };
const ENVIRONMENT: LocalKeyringLockEnvironment = {
  canManagePinCode: true,
  hostCreateLocalKeyring: undefined,
  keyMaterialStorage: undefined,
  manifestStore: null,
  pinCodeConfigNamespace: "test",
  scopes: [SCOPE],
  storage: null,
};

interface DynamicKeyringHookProps {
  readonly createBrowserLocalKeyring: (pinCode: string | null) => LocalKeyring;
  readonly lockState: LockState;
  readonly unlockedPinCode: string | null;
}

interface HostKeyringHookProps extends DynamicKeyringHookProps {
  readonly environment: LocalKeyringLockEnvironment;
}

afterEach(cleanup);

test("reuses a config and remints after same-PIN unlock, factory, or capability changes", async () => {
  const closedKeyrings: number[] = [];
  const usedKeyrings: number[] = [];
  let createdKeyrings = 0;
  const createFactory = () => {
    return (_pinCode: string | null): LocalKeyring => {
      const keyringId = ++createdKeyrings;
      return {
        close: () => {
          closedKeyrings.push(keyringId);
        },
        deleteSession: async () => {},
        getOrCreateSession: async () => {
          throw new Error("Unexpected getOrCreateSession call.");
        },
        loadSession: async () => {
          usedKeyrings.push(keyringId);
          return null;
        },
      };
    };
  };
  const createBrowserLocalKeyring = createFactory();
  const unlocked = (revision: number): LockState => ({
    pinCodeEnabled: true,
    revision,
    status: "unlocked",
  });
  const initialProps: DynamicKeyringHookProps = {
    createBrowserLocalKeyring,
    lockState: unlocked(1),
    unlockedPinCode: "123456",
  };
  const view = renderHook(
    (props: DynamicKeyringHookProps) =>
      useDynamicLocalKeyringFactory({
        createBrowserLocalKeyring: props.createBrowserLocalKeyring,
        environment: ENVIRONMENT,
        lockState: props.lockState,
        unlockedPinCode: props.unlockedPinCode,
      }),
    {
      initialProps,
    },
  );

  await view.result.current().loadSession(SCOPE);
  await view.result.current().loadSession(SCOPE);
  expect(createdKeyrings).toBe(1);
  expect(usedKeyrings).toEqual([1, 1]);

  view.rerender({
    createBrowserLocalKeyring,
    lockState: { pinCodeEnabled: true, revision: 2, status: "locked" },
    unlockedPinCode: null,
  });
  view.rerender({
    createBrowserLocalKeyring,
    lockState: unlocked(3),
    unlockedPinCode: "123456",
  });

  await view.result.current().loadSession(SCOPE);
  expect(createdKeyrings).toBe(2);
  expect(closedKeyrings).toEqual([1]);
  expect(usedKeyrings).toEqual([1, 1, 2]);

  const replacementFactory = createFactory();
  view.rerender({
    createBrowserLocalKeyring: replacementFactory,
    lockState: unlocked(3),
    unlockedPinCode: "123456",
  });
  await view.result.current().loadSession(SCOPE);
  expect(createdKeyrings).toBe(3);
  expect(closedKeyrings).toEqual([1, 2]);
  expect(usedKeyrings).toEqual([1, 1, 2, 3]);

  view.rerender({
    createBrowserLocalKeyring: replacementFactory,
    lockState: { pinCodeEnabled: false, revision: 3, status: "unlocked" },
    unlockedPinCode: null,
  });
  await view.result.current().loadSession(SCOPE);
  expect(createdKeyrings).toBe(4);
  expect(closedKeyrings).toEqual([1, 2, 3]);
  expect(usedKeyrings).toEqual([1, 1, 2, 3, 4]);

  view.result.current.invalidateCachedKeyring?.();
  await view.result.current().loadSession(SCOPE);
  expect(createdKeyrings).toBe(5);
  expect(closedKeyrings).toEqual([1, 2, 3, 4]);
  expect(usedKeyrings).toEqual([1, 1, 2, 3, 4, 5]);
});

test("reuses a host keyring and remints only when its factory changes", async () => {
  const closedKeyrings: string[] = [];
  const createdKeyrings: string[] = [];
  const usedKeyrings: string[] = [];
  let nextKeyringId = 0;
  const createHostFactory = (host: string) => {
    return (): LocalKeyring => {
      const keyringId = `${host}-${++nextKeyringId}`;
      createdKeyrings.push(keyringId);
      return {
        close: () => {
          closedKeyrings.push(keyringId);
        },
        deleteSession: async () => {},
        getOrCreateSession: async () => {
          throw new Error("Unexpected getOrCreateSession call.");
        },
        loadSession: async () => {
          usedKeyrings.push(keyringId);
          return null;
        },
      };
    };
  };
  const createBrowserLocalKeyring = (_pinCode: string | null): LocalKeyring => {
    throw new Error("The browser keyring factory must not run in host mode.");
  };
  const createEnvironment = (
    hostCreateLocalKeyring: () => LocalKeyring,
  ): LocalKeyringLockEnvironment => ({
    ...ENVIRONMENT,
    canManagePinCode: false,
    hostCreateLocalKeyring,
  });
  const firstHostFactory = createHostFactory("first");
  const secondHostFactory = createHostFactory("second");
  const lockState: LockState = {
    pinCodeEnabled: false,
    revision: 1,
    status: "unavailable",
  };
  const view = renderHook(
    (props: HostKeyringHookProps) =>
      useDynamicLocalKeyringFactory({
        createBrowserLocalKeyring: props.createBrowserLocalKeyring,
        environment: props.environment,
        lockState: props.lockState,
        unlockedPinCode: props.unlockedPinCode,
      }),
    {
      initialProps: {
        createBrowserLocalKeyring,
        environment: createEnvironment(firstHostFactory),
        lockState,
        unlockedPinCode: null,
      },
    },
  );

  await view.result.current().loadSession(SCOPE);
  await view.result.current().loadSession(SCOPE);
  expect(createdKeyrings).toEqual(["first-1"]);
  expect(closedKeyrings).toEqual([]);
  expect(usedKeyrings).toEqual(["first-1", "first-1"]);

  view.rerender({
    createBrowserLocalKeyring,
    environment: createEnvironment(firstHostFactory),
    lockState: { ...lockState },
    unlockedPinCode: null,
  });
  await view.result.current().loadSession(SCOPE);
  expect(createdKeyrings).toEqual(["first-1"]);
  expect(closedKeyrings).toEqual([]);
  expect(usedKeyrings).toEqual(["first-1", "first-1", "first-1"]);

  view.rerender({
    createBrowserLocalKeyring,
    environment: createEnvironment(secondHostFactory),
    lockState: { ...lockState },
    unlockedPinCode: null,
  });
  expect(closedKeyrings).toEqual(["first-1"]);

  await view.result.current().loadSession(SCOPE);
  await view.result.current().loadSession(SCOPE);
  expect(createdKeyrings).toEqual(["first-1", "second-2"]);
  expect(usedKeyrings).toEqual([
    "first-1",
    "first-1",
    "first-1",
    "second-2",
    "second-2",
  ]);
});
