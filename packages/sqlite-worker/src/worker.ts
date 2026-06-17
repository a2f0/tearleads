import { WORKER_CONNECT_PORT_MESSAGE_TYPE } from "./types";
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

interface PortWorkerScope extends DatabaseWorkerScope {
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

      port.start?.();
      registerDatabaseWorkerRuntime(port, createOptions());
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

    port.start?.();
    registerDatabaseWorkerRuntime(port, createOptions());
  });
}
