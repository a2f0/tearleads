import { afterEach, expect, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { AppHostConfig } from "../../host/AppHostConfig";
import { AppHostConfigProvider } from "../host/AppHostConfigProvider";
import {
  LocalKeyringLockProvider,
  useLocalKeyringLock,
} from "./LocalKeyringLockProvider";
import { pinCodeConfigKey } from "./localKeyringLockSupport";

type LocalKeyringLock = ReturnType<typeof useLocalKeyringLock>;

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
