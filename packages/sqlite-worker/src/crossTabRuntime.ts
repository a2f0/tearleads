import type { WorkerLike } from "./client";
import {
  type ClientLivenessLock,
  canUseCrossTabPrimitives,
  createClientLivenessLock,
  lockManager,
  queryLiveClientIds,
} from "./crossTabLocks";
import {
  errorResponse,
  isCrossTabEnvelope,
  requestId,
  requestMethod,
  responseId,
} from "./crossTabProtocol";
import { WORKER_CONNECT_PORT_MESSAGE_TYPE } from "./types";

const CROSS_TAB_CHANNEL_NAME = "tearleads-sqlite-worker";
const CROSS_TAB_OWNER_LOCK_NAME = "tearleads-sqlite-worker-owner";
const CROSS_TAB_REQUEST_TIMEOUT_MS = 10_000;
const CROSS_TAB_CLIENT_SWEEP_INTERVAL_MS = 1_000;

interface CrossTabDatabaseWorker extends WorkerLike {
  close(): void;
}

interface ModuleWorkerLike extends WorkerLike {
  terminate(): void;
}

interface ModuleWorkerConstructor {
  new (scriptURL: string | URL, options?: WorkerOptions): ModuleWorkerLike;
}

interface LocalClient {
  readonly dispatch: (response: unknown) => void;
  readonly liveness: ClientLivenessLock;
  readonly timeoutsByRequestId: Map<number, ReturnType<typeof setTimeout>>;
}

interface CrossTabRouteOptions {
  readonly hasClientLock: boolean;
}

class CrossTabOwner {
  private readonly activeClientIds = new Set<string>();
  private readonly methodsByClientRequestId = new Map<
    string,
    Map<number, string>
  >();
  private readonly portsByClientId = new Map<string, MessagePort>();
  private readonly sweepIntervalId: ReturnType<typeof setInterval>;
  private readonly trackableClientIds = new Set<string>();
  private readonly worker: ModuleWorkerLike;
  private stopped = false;
  private sweepInFlight = false;

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
    this.sweepIntervalId = setInterval(() => {
      void this.sweepInactiveClients();
    }, CROSS_TAB_CLIENT_SWEEP_INTERVAL_MS);
  }

  route(
    clientId: string,
    request: unknown,
    options: CrossTabRouteOptions,
  ): void {
    if (this.stopped) {
      return;
    }

    const port = this.ensurePort(clientId);
    this.rememberMethod(clientId, request);
    this.activeClientIds.add(clientId);
    if (options.hasClientLock) {
      this.trackableClientIds.add(clientId);
    }

    port.postMessage(request);
    void this.sweepInactiveClients();
  }

  stop(): void {
    if (this.stopped) {
      return;
    }

    this.stopped = true;
    clearInterval(this.sweepIntervalId);
    for (const port of this.portsByClientId.values()) {
      port.close();
    }
    this.portsByClientId.clear();
    this.activeClientIds.clear();
    this.trackableClientIds.clear();
    this.methodsByClientRequestId.clear();
    this.worker.terminate();
    this.release();
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
    this.trackableClientIds.delete(clientId);
    const port = this.portsByClientId.get(clientId);
    port?.close();
    this.portsByClientId.delete(clientId);
    this.methodsByClientRequestId.delete(clientId);

    if (this.activeClientIds.size === 0) {
      this.stop();
    }
  }

  private async sweepInactiveClients(): Promise<void> {
    if (
      this.stopped ||
      this.sweepInFlight ||
      this.trackableClientIds.size === 0
    ) {
      return;
    }

    this.sweepInFlight = true;
    try {
      const liveClientIds = await queryLiveClientIds();
      if (!liveClientIds || this.stopped) {
        return;
      }

      for (const clientId of [...this.trackableClientIds]) {
        if (liveClientIds.has(clientId)) {
          continue;
        }

        this.closeClient(clientId);
        if (this.stopped) {
          return;
        }
      }
    } finally {
      this.sweepInFlight = false;
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
      liveness: createClientLivenessLock(clientId),
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
      const hasClientLock = await this.waitForLocalClientLock(clientId);
      if (!this.localClientsById.has(clientId)) {
        return;
      }

      if (await this.ensureOwner()) {
        this.owner?.route(clientId, request, { hasClientLock });
        return;
      }

      this.postRemoteRequest(clientId, request, hasClientLock);
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

  private async waitForLocalClientLock(clientId: string): Promise<boolean> {
    const localClient = this.localClientsById.get(clientId);
    if (!localClient) {
      return false;
    }

    return localClient.liveness.ready;
  }

  private postRemoteRequest(
    clientId: string,
    request: unknown,
    hasClientLock: boolean,
  ): void {
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
      hasClientLock,
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
      localClient.liveness.release();
    }

    this.localClientsById.delete(clientId);
  }

  private handleChannelMessage(event: MessageEvent): void {
    const envelope = event.data;
    if (!isCrossTabEnvelope(envelope)) {
      return;
    }

    if (envelope.type === "request") {
      this.owner?.route(envelope.clientId, envelope.request, {
        hasClientLock: envelope.hasClientLock === true,
      });
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
    let rejectAcquired: (error: unknown) => void = () => {};
    let acquiredSettled = false;
    const rejectAcquiredOnce = (error: unknown) => {
      if (acquiredSettled) {
        return;
      }

      acquiredSettled = true;
      rejectAcquired(error);
    };
    const resolveAcquiredOnce = (hasOwnerLock: boolean) => {
      if (acquiredSettled) {
        return;
      }

      acquiredSettled = true;
      resolveAcquired(hasOwnerLock);
    };
    const acquiredWithRejection = new Promise<boolean>((resolve, reject) => {
      resolveAcquired = resolve;
      rejectAcquired = reject;
    });

    void locks
      .request(
        CROSS_TAB_OWNER_LOCK_NAME,
        { ifAvailable: true },
        async (lock) => {
          if (!lock) {
            resolveAcquiredOnce(false);
            return;
          }

          let releaseOwner: (() => void) | null = null;
          const ownerReleased = new Promise<void>((resolve) => {
            releaseOwner = resolve;
          });
          try {
            const owner = new CrossTabOwner(
              this.workerUrl,
              this.workerConstructor,
              this.channel,
              (clientId, response) =>
                this.dispatchLocalResponse(clientId, response),
              () => {
                if (this.owner === owner) {
                  this.owner = null;
                }
                releaseOwner?.();
              },
            );
            this.owner = owner;
            resolveAcquiredOnce(true);
            await ownerReleased;
          } catch (error) {
            this.owner = null;
            rejectAcquiredOnce(error);
            throw error;
          }
        },
      )
      .catch((error) => {
        rejectAcquiredOnce(error);
      });

    return acquiredWithRejection;
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
