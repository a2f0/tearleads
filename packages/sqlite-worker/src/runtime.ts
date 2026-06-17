import {
  createDatabaseWorkerClient,
  type DatabaseWorkerClient,
  type WorkerLike,
} from "./client";

const DEFAULT_DATABASE_WORKER_URL = "/worker.js";

interface TerminableWorkerLike extends WorkerLike {
  terminate(): void;
}

export interface ModuleWorkerLike extends TerminableWorkerLike {}

export interface ModuleWorkerConstructor {
  new (scriptURL: string | URL, options?: WorkerOptions): ModuleWorkerLike;
}

export interface DatabaseRuntime {
  id: string;
  client: DatabaseWorkerClient;
  destroy(): void;
  /**
   * Synchronous, abrupt teardown for page-unload handlers (`pagehide`), where
   * there is no time for destroy()'s async graceful close. Terminating the worker
   * thread releases its OPFS access handles promptly, so the next page's worker
   * can acquire them instead of racing a leaked handle from the discarded page.
   */
  terminateNow(): void;
}

export interface CreateModuleDatabaseRuntimeOptions {
  workerConstructor?: ModuleWorkerConstructor;
  workerUrl?: string | URL;
}

function createModuleWorker(
  workerUrl: string | URL,
  workerConstructor: ModuleWorkerConstructor = globalThis.Worker,
): ModuleWorkerLike {
  return new workerConstructor(workerUrl, { type: "module" });
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
): DatabaseRuntime {
  const client = createDatabaseWorkerClient(worker);
  let torndown = false;

  // Terminate exactly once, tearing down the client first so its pending-request
  // map is cleared and listeners removed.
  const terminate = () => {
    if (torndown) {
      return;
    }
    torndown = true;
    client.destroy();
    worker.terminate();
  };

  return {
    id: crypto.randomUUID(),
    client,
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
    terminateNow() {
      terminate();
    },
  };
}

export function createModuleDatabaseRuntime(
  options: CreateModuleDatabaseRuntimeOptions = {},
): DatabaseRuntime {
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
  );
}
