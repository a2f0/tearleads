import type {
  DatabaseWorkerClosed,
  DatabaseWorkerDeleted,
  DatabaseWorkerExecOptions,
  DatabaseWorkerExecResult,
  DatabaseWorkerInitOptions,
  DatabaseWorkerPingResult,
  DatabaseWorkerReady,
  WorkerMethod,
  WorkerRequestMap,
} from "./types";

export interface DatabaseWorkerClient {
  ping(): Promise<DatabaseWorkerPingResult>;
  init(options: DatabaseWorkerInitOptions): Promise<DatabaseWorkerReady>;
  exec(options: DatabaseWorkerExecOptions): Promise<DatabaseWorkerExecResult>;
  /**
   * Ask the worker to gracefully release its database and persistent-VFS OPFS
   * handles. Resolves when the worker confirms; callers terminate the worker
   * after this so the next worker can acquire the handles without contention.
   */
  close(): Promise<DatabaseWorkerClosed>;
  /**
   * Ask the worker to close its database and WIPE the persistent-VFS OPFS files,
   * permanently destroying the on-disk data (vs {@link close}, which only
   * releases the handles). Callers terminate the worker after this resolves.
   */
  delete(): Promise<DatabaseWorkerDeleted>;
  destroy(): void;
}

function toError(value: unknown, defaultMessage: string): Error {
  if (value instanceof Error) {
    return value;
  }

  if (typeof value === "string" && value.length > 0) {
    return new Error(value);
  }

  return new Error(defaultMessage);
}

function rejectPendingRequests(
  pending: Map<number, PendingRequest>,
  error: Error,
): void {
  for (const callback of pending.values()) {
    callback.reject(error);
  }

  pending.clear();
}

type PendingRequest = {
  resolve: (value: WorkerRequestMap[WorkerMethod]["result"]) => void;
  reject: (error: Error) => void;
};

export interface WorkerLike {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(
    type: "message" | "error",
    listener: (event: Event) => void,
  ): void;
  removeEventListener(
    type: "message" | "error",
    listener: (event: Event) => void,
  ): void;
}

function makeMessageHandler(pending: Map<number, PendingRequest>) {
  return (event: Event) => {
    if (!(event instanceof MessageEvent)) {
      return;
    }

    const response = event.data;
    const callback = pending.get(response.id);

    if (!callback) {
      return;
    }

    pending.delete(response.id);

    if (!response.result.ok) {
      callback.reject(new Error(response.result.message));
      return;
    }

    callback.resolve(response.result);
  };
}

function makeErrorHandler(pending: Map<number, PendingRequest>) {
  return (event: Event) => {
    const workerError =
      event instanceof ErrorEvent
        ? toError(event.error ?? event.message, "Database worker failed.")
        : new Error("Database worker failed.");

    rejectPendingRequests(pending, workerError);
  };
}

// Runs on the main thread.
//
// `requestIdSequence` is a caller-owned monotonic counter. When a worker is
// reused across clients (see DatabaseRuntime.renewClient), the replacement client
// must NOT restart request ids at 1: a delayed response to the previous client's
// in-flight request (its listeners already removed) would otherwise arrive at the
// new client and match a new pending request by its bare numeric id, falsely
// completing it — potentially returning the old database's rows to a new-database
// query. Sharing one ever-increasing sequence keeps every generation's ids
// disjoint. Defaults to a private sequence for the common single-client case.
export function createDatabaseWorkerClient(
  worker: WorkerLike,
  requestIdSequence: { current: number } = { current: 1 },
): DatabaseWorkerClient {
  const pending = new Map<number, PendingRequest>();
  let isDestroyed = false;

  const handleMessage = makeMessageHandler(pending);
  const handleError = makeErrorHandler(pending);

  worker.addEventListener("message", handleMessage);
  worker.addEventListener("error", handleError);

  function request(
    method: "ping",
    params: undefined,
  ): Promise<DatabaseWorkerPingResult>;
  function request(
    method: "init",
    params: DatabaseWorkerInitOptions,
  ): Promise<DatabaseWorkerReady>;
  function request(
    method: "exec",
    params: DatabaseWorkerExecOptions,
  ): Promise<DatabaseWorkerExecResult>;
  function request(
    method: "close",
    params: undefined,
  ): Promise<DatabaseWorkerClosed>;
  function request(
    method: "delete",
    params: undefined,
  ): Promise<DatabaseWorkerDeleted>;
  function request(
    method: WorkerMethod,
    params: WorkerRequestMap[WorkerMethod]["params"],
  ): Promise<WorkerRequestMap[WorkerMethod]["result"]> {
    if (isDestroyed) {
      return Promise.reject(
        new Error("Database worker client has been destroyed."),
      );
    }

    const id = requestIdSequence.current++;
    const message = { id, method, params };

    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });

      try {
        worker.postMessage(message);
      } catch (error) {
        pending.delete(id);
        reject(toError(error, "Failed to post message to database worker."));
      }
    });
  }

  return {
    ping() {
      return request("ping", undefined);
    },
    init(options) {
      return request("init", options);
    },
    exec(options) {
      return request("exec", options);
    },
    close() {
      return request("close", undefined);
    },
    delete() {
      return request("delete", undefined);
    },
    destroy() {
      if (isDestroyed) {
        return;
      }

      isDestroyed = true;
      worker.removeEventListener("message", handleMessage);
      worker.removeEventListener("error", handleError);
      rejectPendingRequests(
        pending,
        new Error("Database worker client has been destroyed."),
      );
    },
  };
}
