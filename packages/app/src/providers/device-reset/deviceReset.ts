import {
  type WipeOpfsStorageResult,
  wipeOpfsStorage,
} from "@tearleads/client-sdk/sqlite";
import { getLocalStorage } from "../../utils/storedPreference";

// Device reset: erase everything the app keeps on this device and start it
// fresh, as a reinstall would. Every shell keeps that data in its WebView's
// origin storage: OPFS (databases, blobs, desktop state), IndexedDB (the local
// keyring), localStorage, and sessionStorage.
//
// The running app only records the request and reloads. The next page wipes
// before it renders anything (DeviceResetGate), so no keyring connection,
// database worker, or queued write of the old page can hold or rewrite what is
// being removed. The app's other tabs unmount, releasing the data they hold,
// and wait for the user to reload them, so only one page boots the fresh
// device. Pages that do start a reset together wipe one at a time under a Web
// Lock, and one that gets the lock after the reset finished boots normally.
// WKWebView (iOS and the macOS desktop shell) exposes OPFS only inside
// workers, so there the wipe leaves a flag and the page's first database boot
// has the SQLite worker wipe OPFS before it opens anything.

const DEVICE_RESET_REQUEST_KEY = "tearleads.device-reset.requested";
const WORKER_STORAGE_WIPE_KEY = "tearleads.device-reset.worker-storage-wipe";
const DEVICE_RESET_CHANNEL = "tearleads.device-reset";
const DEVICE_RESET_LOCK = "tearleads.device-reset";

// Long enough for the worker handle release wipeOpfsStorage already waits on;
// past it, something else (another tab) holds the data.
const DEVICE_RESET_TIMEOUT_MS = 30_000;

export interface DeviceResetEnvironment {
  readonly indexedDB:
    | Pick<IDBFactory, "databases" | "deleteDatabase">
    | undefined;
  readonly localStorage: Pick<Storage, "clear" | "setItem">;
  readonly sessionStorage: Pick<Storage, "clear"> | undefined;
  readonly wipeOpfs: () => Promise<WipeOpfsStorageResult>;
}

// Tags this page's broadcast, which its own subscription would also receive.
const PAGE_ID = crypto.randomUUID();

/**
 * Records a device reset, tells the app's other tabs, and reloads into the
 * reset.
 */
export function requestDeviceReset(
  storage: Pick<Storage, "setItem"> = globalThis.localStorage,
  reload: () => void = () => window.location.reload(),
): void {
  storage.setItem(DEVICE_RESET_REQUEST_KEY, "1");
  if (typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel(DEVICE_RESET_CHANNEL);
    channel.postMessage(PAGE_ID);
    channel.close();
  }
  reload();
}

/** Calls `listener` when another page requests a device reset. */
export function subscribeDeviceResetRequests(listener: () => void): () => void {
  if (typeof BroadcastChannel === "undefined") {
    return () => {};
  }
  const channel = new BroadcastChannel(DEVICE_RESET_CHANNEL);
  channel.onmessage = (event: MessageEvent<unknown>) => {
    if (event.data !== PAGE_ID) {
      listener();
    }
  };
  return () => channel.close();
}

export function isDeviceResetRequested(storage = getLocalStorage()): boolean {
  return storage?.getItem(DEVICE_RESET_REQUEST_KEY) === "1";
}

/** Drops a reset request that cannot complete, so the app boots unchanged. */
export function cancelDeviceReset(storage = getLocalStorage()): void {
  storage?.removeItem(DEVICE_RESET_REQUEST_KEY);
}

function deleteIndexedDbDatabase(
  factory: Pick<IDBFactory, "deleteDatabase">,
  name: string,
): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const request = factory.deleteDatabase(name);
  request.onsuccess = () => resolve();
  request.onerror = () =>
    reject(
      request.error ??
        new Error(`Could not delete IndexedDB database ${name}.`),
    );
  // A `blocked` deletion still completes once the other connections close, so
  // it is left pending; the reset's timeout reports one that never does.
  return promise;
}

/**
 * Wipes this device's storage for a requested reset. The request is cleared
 * last, with the rest of localStorage, so a failure leaves it in place for a
 * retry.
 */
export async function completeDeviceReset(
  environment: DeviceResetEnvironment,
): Promise<void> {
  const opfs = await environment.wipeOpfs();
  if (environment.indexedDB) {
    for (const { name } of await environment.indexedDB.databases()) {
      if (name !== undefined) {
        await deleteIndexedDbDatabase(environment.indexedDB, name);
      }
    }
  }
  environment.sessionStorage?.clear();
  environment.localStorage.clear();
  if (opfs === "unavailable") {
    environment.localStorage.setItem(WORKER_STORAGE_WIPE_KEY, "1");
  }
}

async function runWithDeviceResetLock(run: () => Promise<void>): Promise<void> {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  if (locks === undefined) {
    await run();
    return;
  }
  await locks.request(DEVICE_RESET_LOCK, run);
}

let pendingDeviceReset: Promise<void> | null = null;

/**
 * Runs the requested reset against this page's storage, once per page and one
 * page at a time, failing if it does not finish within
 * {@link DEVICE_RESET_TIMEOUT_MS}.
 */
export function runRequestedDeviceReset(): Promise<void> {
  pendingDeviceReset ??= (async () => {
    const { promise: timeout, reject } = Promise.withResolvers<never>();
    const timer = setTimeout(
      () => reject(new Error("Resetting took too long.")),
      DEVICE_RESET_TIMEOUT_MS,
    );
    try {
      await Promise.race([
        runWithDeviceResetLock(async () => {
          // A tab that reloaded with this one may have finished the reset
          // while this page waited for the lock.
          if (!isDeviceResetRequested()) {
            return;
          }
          await completeDeviceReset({
            indexedDB:
              typeof indexedDB === "undefined"
                ? undefined
                : globalThis.indexedDB,
            localStorage: globalThis.localStorage,
            sessionStorage: globalThis.sessionStorage,
            wipeOpfs: () => wipeOpfsStorage(),
          });
        }),
        timeout,
      ]);
    } finally {
      clearTimeout(timer);
    }
  })();
  return pendingDeviceReset;
}

/** Whether the SQLite worker must still wipe OPFS for a device reset. */
export function isWorkerStorageWipePending(
  storage = getLocalStorage(),
): boolean {
  return storage?.getItem(WORKER_STORAGE_WIPE_KEY) === "1";
}

export function clearWorkerStorageWipePending(
  storage = getLocalStorage(),
): void {
  storage?.removeItem(WORKER_STORAGE_WIPE_KEY);
}
