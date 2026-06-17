import type {
  DatabaseWorkerExecOptions,
  DatabaseWorkerExecResult,
  DatabaseWorkerInitOptions,
  WorkerRequest,
  WorkerResponse,
} from "./types";

export interface DatabaseWorkerScope {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<WorkerRequest>) => void | Promise<void>,
  ): void;
  postMessage(message: WorkerResponse): void;
}

export interface RegisterDatabaseWorkerOptions {
  onInit?: (options: DatabaseWorkerInitOptions) => Promise<void> | void;
  onExec?: (
    options: DatabaseWorkerExecOptions,
  ) =>
    | Promise<DatabaseWorkerExecResult["rows"]>
    | DatabaseWorkerExecResult["rows"];
  // Graceful shutdown hook: close the db and release persistent-VFS handles.
  onClose?: () => Promise<void> | void;
}

export function registerDatabaseWorker(
  scope: DatabaseWorkerScope,
  options: RegisterDatabaseWorkerOptions = {},
): void {
  scope.addEventListener(
    "message",
    async (event: MessageEvent<WorkerRequest>) => {
      try {
        const response = await handleRequest(event.data, options);
        scope.postMessage(response);
      } catch (error) {
        scope.postMessage({
          id: event.data.id,
          result: {
            ok: false,
            message: error instanceof Error ? error.message : String(error),
          },
        });
      }
    },
  );
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
      await options.onInit?.(message.params);
      return {
        id: message.id,
        result: { ok: true },
      };

    case "exec":
      return {
        id: message.id,
        result: {
          ok: true,
          rows: (await options.onExec?.(message.params)) ?? [],
        },
      };

    case "close":
      await options.onClose?.();
      return {
        id: message.id,
        result: { ok: true },
      };
  }
}
