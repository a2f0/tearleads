import type { WorkerMethod, WorkerRequestMap, WorkerResponse } from "./types";

export interface DatabaseWorkerClient {
  ping(): Promise<WorkerRequestMap["ping"]["result"]>;
  init(
    options: WorkerRequestMap["init"]["params"],
  ): Promise<WorkerRequestMap["init"]["result"]>;
  destroy(): void;
}

function toError(value: unknown, fallbackMessage: string): Error {
  if (value instanceof Error) {
    return value;
  }

  if (typeof value === "string" && value.length > 0) {
    return new Error(value);
  }

  return new Error(fallbackMessage);
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

// Runs on the main thread
export function createDatabaseWorkerClient(
  worker: Worker,
): DatabaseWorkerClient {
  let nextId = 1;
  const pending = new Map<number, PendingRequest>();
  let isDestroyed = false;

  const handleMessage = (event: MessageEvent<WorkerResponse>) => {
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

  const handleError = (event: Event) => {
    const workerError =
      event instanceof ErrorEvent
        ? toError(event.error ?? event.message, "Database worker failed.")
        : new Error("Database worker failed.");

    rejectPendingRequests(pending, workerError);
  };

  worker.addEventListener("message", handleMessage);
  worker.addEventListener("error", handleError);

  function request<K extends WorkerMethod>(
    method: K,
    params: WorkerRequestMap[K]["params"],
  ): Promise<WorkerRequestMap[K]["result"]> {
    if (isDestroyed) {
      return Promise.reject(
        new Error("Database worker client has been destroyed."),
      );
    }

    const id = nextId++;
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
