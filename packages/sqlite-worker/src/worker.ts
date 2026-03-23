import type { WorkerRequest, WorkerResponse } from "./types";

export interface RegisterDatabaseWorkerOptions {
  onInit?: (dbName: string) => Promise<void> | void;
}

export function registerDatabaseWorker(
  options: RegisterDatabaseWorkerOptions = {},
): void {
  self.addEventListener(
    "message",
    async (event: MessageEvent<WorkerRequest>) => {
      const message = event.data;
      const response = await handleRequest(message, options);
      self.postMessage(response);
    },
  );
}

async function handleRequest(
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
