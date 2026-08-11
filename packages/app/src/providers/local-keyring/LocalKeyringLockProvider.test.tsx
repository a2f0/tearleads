import { afterEach, expect, test } from "bun:test";
import {
  createBrowserLocalKeyring,
  createBrowserLocalKeyringManifestStore,
  createLocalStorageLocalKeyringManifestStore,
} from "@tearleads/client-sdk";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import {
  createFakeIndexedDb,
  createTrackedFakeIndexedDb,
} from "../../../test/helpers/fakeIndexedDb";
import { createAppHostConfig } from "../../host/AppHostConfig";
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
        value={createAppHostConfig({
          apiBaseUrl: "http://api.example.test",
          wsUrl: "ws://events.example.test",
        })}
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
        value={createAppHostConfig({
          apiBaseUrl: "http://api.example.test",
          wsUrl: "ws://events.example.test",
        })}
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
      await expect(lockRef.current?.setPinCode("824913")).resolves.toBe(true);
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
      await expect(lockRef.current?.unlock("824913")).resolves.toBe(true);
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
        value={createAppHostConfig({
          apiBaseUrl: "http://api.example.test",
          wsUrl: "ws://events.example.test",
        })}
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

// The WebView shells (Capacitor/Electrobun) declare "raw-bytes" because
// WKWebView cannot structured-clone a CryptoKey. Before this mode existed they
// overrode createLocalKeyring instead, which made the keyring host-managed and
// reported PIN locking as "Unavailable" on mobile. This is that path end to end:
// the PIN keyring's inner keystore must agree on the record shape, or the
// round-trip fails on the wrapping-key read.
test("a raw-bytes WebView shell can set, lock, and unlock a PIN", async () => {
  const originalIndexedDB = globalThis.indexedDB;
  const hadIndexedDB = "indexedDB" in globalThis;
  const lockRef: { current: LocalKeyringLock | null } = { current: null };

  try {
    Reflect.set(globalThis, "indexedDB", createFakeIndexedDb());
    globalThis.localStorage.clear();

    render(
      <AppHostConfigProvider
        value={createAppHostConfig({
          apiBaseUrl: "http://api.example.test",
          localKeyringKeyMaterialStorage: "raw-bytes",
          wsUrl: "ws://events.example.test",
        })}
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

    // Declaring only the key-material mode must NOT read as host-managed.
    await waitFor(() => {
      expect(lockRef.current?.canManagePinCode).toBe(true);
    });

    const keyring = lockRef.current?.createLocalKeyring?.();
    if (!keyring) {
      throw new Error("Expected local keyring factory.");
    }
    (await keyring.getOrCreateSession(BLOB_STORE_SCOPE)).dispose();

    await act(async () => {
      await expect(lockRef.current?.setPinCode("824913")).resolves.toBe(true);
    });
    await waitFor(() => {
      expect(lockRef.current?.pinCodeEnabled).toBe(true);
    });

    act(() => {
      expect(lockRef.current?.lock()).toBe(true);
    });
    await waitFor(() => {
      expect(lockRef.current?.isLocked).toBe(true);
    });

    await act(async () => {
      await expect(lockRef.current?.unlock("824913")).resolves.toBe(true);
    });
    await waitFor(() => {
      expect(lockRef.current?.isLocked).toBe(false);
    });

    // The unlocked keyring must reopen the session wrapped before the PIN was
    // set — proving the rewrap kept the raw-bytes inner key readable.
    const unlocked = lockRef.current?.createLocalKeyring?.();
    const session = await unlocked?.loadSession(BLOB_STORE_SCOPE);
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

test("a host-supplied keyring still disables PIN management", async () => {
  const originalIndexedDB = globalThis.indexedDB;
  const hadIndexedDB = "indexedDB" in globalThis;
  const lockRef: { current: LocalKeyringLock | null } = { current: null };

  try {
    Reflect.set(globalThis, "indexedDB", createFakeIndexedDb());
    globalThis.localStorage.clear();

    render(
      <AppHostConfigProvider
        value={createAppHostConfig({
          apiBaseUrl: "http://api.example.test",
          createLocalKeyring: () => createBrowserLocalKeyring(),
          wsUrl: "ws://events.example.test",
        })}
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
    expect(lockRef.current?.canManagePinCode).toBe(false);
    expect(lockRef.current?.status).toBe("unavailable");
    await expect(lockRef.current?.setPinCode("824913")).resolves.toBe(false);
  } finally {
    globalThis.localStorage.clear();
    if (hadIndexedDB) {
      Reflect.set(globalThis, "indexedDB", originalIndexedDB);
    } else {
      Reflect.deleteProperty(globalThis, "indexedDB");
    }
  }
});

test("setPinCode refuses a PIN that fails the strength policy", async () => {
  const originalIndexedDB = globalThis.indexedDB;
  const hadIndexedDB = "indexedDB" in globalThis;
  const lockRef: { current: LocalKeyringLock | null } = { current: null };

  try {
    Reflect.set(globalThis, "indexedDB", createFakeIndexedDb());
    globalThis.localStorage.clear();

    render(
      <AppHostConfigProvider
        value={createAppHostConfig({
          apiBaseUrl: "http://api.example.test",
          wsUrl: "ws://events.example.test",
        })}
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
    });

    await expect(lockRef.current?.setPinCode("12345")).resolves.toBe(false);
    await expect(lockRef.current?.setPinCode("111111")).resolves.toBe(false);
    await expect(lockRef.current?.setPinCode("123456")).resolves.toBe(false);
    expect(lockRef.current?.pinCodeEnabled).toBe(false);
  } finally {
    globalThis.localStorage.clear();
    if (hadIndexedDB) {
      Reflect.set(globalThis, "indexedDB", originalIndexedDB);
    } else {
      Reflect.deleteProperty(globalThis, "indexedDB");
    }
  }
});

// Each unlock builds a PIN keystore to try the manifest against, and a correct
// PIN reaches through to the inner IndexedDB keystore — which opens a
// connection. (A wrong PIN fails at the outer AES-GCM decrypt and never opens
// one, so it cannot detect this leak.) A real WKWebView can hang on a later
// indexedDB.open() once connections have leaked, so the count must not grow
// with attempts.
test("repeated PIN verification does not leak IndexedDB connections", async () => {
  const originalIndexedDB = globalThis.indexedDB;
  const hadIndexedDB = "indexedDB" in globalThis;
  const { indexedDB, openConnectionCount } = createTrackedFakeIndexedDb();

  try {
    Reflect.set(globalThis, "indexedDB", indexedDB);
    globalThis.localStorage.clear();

    (
      await createBrowserLocalKeyringForPinCode({
        keyMaterialStorage: "raw-bytes",
        pinCode: "824913",
      }).getOrCreateSession(IDENTITY_SCOPE)
    ).dispose();

    // The same store the keyring above wrote to: with IndexedDB present,
    // createBrowserLocalKeyringManifestStore selects it over localStorage.
    // Built once — it is IndexedDB-backed, so constructing one per call would
    // make the test leak the very thing it is measuring.
    const manifestStore = createBrowserLocalKeyringManifestStore();
    const verifyCorrectPin = () =>
      verifyPinCode({
        keyMaterialStorage: "raw-bytes",
        manifestStore,
        pinCode: "824913",
        scopes: [IDENTITY_SCOPE],
      });

    await expect(verifyCorrectPin()).resolves.toBe(true);
    const afterFirstAttempt = openConnectionCount();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(verifyCorrectPin()).resolves.toBe(true);
    }

    expect(openConnectionCount()).toBe(afterFirstAttempt);
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
      await createBrowserLocalKeyringForPinCode({
        keyMaterialStorage: undefined,
        pinCode: "111111",
      }).getOrCreateSession(IDENTITY_SCOPE)
    ).dispose();
    (
      await createBrowserLocalKeyringForPinCode({
        keyMaterialStorage: undefined,
        pinCode: "222222",
      }).getOrCreateSession(BLOB_STORE_SCOPE)
    ).dispose();

    await expect(
      verifyPinCode({
        keyMaterialStorage: undefined,
        manifestStore: createLocalStorageLocalKeyringManifestStore(),
        pinCode: "111111",
        scopes: [IDENTITY_SCOPE, BLOB_STORE_SCOPE],
      }),
    ).resolves.toBe(false);
    await expect(
      verifyPinCode({
        keyMaterialStorage: undefined,
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
