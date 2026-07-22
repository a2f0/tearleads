import {
  WORKER_CONNECT_PORT_MESSAGE_TYPE,
  WORKER_DISCONNECT_PORT_MESSAGE_TYPE,
  WORKER_PORT_DISCONNECTED_MESSAGE_TYPE,
  type WorkerResponse,
} from "./types";
import {
  type DatabaseWorkerScope,
  type RegisterDatabaseWorkerOptions,
  registerDatabaseWorker as registerDatabaseWorkerRuntime,
} from "./workerCore";

export type {
  DatabaseWorkerScope,
  RegisterDatabaseWorkerOptions,
} from "./workerCore";

type RegisterDatabaseWorkerFactory = () => RegisterDatabaseWorkerOptions;
type RegisterDatabaseWorkerInput =
  | RegisterDatabaseWorkerOptions
  | RegisterDatabaseWorkerFactory;

interface EventTargetScope {
  addEventListener(type: string, listener: EventListener): void;
}

interface DedicatedWorkerScope extends EventTargetScope {
  postMessage(message: unknown): void;
}

interface PortWorkerScope {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<unknown>) => void | Promise<void>,
  ): void;
  close(): void;
  postMessage(message: unknown): void;
  removeEventListener(
    type: "message",
    listener: (event: MessageEvent<unknown>) => void | Promise<void>,
  ): void;
  start?: () => void;
}

function isEventTargetScope(value: unknown): value is EventTargetScope {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "addEventListener") === "function"
  );
}

function isDedicatedWorkerScope(value: unknown): value is DedicatedWorkerScope {
  return (
    isEventTargetScope(value) &&
    typeof Reflect.get(value, "postMessage") === "function"
  );
}

function isPortWorkerScope(value: unknown): value is PortWorkerScope {
  return (
    isDedicatedWorkerScope(value) &&
    typeof Reflect.get(value, "removeEventListener") === "function"
  );
}

function optionsFactory(
  input: RegisterDatabaseWorkerInput,
): RegisterDatabaseWorkerFactory {
  return typeof input === "function" ? input : () => input;
}

function scopeForDedicatedWorker(
  scope: DedicatedWorkerScope,
): DatabaseWorkerScope {
  return {
    addEventListener(type, listener) {
      scope.addEventListener(type, (event) => {
        if (event instanceof MessageEvent) {
          void listener(event);
        }
      });
    },
    postMessage(message) {
      scope.postMessage(message);
    },
  };
}

function databaseScopeForPort(port: PortWorkerScope): DatabaseWorkerScope {
  const listenerMap = new Map<
    (event: MessageEvent<unknown>) => void | Promise<void>,
    (event: MessageEvent<unknown>) => void | Promise<void>
  >();

  return {
    addEventListener(type, listener) {
      const portListener = (event: MessageEvent<unknown>) => {
        void listener(event);
      };
      listenerMap.set(listener, portListener);
      port.addEventListener(type, portListener);
    },
    postMessage(message: WorkerResponse) {
      port.postMessage(message);
    },
    removeEventListener(type, listener) {
      const portListener = listenerMap.get(listener);
      if (!portListener) {
        return;
      }
      listenerMap.delete(listener);
      port.removeEventListener(type, portListener);
    },
  };
}

function isDisconnectPortMessage(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    Reflect.get(value, "type") === WORKER_DISCONNECT_PORT_MESSAGE_TYPE
  );
}

function registerDatabaseWorkerPort(
  port: PortWorkerScope,
  options: RegisterDatabaseWorkerOptions,
): void {
  let disconnecting = false;
  let connectionClosed = false;
  const closeConnection = () => {
    if (connectionClosed) {
      return;
    }
    connectionClosed = true;
    return options.onClose?.();
  };
  const unregister = registerDatabaseWorkerRuntime(databaseScopeForPort(port), {
    ...options,
    onClose: closeConnection,
  });
  const handleDisconnect = (event: MessageEvent<unknown>) => {
    if (disconnecting || !isDisconnectPortMessage(event.data)) {
      return;
    }

    disconnecting = true;
    unregister();
    port.removeEventListener("message", handleDisconnect);

    // Renewed clients normally send this after their graceful `close` response.
    // The idempotent close wrapper also covers a caller that retires early,
    // without invoking custom connection cleanup twice. Once it settles,
    // acknowledge and close the worker-side port; with both listeners removed,
    // its per-client state becomes collectible instead of accumulating.
    const acknowledgeAndClose = () => {
      try {
        port.postMessage({ type: WORKER_PORT_DISCONNECTED_MESSAGE_TYPE });
      } catch {
        // The main-thread endpoint may already be gone; still release this end.
      }
      try {
        port.close();
      } catch {
        // Closing an already-disconnected port is best-effort teardown.
      }
    };
    void Promise.resolve()
      .then(closeConnection)
      .then(acknowledgeAndClose, acknowledgeAndClose);
  };

  port.addEventListener("message", handleDisconnect);
  port.start?.();
}

function connectedPortFromEvent(event: MessageEvent): PortWorkerScope | null {
  const data = event.data;
  if (
    typeof data !== "object" ||
    data === null ||
    Reflect.get(data, "type") !== WORKER_CONNECT_PORT_MESSAGE_TYPE
  ) {
    return null;
  }

  const ports = Reflect.get(event, "ports");
  const port = Array.isArray(ports) ? ports[0] : null;
  return isPortWorkerScope(port) ? port : null;
}

export function registerDatabaseWorker(
  input: RegisterDatabaseWorkerInput = {},
): void {
  const createOptions = optionsFactory(input);
  const workerScope = self;

  if (isDedicatedWorkerScope(workerScope)) {
    workerScope.addEventListener("message", (event) => {
      if (!(event instanceof MessageEvent)) {
        return;
      }

      const port = connectedPortFromEvent(event);
      if (!port) {
        return;
      }

      registerDatabaseWorkerPort(port, createOptions());
    });
    registerDatabaseWorkerRuntime(
      scopeForDedicatedWorker(workerScope),
      createOptions(),
    );
  }

  if (!isEventTargetScope(workerScope)) {
    return;
  }

  workerScope.addEventListener("connect", (event: Event) => {
    const ports = Reflect.get(event, "ports");
    const port = Array.isArray(ports) ? ports[0] : null;
    if (!isPortWorkerScope(port)) {
      return;
    }

    registerDatabaseWorkerPort(port, createOptions());
  });
}
