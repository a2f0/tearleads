import { afterEach, expect, test } from "bun:test";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { createFakeIndexedDb } from "../../../test/helpers/fakeIndexedDb";
import { AppHostConfig } from "../../host/AppHostConfig";
import { AppHostConfigProvider } from "../host/AppHostConfigProvider";
import {
  LocalKeyringLockProvider,
  useLocalKeyringLock,
} from "./LocalKeyringLockProvider";
import { pinCodeConfigKey } from "./localKeyringLockSupport";

type LocalKeyringLock = ReturnType<typeof useLocalKeyringLock>;
const BLOB_STORE_SCOPE = { namespace: "tearleads.blob-store" };

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
