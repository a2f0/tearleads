import { afterEach, expect, test } from "bun:test";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { createFakeIndexedDb } from "../../../test/helpers/fakeIndexedDb";
import type { AppDiagnostics } from "../../host/AppDiagnostics";
import { createAppHostConfig } from "../../host/AppHostConfig";
import { AppHostConfigProvider } from "../host/AppHostConfigProvider";
import {
  LocalKeyringLockProvider,
  useLocalKeyringLock,
} from "./LocalKeyringLockProvider";
import { pinCodeConfigKey } from "./localKeyringLockSupport";

type LocalKeyringLock = ReturnType<typeof useLocalKeyringLock>;
type CapturedError = Parameters<AppDiagnostics["captureError"]>;
const BLOB_STORE_SCOPE = { namespace: "tearleads.blob-store" };
const PIN_CODE = "824913";
const WRONG_PIN_CODE = "111111";
// The database createBrowserLocalKeyringManifestStore opens with IndexedDB
// present; the wrapping-key keystore lives in a separate database.
const MANIFEST_DATABASE_NAME = "tearleads-local-keyring-manifests";

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

// The lock provider mounts outside LogProvider, so this is the only path a
// PIN-action failure has off the device.
function createDiagnosticsRecorder() {
  const captured: CapturedError[] = [];
  const diagnostics: AppDiagnostics = {
    addBreadcrumb: () => {},
    captureError: (error, context) => {
      captured.push([error, context]);
    },
  };
  return { captured, diagnostics };
}

/**
 * A fake IndexedDB whose manifest database can be switched to reject
 * read-write transactions. The manifest store caches its opened database, so
 * failing a later `open` would never reach it; the database's `transaction`
 * is the seam a real quota or eviction failure surfaces through.
 */
function createManifestWriteFailableIndexedDb(): {
  readonly failManifestWrites: (error: Error) => void;
  readonly indexedDB: IDBFactory;
} {
  const inner = createFakeIndexedDb();
  const wrappedDatabases = new WeakMap<IDBDatabase, IDBDatabase>();
  let writeError: Error | null = null;

  const wrapDatabase = (database: IDBDatabase): IDBDatabase => {
    const existing = wrappedDatabases.get(database);
    if (existing) {
      return existing;
    }
    const wrapped = new Proxy(database, {
      get(target, property, receiver) {
        if (property !== "transaction") {
          return Reflect.get(target, property, receiver);
        }
        return (name: string | Iterable<string>, mode?: IDBTransactionMode) => {
          if (writeError && mode === "readwrite") {
            throw writeError;
          }
          return target.transaction(name, mode);
        };
      },
    });
    wrappedDatabases.set(database, wrapped);
    return wrapped;
  };
  const wrapOpenRequest = (request: IDBOpenDBRequest): IDBOpenDBRequest =>
    new Proxy(request, {
      get(target, property, receiver) {
        return property === "result"
          ? wrapDatabase(target.result)
          : Reflect.get(target, property, receiver);
      },
    });
  const indexedDB = new Proxy(inner, {
    get(target, property, receiver) {
      if (property !== "open") {
        return Reflect.get(target, property, receiver);
      }
      return (name: string, version?: number) => {
        const request = target.open(name, version);
        return name === MANIFEST_DATABASE_NAME
          ? wrapOpenRequest(request)
          : request;
      };
    },
  });

  return {
    failManifestWrites: (error) => {
      writeError = error;
    },
    indexedDB,
  };
}

async function withFakeIndexedDb(
  indexedDB: IDBFactory,
  run: () => Promise<void>,
): Promise<void> {
  const originalIndexedDB = globalThis.indexedDB;
  const hadIndexedDB = "indexedDB" in globalThis;
  try {
    Reflect.set(globalThis, "indexedDB", indexedDB);
    globalThis.localStorage.clear();
    await run();
  } finally {
    globalThis.localStorage.clear();
    if (hadIndexedDB) {
      Reflect.set(globalThis, "indexedDB", originalIndexedDB);
    } else {
      Reflect.deleteProperty(globalThis, "indexedDB");
    }
  }
}

/** Mounts the provider, seeds one manifest, and enables the PIN. */
async function mountWithPinEnabled(
  diagnostics: AppDiagnostics,
): Promise<{ readonly current: LocalKeyringLock | null }> {
  const lockRef: { current: LocalKeyringLock | null } = { current: null };
  render(
    <AppHostConfigProvider
      value={createAppHostConfig({
        apiBaseUrl: "http://api.example.test",
        diagnostics,
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
  (await keyring.getOrCreateSession(BLOB_STORE_SCOPE)).dispose();
  await act(async () => {
    await expect(lockRef.current?.setPinCode(PIN_CODE)).resolves.toBe(true);
  });
  await waitFor(() => {
    expect(lockRef.current?.pinCodeEnabled).toBe(true);
  });
  return lockRef;
}

afterEach(() => {
  cleanup();
});

test("clearPinCode with a wrong PIN keeps the PIN and reports nothing", async () => {
  const recorder = createDiagnosticsRecorder();
  await withFakeIndexedDb(createFakeIndexedDb(), async () => {
    const lockRef = await mountWithPinEnabled(recorder.diagnostics);

    await act(async () => {
      await expect(lockRef.current?.clearPinCode(WRONG_PIN_CODE)).resolves.toBe(
        false,
      );
    });

    // A typo is not a defect: the wrong PIN must be screened out before the
    // rewrap, never captured as a failure.
    expect(recorder.captured).toEqual([]);
    expect(lockRef.current?.pinCodeEnabled).toBe(true);
    expect(globalThis.localStorage.getItem(pinCodeConfigKey("default"))).toBe(
      "1",
    );

    // The manifest is still wrapped under the original PIN.
    act(() => {
      expect(lockRef.current?.lock()).toBe(true);
    });
    await waitFor(() => {
      expect(lockRef.current?.isLocked).toBe(true);
    });
    await act(async () => {
      await expect(lockRef.current?.unlock(PIN_CODE)).resolves.toBe(true);
    });
    await waitFor(() => {
      expect(lockRef.current?.isLocked).toBe(false);
    });
    expect(recorder.captured).toEqual([]);
  });
});

test("clearPinCode with the right PIN disables the PIN", async () => {
  const recorder = createDiagnosticsRecorder();
  await withFakeIndexedDb(createFakeIndexedDb(), async () => {
    const lockRef = await mountWithPinEnabled(recorder.diagnostics);

    await act(async () => {
      await expect(lockRef.current?.clearPinCode(PIN_CODE)).resolves.toBe(true);
    });

    await waitFor(() => {
      expect(lockRef.current?.pinCodeEnabled).toBe(false);
      expect(lockRef.current?.isLocked).toBe(false);
    });
    expect(
      globalThis.localStorage.getItem(pinCodeConfigKey("default")),
    ).toBeNull();
    expect(lockRef.current?.lock()).toBe(false);

    // The rewrap put the manifest back under the plain keystore, so the
    // PIN-less keyring reopens the session created before the PIN was set.
    const keyring = lockRef.current?.createLocalKeyring?.();
    const session = await keyring?.loadSession(BLOB_STORE_SCOPE);
    expect(session).toBeTruthy();
    session?.dispose();
    expect(recorder.captured).toEqual([]);
  });
});

test("clearPinCode reports a manifest store failure during the rewrap", async () => {
  const recorder = createDiagnosticsRecorder();
  const { failManifestWrites, indexedDB } =
    createManifestWriteFailableIndexedDb();
  await withFakeIndexedDb(indexedDB, async () => {
    const lockRef = await mountWithPinEnabled(recorder.diagnostics);

    // Verification only reads manifests, so the correct PIN still passes the
    // pre-check; the rewrap's saveManifest is what hits the failure.
    const writeError = new Error("IndexedDB write failed.");
    failManifestWrites(writeError);
    await act(async () => {
      await expect(lockRef.current?.clearPinCode(PIN_CODE)).resolves.toBe(
        false,
      );
    });

    expect(recorder.captured).toHaveLength(1);
    const [error, context] = recorder.captured[0] ?? [];
    expect(error).toBeInstanceOf(Error);
    expect(error).toBe(writeError);
    expect(context).toEqual({ area: "app", source: "log" });
    expect(lockRef.current?.pinCodeEnabled).toBe(true);

    // A wrong PIN against the same failing store is still a typo, not a
    // second report.
    await act(async () => {
      await expect(lockRef.current?.clearPinCode(WRONG_PIN_CODE)).resolves.toBe(
        false,
      );
    });
    expect(recorder.captured).toHaveLength(1);
  });
});
