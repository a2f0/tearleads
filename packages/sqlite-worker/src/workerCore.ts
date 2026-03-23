import type { WorkerRequest, WorkerResponse } from "./types";

export interface DatabaseWorkerScope {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<WorkerRequest>) => void | Promise<void>,
  ): void;
  postMessage(message: WorkerResponse): void;
}

export interface RegisterDatabaseWorkerOptions {
  onInit?: (dbName: string) => Promise<void> | void;
}

export function registerDatabaseWorker(
  scope: DatabaseWorkerScope,
  options: RegisterDatabaseWorkerOptions = {},
): void {
  scope.addEventListener("message", async (event: MessageEvent<WorkerRequest>) => {
    const response = await handleRequest(event.data, options);
    scope.postMessage(response);
  });
}

export async function handleRequest(
  message: WorkerRequest,
  options: RegisterDatabaseWorkerOptions,
): Promise<WorkerResponse> {
  switch (message.method) {
    case "ping":
      return {
        id: message.id,
        result: { ok: true, message: "pong" },
      };

    case "init":
      await options.onInit?.(message.params.dbName);
      return {
        id: message.id,
        result: { ok: true },
      };
  }
}
