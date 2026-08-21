import {
  createDatabaseWorkerClient,
  type DatabaseWorkerClient,
  type WorkerLike,
} from "./client";
import { createCrossTabDatabaseWorker } from "./crossTabRuntime";
import {
  availableMessageChannelConstructor,
  closeMessagePort,
  createRenewedDatabaseClient,
  type DatabaseRuntimeMessageChannelConstructor,
  type DatabaseRuntimeMessagePort,
  disconnectMessagePort,
} from "./renewedClientTransport";

const DEFAULT_DATABASE_WORKER_URL = "/worker.js";
const DEFAULT_SHARED_DATABASE_WORKER_NAME = "symcrypt-sqlite-worker";

interface TerminableWorkerLike extends WorkerLike {
  terminate(): void;
}

interface CloseableWorkerLike extends WorkerLike {
  close(): void;
  /**
   * Cross-tab worker only: force-stop a possibly-wedged owner (its worker went
   * silent and never answered the graceful `close`) so the next boot builds a
   * fresh owner. Absent on a real SharedWorker port, where the browser reclaims
   * the port/owner itself; called optionally.
   */
  forceStopOwner?(): void;
}

export interface ModuleWorkerLike extends TerminableWorkerLike {}

export interface ModuleWorkerConstructor {
  new (scriptURL: string | URL, options?: WorkerOptions): ModuleWorkerLike;
}

export interface ModuleSharedWorkerLike {
  readonly port: CloseableWorkerLike & { start?: () => void };
  addEventListener?: WorkerLike["addEventListener"];
  removeEventListener?: WorkerLike["removeEventListener"];
}

export interface ModuleSharedWorkerConstructor {
  new (
    scriptURL: string | URL,
    options?: {
      name?: string;
      type?: "classic" | "module";
    },
  ): ModuleSharedWorkerLike;
}

export interface DatabaseRuntime {
  id: string;
  client: DatabaseWorkerClient;
  destroy(): void;
  /**
   * Permanently destroy the persisted database: ask the worker to wipe its OPFS
   * files (not merely release the handles, as {@link destroy} does), then
   * terminate the worker. Resolves once teardown completes. Used to forget local
   * data on logout. Best-effort: a wipe failure still terminates the worker.
   */
  deleteData(): Promise<void>;
  /**
   * Synchronous, abrupt teardown for page-unload handlers (`pagehide`), where
   * there is no time for destroy()'s async graceful close. Terminating the worker
   * thread releases its OPFS access handles promptly, so the next page's worker
   * can acquire them instead of racing a leaked handle from the discarded page.
   */
  terminateNow(): void;
  /**
   * Replace this runtime's main-thread client (and its `id`) with a fresh one on
   * the SAME worker, without tearing the worker down. Used when the worker is
   * reused for a different database (see the app's `reuseDatabaseWorker` path):
   * the SDK keys per-connection caches — schema/projection ensures, mutation
   * queues, persistence runtimes — off the client object, so a new database MUST
   * see a fresh client or it inherits the previous database's "schema already
   * ensured" state and then queries/writes missing tables. Only the dedicated
   * runtime implements this; the cross-tab runtime omits it (it is never reused).
   */
  renewClient?(): void;
}

export interface CreateModuleDatabaseRuntimeOptions {
  /**
   * Dedicated Worker fallback. Supplying this keeps the historical dedicated
   * worker path, which is useful for tests and non-browser hosts.
   */
  workerConstructor?: ModuleWorkerConstructor;
  /**
   * SharedWorker constructor for browser hosts that can share one SQLite owner
   * across tabs. Pass `null` to force the dedicated Worker fallback.
   */
  sharedWorkerConstructor?: ModuleSharedWorkerConstructor | null;
  sharedWorkerName?: string;
  /**
   * Overrides the channel used to give a renewed client fresh worker-side
   * connection state. Pass `null` in hosts without transferable message ports;
   * the returned runtime then omits its optional renewal capability.
   */
  messageChannelConstructor?: DatabaseRuntimeMessageChannelConstructor | null;
  workerUrl?: string | URL;
}

function createModuleWorker(
  workerUrl: string | URL,
  workerConstructor: ModuleWorkerConstructor = globalThis.Worker,
): ModuleWorkerLike {
  return new workerConstructor(workerUrl, { type: "module" });
}

function portFromModuleSharedWorker(
  sharedWorker: ModuleSharedWorkerLike,
): CloseableWorkerLike {
  sharedWorker.port.start?.();

  return {
    postMessage(message) {
      sharedWorker.port.postMessage(message);
    },
    addEventListener(type, listener) {
      if (type === "error" && sharedWorker.addEventListener) {
        sharedWorker.addEventListener(type, listener);
        return;
      }

      sharedWorker.port.addEventListener(type, listener);
    },
    removeEventListener(type, listener) {
      if (type === "error" && sharedWorker.removeEventListener) {
        sharedWorker.removeEventListener(type, listener);
        return;
      }

      sharedWorker.port.removeEventListener(type, listener);
    },
    close() {
      sharedWorker.port.close();
    },
  };
}

function createModuleSharedWorkerPort(
  workerUrl: string | URL,
  sharedWorkerConstructor: ModuleSharedWorkerConstructor,
  sharedWorkerName: string,
): CloseableWorkerLike {
  return portFromModuleSharedWorker(
    new sharedWorkerConstructor(workerUrl, {
      name: sharedWorkerName,
      type: "module",
    }),
  );
}

function createExplicitSharedWorkerPort(
  options: CreateModuleDatabaseRuntimeOptions,
): CloseableWorkerLike | null {
  if (options.workerConstructor || !options.sharedWorkerConstructor) {
    return null;
  }

  return createModuleSharedWorkerPort(
    options.workerUrl ?? DEFAULT_DATABASE_WORKER_URL,
    options.sharedWorkerConstructor,
    options.sharedWorkerName ?? DEFAULT_SHARED_DATABASE_WORKER_NAME,
  );
}

// Upper bound on how long destroy() waits for the worker's graceful close
// (db close + SAHPool handle release) before terminating anyway. Releasing the
// OPFS handles is near-instant; this only guards against a wedged worker so
// teardown can never hang. If it elapses we terminate regardless — the browser
// then releases the handles asynchronously and the next boot's contention retry
// covers the gap.
const GRACEFUL_CLOSE_TIMEOUT_MS = 1_000;

export function createDatabaseRuntime(
  worker: TerminableWorkerLike,
  messageChannelConstructor = availableMessageChannelConstructor(),
): DatabaseRuntime {
  // Client/id stay mutable for same-worker renewal; one request-id sequence spans
  // generations so a late old response cannot match a replacement request.
  const requestIdSequence = { current: 1 };
  let client = createDatabaseWorkerClient(worker, requestIdSequence);
  let activeClientPort: DatabaseRuntimeMessagePort | null = null;
  let id: string = crypto.randomUUID();
  let torndown = false;

  // Terminate exactly once, tearing down the client first so its pending-request
  // map is cleared and listeners removed.
  const terminate = () => {
    if (torndown) {
      return;
    }
    torndown = true;
    client.destroy();
    closeMessagePort(activeClientPort);
    activeClientPort = null;
    worker.terminate();
  };

  const runtime: DatabaseRuntime = {
    get id() {
      return id;
    },
    get client() {
      return client;
    },
    destroy() {
      if (torndown) {
        return;
      }
      // Ask the worker to release the database and its OPFS access handles
      // *before* we terminate it. terminate() alone releases handles only
      // asynchronously, which is what makes a reloaded page's SAHPool install
      // race and fail; closing first hands the handles off cleanly.
      //
      // destroy() stays synchronous (React effect cleanups can't await), so this
      // is fire-and-forget: terminate once the worker confirms the close, or
      // once the timeout elapses if it never does. `terminate` is idempotent, so
      // the race between the two is harmless.
      const timeoutId = setTimeout(terminate, GRACEFUL_CLOSE_TIMEOUT_MS);
      client.close().then(
        () => {
          clearTimeout(timeoutId);
          terminate();
        },
        () => {
          // The worker may already be gone or never responded; terminate anyway.
          clearTimeout(timeoutId);
          terminate();
        },
      );
    },
    async deleteData() {
      if (torndown) {
        return;
      }
      // Ask the worker to wipe its OPFS files before terminating. Unlike
      // destroy()'s fire-and-forget close, callers await this so they know the
      // data is gone before re-provisioning a fresh database. The wipe is
      // best-effort inside the worker; terminate regardless once it settles or
      // the timeout elapses so teardown can never hang on a wedged worker.
      await new Promise<void>((resolve) => {
        const timeoutId = setTimeout(() => {
          terminate();
          resolve();
        }, GRACEFUL_CLOSE_TIMEOUT_MS);
        const finish = () => {
          clearTimeout(timeoutId);
          terminate();
          resolve();
        };
        client.delete().then(finish, finish);
      });
    },
    terminateNow() {
      terminate();
    },
  };

  if (messageChannelConstructor) {
    runtime.renewClient = () => {
      if (torndown) {
        return;
      }

      let renewed: ReturnType<typeof createRenewedDatabaseClient>;
      try {
        renewed = createRenewedDatabaseClient({
          messageChannelConstructor,
          requestIdSequence,
          worker,
        });
      } catch (error) {
        // MessageChannel existence does not guarantee this Worker accepts a
        // transferred port. Retire the capability so the app's next retry uses
        // its safe teardown/new-runtime fallback instead of looping this failure.
        delete runtime.renewClient;
        throw error;
      }

      const previousClient = client;
      const previousPort = activeClientPort;
      client = renewed.client;
      activeClientPort = renewed.port;
      id = renewed.id;

      // Only retire the previous generation after the worker accepted the new
      // port. A failed transfer therefore leaves the old client fully usable.
      previousClient.destroy();
      disconnectMessagePort(previousPort);
    };
  }

  return runtime;
}

function postCloseWithoutWaiting(worker: WorkerLike): void {
  try {
    worker.postMessage({ id: 0, method: "close", params: undefined });
  } catch {
    // The page is unloading or the closeable port is already gone. The browser
    // will release page-owned ports/workers when the document is discarded.
  }
}

export function createSharedDatabaseRuntime(
  worker: CloseableWorkerLike,
): DatabaseRuntime {
  const client = createDatabaseWorkerClient(worker);
  let torndown = false;

  const close = () => {
    if (torndown) {
      return;
    }

    torndown = true;
    client.destroy();
    worker.close();
  };

  // Abrupt teardown: the graceful `close`/`delete` never came back (the worker is
  // wedged) or there was no time to wait for it, so the owner was never stopped
  // via its close-response. Also force-stop a possibly-wedged owner so the next
  // boot re-contends and builds a fresh owner instead of routing into the dead
  // one. Idempotent and no-ops when the owner already stopped itself (healthy
  // close) or this tab is not the owner.
  const forceClose = () => {
    if (torndown) {
      return;
    }

    torndown = true;
    client.destroy();
    worker.forceStopOwner?.();
    worker.close();
  };

  return {
    id: crypto.randomUUID(),
    client,
    destroy() {
      if (torndown) {
        return;
      }

      // The worker acked the graceful close within the budget → it already stopped
      // the owner itself, so a plain close() suffices. If it did NOT ack (timeout
      // or rejection), it may be wedged → force-stop the owner.
      const timeoutId = setTimeout(forceClose, GRACEFUL_CLOSE_TIMEOUT_MS);
      client.close().then(
        () => {
          clearTimeout(timeoutId);
          close();
        },
        () => {
          clearTimeout(timeoutId);
          forceClose();
        },
      );
    },
    async deleteData() {
      if (torndown) {
        return;
      }

      await new Promise<void>((resolve) => {
        const timeoutId = setTimeout(() => {
          forceClose();
          resolve();
        }, GRACEFUL_CLOSE_TIMEOUT_MS);
        const finish = () => {
          clearTimeout(timeoutId);
          close();
          resolve();
        };
        const fail = () => {
          clearTimeout(timeoutId);
          forceClose();
          resolve();
        };
        client.delete().then(finish, fail);
      });
    },
    terminateNow() {
      if (torndown) {
        return;
      }

      postCloseWithoutWaiting(worker);
      forceClose();
    },
  };
}

export function createModuleDatabaseRuntime(
  options: CreateModuleDatabaseRuntimeOptions = {},
): DatabaseRuntime {
  if (
    !options.workerConstructor &&
    options.sharedWorkerConstructor === undefined &&
    typeof Worker !== "undefined"
  ) {
    const crossTabWorker = createCrossTabDatabaseWorker(
      options.workerUrl ?? DEFAULT_DATABASE_WORKER_URL,
      globalThis.Worker,
    );
    if (crossTabWorker) {
      return createSharedDatabaseRuntime(crossTabWorker);
    }
  }

  const sharedWorkerPort = createExplicitSharedWorkerPort(options);
  if (sharedWorkerPort) {
    return createSharedDatabaseRuntime(sharedWorkerPort);
  }

  if (
    typeof options.workerConstructor === "undefined" &&
    typeof Worker === "undefined"
  ) {
    throw new Error("Worker must be defined.");
  }

  return createDatabaseRuntime(
    createModuleWorker(
      options.workerUrl ?? DEFAULT_DATABASE_WORKER_URL,
      options.workerConstructor,
    ),
    availableMessageChannelConstructor(options.messageChannelConstructor),
  );
}
