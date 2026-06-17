import type { WorkerLike } from "./client";
import { queryLiveClientIds } from "./crossTabLocks";
import { requestId, requestMethod, responseId } from "./crossTabProtocol";
import { WORKER_CONNECT_PORT_MESSAGE_TYPE } from "./types";

const CROSS_TAB_CLIENT_SWEEP_INTERVAL_MS = 1_000;

export interface ModuleWorkerLike extends WorkerLike {
  terminate(): void;
}

export interface ModuleWorkerConstructor {
  new (scriptURL: string | URL, options?: WorkerOptions): ModuleWorkerLike;
}

interface CrossTabRouteOptions {
  readonly hasClientLock: boolean;
}

/**
 * The single per-origin owner: it constructs the dedicated SQLite worker, opens a
 * `MessagePort` per logical client (local or remote), forwards each client's
 * requests to the worker, and fans the worker's responses back to the originating
 * client (locally via {@link dispatchLocalResponse}, and over the broadcast
 * channel for remote tabs).
 *
 * Exactly one owner exists at a time; {@link CrossTabCoordinator} installs it
 * while it holds the owner lock and tears it down via {@link release} when the
 * lock is released. Clients whose Web Lock liveness disappears (their tab is gone)
 * are reaped by the periodic sweep so a crashed tab cannot pin the owner open.
 */
export class CrossTabOwner {
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
