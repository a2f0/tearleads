import type {
  WorkerMethod,
  WorkerRequest,
  WorkerRequestMap,
  WorkerResponse,
} from "./types";

export interface DatabaseWorkerClient {
  ping(): Promise<WorkerRequestMap["ping"]["result"]>;
  init(
    options: WorkerRequestMap["init"]["params"],
  ): Promise<WorkerRequestMap["init"]["result"]>;
}

export function createDatabaseWorkerClient(
  worker: Worker,
): DatabaseWorkerClient {
  let nextId = 1;
  type PendingRequest = {
    resolve: (value: WorkerRequestMap[WorkerMethod]["result"]) => void;
    reject: (error: Error) => void;
  };
  const pending = new Map<number, PendingRequest>();

  worker.addEventListener("message", (event: MessageEvent<WorkerResponse>) => {
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
  });

  function request<K extends WorkerMethod>(
    method: K,
    params: WorkerRequestMap[K]["params"],
  ): Promise<WorkerRequestMap[K]["result"]> {
    const id = nextId++;
    const message = { id, method, params } as WorkerRequest<K>;

    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      worker.postMessage(message);
    });
  }

  return {
    ping() {
      return request("ping", undefined);
    },
    init(options) {
      return request("init", options);
    },
  };
}
