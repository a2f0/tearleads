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
    listener: (event: MessageEvent<unknown>) => void | Promise<void>,
  ): void;
  removeEventListener?(
    type: "message",
    listener: (event: MessageEvent<unknown>) => void | Promise<void>,
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
  // Destructive shutdown hook: close the db and wipe its persistent-VFS files.
  onDelete?: () => Promise<void> | void;
}

export function isWorkerRequest(value: unknown): value is WorkerRequest {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const id = Reflect.get(value, "id");
  const method = Reflect.get(value, "method");

  return (
    typeof id === "number" &&
    (method === "ping" ||
      method === "init" ||
      method === "exec" ||
      method === "close" ||
      method === "delete")
  );
}

export function registerDatabaseWorker(
  scope: DatabaseWorkerScope,
  options: RegisterDatabaseWorkerOptions = {},
): () => void {
  const handleMessage = async (event: MessageEvent<unknown>) => {
    const request = event.data;
    if (!isWorkerRequest(request)) {
      return;
    }

    try {
      const response = await handleRequest(request, options);
      scope.postMessage(response);
    } catch (error) {
      scope.postMessage({
        id: request.id,
        result: {
          ok: false,
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  };

  scope.addEventListener("message", handleMessage);
  return () => scope.removeEventListener?.("message", handleMessage);
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

    case "delete":
      await options.onDelete?.();
      return {
        id: message.id,
        result: { ok: true },
      };
  }
}
