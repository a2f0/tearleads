import { afterEach, expect, test } from "bun:test";
import { createLocalStorageLocalKeyringManifestStore } from "@tearleads/client-sdk";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { createFakeIndexedDb } from "../../../test/helpers/fakeIndexedDb";
import { AppHostConfig } from "../../host/AppHostConfig";
import { AppHostConfigProvider } from "../host/AppHostConfigProvider";
import {
  LocalKeyringLockProvider,
  useLocalKeyringLock,
} from "./LocalKeyringLockProvider";
import {
  createBrowserLocalKeyringForPinCode,
  pinCodeConfigKey,
  verifyPinCode,
} from "./localKeyringLockSupport";

type LocalKeyringLock = ReturnType<typeof useLocalKeyringLock>;
const BLOB_STORE_SCOPE = { namespace: "tearleads.blob-store" };
const IDENTITY_SCOPE = { namespace: "tearleads.local-identity:test" };

function LockProbe({
  onReady,
}: {
  readonly onReady: (lock: LocalKeyringLock) => void;
}) {
  const lock = useLocalKeyringLock();

  useEffect(() => {
    onReady(lock);
  }, [lock, onReady]);

  return null;
}

afterEach(() => {
  cleanup();
});

test("unlock fails when PIN config exists without a PIN-wrapped manifest", async () => {
  const originalIndexedDB = globalThis.indexedDB;
  const hadIndexedDB = "indexedDB" in globalThis;
  const configKey = pinCodeConfigKey("default");
  const lockRef: { current: LocalKeyringLock | null } = { current: null };

  try {
    Reflect.set(globalThis, "indexedDB", originalIndexedDB ?? {});
    globalThis.localStorage.setItem(configKey, "1");

    render(
      <AppHostConfigProvider
        value={
          new AppHostConfig(
            "http://api.example.test",
            "ws://events.example.test",
          )
        }
      >
        <LocalKeyringLockProvider>
          <LockProbe
            onReady={(lock) => {
              lockRef.current = lock;
            }}
          />
        </LocalKeyringLockProvider>
      </AppHostConfigProvider>,
    );

    await waitFor(() => {
      expect(lockRef.current).toBeTruthy();
    });

    const lock = lockRef.current;
    if (!lock) {
      throw new Error("Expected local keyring lock context.");
    }

    await expect(lock.unlock("123456")).resolves.toBe(false);
  } finally {
    globalThis.localStorage.removeItem(configKey);
    if (hadIndexedDB) {
      Reflect.set(globalThis, "indexedDB", originalIndexedDB);
    } else {
      Reflect.deleteProperty(globalThis, "indexedDB");
    }
  }
});

test("lock clears only the in-memory PIN unlock state", async () => {
  const originalIndexedDB = globalThis.indexedDB;
  const hadIndexedDB = "indexedDB" in globalThis;
  const lockRef: { current: LocalKeyringLock | null } = { current: null };

  try {
    Reflect.set(globalThis, "indexedDB", createFakeIndexedDb());

    render(
      <AppHostConfigProvider
        value={
          new AppHostConfig(
            "http://api.example.test",
            "ws://events.example.test",
          )
        }
      >
        <LocalKeyringLockProvider>
          <LockProbe
            onReady={(lock) => {
              lockRef.current = lock;
            }}
          />
        </LocalKeyringLockProvider>
      </AppHostConfigProvider>,
    );

    await waitFor(() => {
      expect(lockRef.current?.canManagePinCode).toBe(true);
      expect(lockRef.current?.createLocalKeyring).toBeFunction();
    });

    const keyring = lockRef.current?.createLocalKeyring?.();
    if (!keyring) {
      throw new Error("Expected local keyring factory.");
    }
    const session = await keyring.getOrCreateSession(BLOB_STORE_SCOPE);
    session.dispose();

    await act(async () => {
      await expect(lockRef.current?.setPinCode("123456")).resolves.toBe(true);
    });

    await waitFor(() => {
      expect(lockRef.current?.pinCodeEnabled).toBe(true);
      expect(lockRef.current?.isLocked).toBe(false);
    });

    act(() => {
      expect(lockRef.current?.lock()).toBe(true);
    });

    await waitFor(() => {
      expect(lockRef.current?.pinCodeEnabled).toBe(true);
      expect(lockRef.current?.isLocked).toBe(true);
    });
    await act(async () => {
      await expect(lockRef.current?.unlock("123456")).resolves.toBe(true);
    });
  } finally {
    globalThis.localStorage.clear();
    if (hadIndexedDB) {
      Reflect.set(globalThis, "indexedDB", originalIndexedDB);
    } else {
      Reflect.deleteProperty(globalThis, "indexedDB");
    }
  }
});

test("a no-op refresh preserves the active keyring configuration", async () => {
  const originalIndexedDB = globalThis.indexedDB;
  const hadIndexedDB = "indexedDB" in globalThis;
  const lockRef: { current: LocalKeyringLock | null } = { current: null };

  try {
    Reflect.set(globalThis, "indexedDB", createFakeIndexedDb());
    globalThis.localStorage.clear();

    render(
      <AppHostConfigProvider
        value={
          new AppHostConfig(
            "http://api.example.test",
            "ws://events.example.test",
          )
        }
      >
        <LocalKeyringLockProvider>
          <LockProbe
            onReady={(lock) => {
              lockRef.current = lock;
            }}
          />
        </LocalKeyringLockProvider>
      </AppHostConfigProvider>,
    );

    await waitFor(() => {
      expect(lockRef.current?.canManagePinCode).toBe(true);
      expect(lockRef.current?.status).toBe("unlocked");
    });
    await act(async () => {
      await lockRef.current?.refresh();
    });

    expect(lockRef.current?.revision).toBe(0);
    const keyring = lockRef.current?.createLocalKeyring?.();
    const session = await keyring?.getOrCreateSession(BLOB_STORE_SCOPE);
    expect(session).toBeTruthy();
    session?.dispose();
  } finally {
    globalThis.localStorage.clear();
    if (hadIndexedDB) {
      Reflect.set(globalThis, "indexedDB", originalIndexedDB);
    } else {
      Reflect.deleteProperty(globalThis, "indexedDB");
    }
  }
});

test("PIN verification requires every PIN-wrapped managed scope", async () => {
  const originalIndexedDB = globalThis.indexedDB;
  const hadIndexedDB = "indexedDB" in globalThis;

  try {
    Reflect.set(globalThis, "indexedDB", createFakeIndexedDb());
    globalThis.localStorage.clear();

    (
      await createBrowserLocalKeyringForPinCode("111111").getOrCreateSession(
        IDENTITY_SCOPE,
      )
    ).dispose();
    (
      await createBrowserLocalKeyringForPinCode("222222").getOrCreateSession(
        BLOB_STORE_SCOPE,
      )
    ).dispose();

    await expect(
      verifyPinCode({
        manifestStore: createLocalStorageLocalKeyringManifestStore(),
        pinCode: "111111",
        scopes: [IDENTITY_SCOPE, BLOB_STORE_SCOPE],
      }),
    ).resolves.toBe(false);
    await expect(
      verifyPinCode({
        manifestStore: createLocalStorageLocalKeyringManifestStore(),
        pinCode: "222222",
        scopes: [IDENTITY_SCOPE, BLOB_STORE_SCOPE],
      }),
    ).resolves.toBe(false);
  } finally {
    globalThis.localStorage.clear();
    if (hadIndexedDB) {
      Reflect.set(globalThis, "indexedDB", originalIndexedDB);
    } else {
      Reflect.deleteProperty(globalThis, "indexedDB");
    }
  }
});
