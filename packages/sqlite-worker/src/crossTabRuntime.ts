import type { WorkerLike } from "./client";
import { WORKER_CONNECT_PORT_MESSAGE_TYPE, type WorkerResponse } from "./types";

const CROSS_TAB_CHANNEL_NAME = "tearleads-sqlite-worker";
const CROSS_TAB_OWNER_LOCK_NAME = "tearleads-sqlite-worker-owner";
const CROSS_TAB_REQUEST_TIMEOUT_MS = 10_000;

interface CrossTabDatabaseWorker extends WorkerLike {
  close(): void;
}

interface ModuleWorkerLike extends WorkerLike {
  terminate(): void;
}

interface ModuleWorkerConstructor {
  new (scriptURL: string | URL, options?: WorkerOptions): ModuleWorkerLike;
}

interface LockManagerLike {
  request(
    name: string,
    options: { ifAvailable: true },
    callback: (lock: unknown) => Promise<void> | void,
  ): Promise<void>;
}

interface LocalClient {
  readonly dispatch: (response: unknown) => void;
  readonly timeoutsByRequestId: Map<number, ReturnType<typeof setTimeout>>;
}

type CrossTabEnvelope =
  | {
      readonly type: "request";
      readonly clientId: string;
      readonly request: unknown;
    }
  | {
      readonly type: "response";
      readonly clientId: string;
      readonly response: unknown;
    };

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

function getString(value: unknown, key: string): string | null {
  if (!isObject(value)) {
    return null;
  }

  const property = Reflect.get(value, key);
  return typeof property === "string" ? property : null;
}

function getNumber(value: unknown, key: string): number | null {
  if (!isObject(value)) {
    return null;
  }

  const property = Reflect.get(value, key);
  return typeof property === "number" ? property : null;
}

function requestId(request: unknown): number | null {
  return getNumber(request, "id");
}

function requestMethod(request: unknown): string | null {
  return getString(request, "method");
}

function responseId(response: unknown): number | null {
  return getNumber(response, "id");
}

function errorResponse(id: number, message: string): WorkerResponse {
  return {
    id,
    result: {
      ok: false,
      message,
    },
  };
}

function isCrossTabEnvelope(value: unknown): value is CrossTabEnvelope {
  if (!isObject(value)) {
    return false;
  }

  const type = Reflect.get(value, "type");
  const clientId = Reflect.get(value, "clientId");
  if (typeof clientId !== "string") {
    return false;
  }

  if (type === "request") {
    return true;
  }

  return type === "response";
}

function lockManager(): LockManagerLike | null {
  const navigatorValue = Reflect.get(globalThis, "navigator");
  if (!isObject(navigatorValue)) {
    return null;
  }

  const locks = Reflect.get(navigatorValue, "locks");
  if (!isObject(locks)) {
    return null;
  }

  const request = Reflect.get(locks, "request");
  if (typeof request !== "function") {
    return null;
  }

  return {
    request(name, options, callback) {
      return Promise.resolve(
        Reflect.apply(request, locks, [name, options, callback]),
      ).then(() => undefined);
    },
  };
}

function canUseCrossTabPrimitives(): boolean {
  return (
    typeof BroadcastChannel !== "undefined" &&
    typeof MessageChannel !== "undefined" &&
    lockManager() !== null
  );
}

class CrossTabOwner {
  private readonly activeClientIds = new Set<string>();
  private readonly methodsByClientRequestId = new Map<
    string,
    Map<number, string>
  >();
  private readonly portsByClientId = new Map<string, MessagePort>();
  private readonly worker: ModuleWorkerLike;

  constructor(
    workerUrl: string | URL,
    workerConstructor: ModuleWorkerConstructor,
    private readonly channel: BroadcastChannel,
    private readonly dispatchLocalResponse: (
      clientId: string,
      response: unknown,
    ) => void,
    private readonly release: () => void,
  ) {
    this.worker = new workerConstructor(workerUrl, { type: "module" });
  }

  route(clientId: string, request: unknown): void {
    const port = this.ensurePort(clientId);
    this.rememberMethod(clientId, request);
    this.activeClientIds.add(clientId);
    port.postMessage(request);
  }

  stop(): void {
    for (const port of this.portsByClientId.values()) {
      port.close();
    }
    this.portsByClientId.clear();
    this.activeClientIds.clear();
    this.worker.terminate();
  }

  private ensurePort(clientId: string): MessagePort {
    const existing = this.portsByClientId.get(clientId);
    if (existing) {
      return existing;
    }

    const channel = new MessageChannel();
    channel.port1.start();
    channel.port1.addEventListener("message", (event) => {
      this.handleWorkerResponse(clientId, event);
    });
    this.worker.postMessage({ type: WORKER_CONNECT_PORT_MESSAGE_TYPE }, [
      channel.port2,
    ]);
    this.portsByClientId.set(clientId, channel.port1);
    return channel.port1;
  }

  private handleWorkerResponse(clientId: string, event: MessageEvent): void {
    const response = event.data;
    const method = this.takeMethod(clientId, response);
    this.dispatchLocalResponse(clientId, response);
    this.channel.postMessage({
      type: "response",
      clientId,
      response,
    });

    if (method === "close" || method === "delete") {
      this.closeClient(clientId);
    }
  }

  private rememberMethod(clientId: string, request: unknown): void {
    const id = requestId(request);
    const method = requestMethod(request);
    if (id === null || method === null) {
      return;
    }

    const methods =
      this.methodsByClientRequestId.get(clientId) ?? new Map<number, string>();
    methods.set(id, method);
    this.methodsByClientRequestId.set(clientId, methods);
  }

  private takeMethod(clientId: string, response: unknown): string | null {
    const id = responseId(response);
    if (id === null) {
      return null;
    }

    const methods = this.methodsByClientRequestId.get(clientId);
    const method = methods?.get(id) ?? null;
    methods?.delete(id);
    if (methods?.size === 0) {
      this.methodsByClientRequestId.delete(clientId);
    }

    return method;
  }

  private closeClient(clientId: string): void {
    this.activeClientIds.delete(clientId);
    const port = this.portsByClientId.get(clientId);
    port?.close();
    this.portsByClientId.delete(clientId);
    this.methodsByClientRequestId.delete(clientId);

    if (this.activeClientIds.size === 0) {
      this.stop();
      this.release();
    }
  }
}

class CrossTabCoordinator {
  private readonly channel = new BroadcastChannel(CROSS_TAB_CHANNEL_NAME);
  private readonly localClientsById = new Map<string, LocalClient>();
  private owner: CrossTabOwner | null = null;
  private ownerAttempt: Promise<boolean> | null = null;

  constructor(
    private readonly workerUrl: string | URL,
    private readonly workerConstructor: ModuleWorkerConstructor,
  ) {
    this.channel.addEventListener("message", (event) => {
      this.handleChannelMessage(event);
    });
  }

  createWorker(): CrossTabDatabaseWorker {
    const clientId = crypto.randomUUID();
    const events = new EventTarget();
    this.localClientsById.set(clientId, {
      dispatch: (response) => {
        events.dispatchEvent(new MessageEvent("message", { data: response }));
      },
      timeoutsByRequestId: new Map(),
    });

    return {
      postMessage: (message) => {
        this.route(clientId, message);
      },
      addEventListener(type, listener) {
        events.addEventListener(type, listener);
      },
      removeEventListener(type, listener) {
        events.removeEventListener(type, listener);
      },
      close: () => {
        this.unregisterLocalClient(clientId);
      },
    };
  }

  private route(clientId: string, request: unknown): void {
    void this.routeAsync(clientId, request);
  }

  private async routeAsync(clientId: string, request: unknown): Promise<void> {
    const id = requestId(request);
    try {
      if (await this.ensureOwner()) {
        this.owner?.route(clientId, request);
        return;
      }

      this.postRemoteRequest(clientId, request);
    } catch (error: unknown) {
      if (id !== null) {
        this.dispatchLocalResponse(
          clientId,
          errorResponse(
            id,
            error instanceof Error
              ? error.message
              : "Failed to route database request.",
          ),
        );
      }
    }
  }

  private postRemoteRequest(clientId: string, request: unknown): void {
    const id = requestId(request);
    if (id !== null) {
      const localClient = this.localClientsById.get(clientId);
      const timeoutId = setTimeout(() => {
        localClient?.timeoutsByRequestId.delete(id);
        this.dispatchLocalResponse(
          clientId,
          errorResponse(id, "Timed out waiting for the database owner tab."),
        );
      }, CROSS_TAB_REQUEST_TIMEOUT_MS);
      localClient?.timeoutsByRequestId.set(id, timeoutId);
    }

    this.channel.postMessage({
      type: "request",
      clientId,
      request,
    });
  }

  private dispatchLocalResponse(clientId: string, response: unknown): void {
    const localClient = this.localClientsById.get(clientId);
    if (!localClient) {
      return;
    }

    const id = responseId(response);
    if (id !== null) {
      const timeoutId = localClient.timeoutsByRequestId.get(id);
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
        localClient.timeoutsByRequestId.delete(id);
      }
    }

    localClient.dispatch(response);
  }

  private unregisterLocalClient(clientId: string): void {
    const localClient = this.localClientsById.get(clientId);
    if (localClient) {
      for (const timeoutId of localClient.timeoutsByRequestId.values()) {
        clearTimeout(timeoutId);
      }
    }

    this.localClientsById.delete(clientId);
  }

  private handleChannelMessage(event: MessageEvent): void {
    const envelope = event.data;
    if (!isCrossTabEnvelope(envelope)) {
      return;
    }

    if (envelope.type === "request") {
      this.owner?.route(envelope.clientId, envelope.request);
      return;
    }

    this.dispatchLocalResponse(envelope.clientId, envelope.response);
  }

  private async ensureOwner(): Promise<boolean> {
    if (this.owner) {
      return true;
    }

    if (!this.ownerAttempt) {
      this.ownerAttempt = this.tryBecomeOwner().finally(() => {
        this.ownerAttempt = null;
      });
    }

    return this.ownerAttempt;
  }

  private async tryBecomeOwner(): Promise<boolean> {
    const locks = lockManager();
    if (!locks) {
      return false;
    }

    let resolveAcquired: (acquired: boolean) => void = () => {};
    const acquired = new Promise<boolean>((resolve) => {
      resolveAcquired = resolve;
    });

    void locks.request(
      CROSS_TAB_OWNER_LOCK_NAME,
      { ifAvailable: true },
      async (lock) => {
        if (!lock) {
          resolveAcquired(false);
          return;
        }

        let releaseOwner: (() => void) | null = null;
        const ownerReleased = new Promise<void>((resolve) => {
          releaseOwner = resolve;
        });
        this.owner = new CrossTabOwner(
          this.workerUrl,
          this.workerConstructor,
          this.channel,
          (clientId, response) =>
            this.dispatchLocalResponse(clientId, response),
          () => {
            this.owner = null;
            releaseOwner?.();
          },
        );
        resolveAcquired(true);
        await ownerReleased;
      },
    );

    return acquired;
  }
}

const coordinatorsByWorkerUrl = new Map<string, CrossTabCoordinator>();

export function createCrossTabDatabaseWorker(
  workerUrl: string | URL,
  workerConstructor: ModuleWorkerConstructor,
): CrossTabDatabaseWorker | null {
  if (!canUseCrossTabPrimitives()) {
    return null;
  }

  const key = String(workerUrl);
  let coordinator = coordinatorsByWorkerUrl.get(key);
  if (!coordinator) {
    coordinator = new CrossTabCoordinator(workerUrl, workerConstructor);
    coordinatorsByWorkerUrl.set(key, coordinator);
  }

  return coordinator.createWorker();
}
