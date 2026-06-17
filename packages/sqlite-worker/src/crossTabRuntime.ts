import type { WorkerLike } from "./client";
import {
  type ClientLivenessLock,
  canUseCrossTabPrimitives,
  createClientLivenessLock,
  type LockManagerLike,
  lockManager,
} from "./crossTabLocks";
import { CrossTabOwner, type ModuleWorkerConstructor } from "./crossTabOwner";
import {
  errorResponse,
  isCrossTabEnvelope,
  requestId,
  responseId,
} from "./crossTabProtocol";

const CROSS_TAB_CHANNEL_NAME = "tearleads-sqlite-worker";
const CROSS_TAB_OWNER_LOCK_NAME = "tearleads-sqlite-worker-owner";
const CROSS_TAB_REQUEST_TIMEOUT_MS = 10_000;
// How long a non-owner tab polls for an owner to appear before it unblocks
// routing anyway. Generous enough to cover a same-origin tab winning the
// ownership bid, short enough never to noticeably delay the first request.
const OWNER_OBSERVE_BUDGET_MS = 2_000;
const OWNER_OBSERVE_INTERVAL_MS = 50;

interface CrossTabDatabaseWorker extends WorkerLike {
  close(): void;
}

interface LocalClient {
  readonly dispatch: (response: unknown) => void;
  readonly liveness: ClientLivenessLock;
  readonly timeoutsByRequestId: Map<number, ReturnType<typeof setTimeout>>;
  // Request ids this client posted over BroadcastChannel that have not yet been
  // answered by the owner tab. Used to fail them fast (rather than wait out the
  // timeout) when this tab is promoted to owner after the previous owner died.
  readonly pendingRemoteRequestIds: Set<number>;
}

class CrossTabCoordinator {
  private readonly channel = new BroadcastChannel(CROSS_TAB_CHANNEL_NAME);
  private readonly localClientsById = new Map<string, LocalClient>();
  private owner: CrossTabOwner | null = null;
  // Set if this tab won ownership but its owner worker failed to construct. Such a
  // tab cannot serve requests itself; it surfaces this error to its own clients
  // instead of posting into the void, while the released lock lets another tab try
  // to own. Cleared if a later bid succeeds in installing an owner.
  private ownerError: Error | null = null;
  // Resolves the first time ownership is settled for this tab (it won and either
  // installed or failed to construct an owner, or it observed another tab already
  // owns), so routing waits for an initial verdict instead of posting remotely
  // before any owner exists.
  private readonly initialOwnershipSettled: Promise<void>;
  private settleInitialOwnership: () => void = () => {};

  constructor(
    private readonly workerUrl: string | URL,
    private readonly workerConstructor: ModuleWorkerConstructor,
  ) {
    this.initialOwnershipSettled = new Promise((resolve) => {
      this.settleInitialOwnership = resolve;
    });
    this.channel.addEventListener("message", (event) => {
      this.handleChannelMessage(event);
    });
    // Contend for ownership in the background for this coordinator's whole life.
    // Exactly one tab's bid wins and runs the owner; the rest block inside the
    // lock callback. When the owning tab dies, its lock auto-releases and the
    // next blocked bid is promoted instantly — no polling, no stranded tabs.
    this.contendForOwnership();
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
      pendingRemoteRequestIds: new Set(),
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

      // Don't route until an owner has been elected somewhere; otherwise the
      // first request races the ownership bid and is posted into the void.
      await this.initialOwnershipSettled;
      if (!this.localClientsById.has(clientId)) {
        return;
      }

      if (this.owner) {
        this.owner.route(clientId, request, { hasClientLock });
        return;
      }

      // This tab won ownership earlier but its owner worker failed to construct.
      // If another tab has since become a healthy owner, fall back to it; only
      // surface the construction error when no owner exists anywhere, so a single
      // tab whose worker cannot start fails fast instead of hanging on the timeout.
      if (this.ownerError && !(await this.anotherTabOwns())) {
        throw this.ownerError;
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
      localClient?.pendingRemoteRequestIds.add(id);
      const timeoutId = setTimeout(() => {
        localClient?.timeoutsByRequestId.delete(id);
        localClient?.pendingRemoteRequestIds.delete(id);
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
      localClient.pendingRemoteRequestIds.delete(id);
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

  /**
   * Hold a single, lifelong *blocking* bid for the owner lock. The browser grants
   * it to exactly one coordinator at a time; the rest wait their turn inside the
   * lock manager's queue. When the owning tab is discarded (reload, crash, close),
   * its lock auto-releases and the next queued bid is granted — promoting a new
   * owner with no polling and no gap that strands the surviving tabs.
   *
   * The bid is fire-and-forget: its promise resolves only when this coordinator's
   * own owner is later released, by which point nothing awaits it. The initial
   * routing gate is settled separately by {@link observeExistingOwner} as soon as
   * this tab becomes owner OR observes that another tab already owns.
   */
  private contendForOwnership(): void {
    const locks = lockManager();
    if (!locks) {
      // No Web Locks: this coordinator can never become (or detect) an owner, so
      // unblock routing immediately. It will post remotely and rely on the
      // timeout — the same degraded path as before this change.
      this.settleInitialOwnership();
      return;
    }

    // A non-owner tab's blocking bid stays queued (never enters its callback)
    // until the current owner dies, so it cannot settle the routing gate on its
    // own. Settle it from here as soon as ownership is known either way.
    this.observeExistingOwner(locks);

    void locks
      .request(CROSS_TAB_OWNER_LOCK_NAME, null, async () => {
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
          this.ownerError = null;
          // We were just promoted. Any requests this tab posted to the *previous*
          // owner are now orphaned (that owner's worker is gone, and we won't
          // replay them — an in-flight `exec` may already have committed). Fail
          // them now with a retryable error rather than waiting out the timeout.
          this.failPendingRemoteRequests();
          this.settleInitialOwnership();
          await ownerReleased;
        } catch (error) {
          // This tab won ownership but could not stand up the owner worker. Record
          // the failure so its own clients see the error instead of hanging, then
          // rethrow to release the lock so another tab can try to own.
          this.owner = null;
          this.ownerError =
            error instanceof Error ? error : new Error(String(error));
          this.failPendingRemoteRequests();
          this.settleInitialOwnership();
          throw error;
        }
      })
      .catch(() => {
        // The bid itself failed (e.g. the lock manager rejected). Unblock routing
        // so requests fall back to the remote path instead of hanging forever.
        this.settleInitialOwnership();
      });
  }

  /**
   * Settle the initial routing gate on a tab that did NOT win ownership. Runs
   * concurrently with the blocking bid above; whichever resolves first settles the
   * gate (the bid settles it on the tab that becomes owner, this settles it on
   * every other tab).
   *
   * A single owner-lock query is not enough: at cold start no tab owns yet, so the
   * query sees nothing held and the bid losers would never settle. Poll on a short
   * budget instead, settling as soon as an owner is observed — either this tab won
   * (`this.owner`) or another tab holds the owner lock. After the budget we settle
   * regardless: by then some tab has almost certainly won, and the worst case is
   * the first request takes the remote path and relies on the response/timeout.
   *
   * Falls back to settling immediately when the lock manager cannot be queried, so
   * routing is never blocked indefinitely.
   */
  private observeExistingOwner(locks: LockManagerLike): void {
    if (!locks.query) {
      // No query support: cannot observe another tab's owner without contending
      // for the lock (which would steal it). Settle so routing proceeds remotely.
      this.settleInitialOwnership();
      return;
    }

    void this.pollForOwner(locks);
  }

  private async pollForOwner(locks: LockManagerLike): Promise<void> {
    const deadline = OWNER_OBSERVE_BUDGET_MS / OWNER_OBSERVE_INTERVAL_MS;
    for (let attempt = 0; attempt < deadline; attempt += 1) {
      if (this.owner || (await this.isOwnerLockHeld(locks))) {
        this.settleInitialOwnership();
        return;
      }

      await new Promise((resolve) => {
        setTimeout(resolve, OWNER_OBSERVE_INTERVAL_MS);
      });
    }

    // Budget elapsed without observing an owner; settle anyway so routing is never
    // wedged. A tab has almost certainly won the bid by now.
    this.settleInitialOwnership();
  }

  /**
   * Whether some other tab currently holds the owner lock. Used by routing to
   * decide, when this tab's own owner failed to construct, between surfacing that
   * error (no owner anywhere) and falling back to a healthy remote owner. Returns
   * false when the lock cannot be queried, so routing posts remotely and lets the
   * request/timeout path decide rather than throwing a possibly-stale error.
   */
  private async anotherTabOwns(): Promise<boolean> {
    if (this.owner) {
      return false;
    }

    const locks = lockManager();
    return locks ? this.isOwnerLockHeld(locks) : false;
  }

  private async isOwnerLockHeld(locks: LockManagerLike): Promise<boolean> {
    if (!locks.query) {
      return false;
    }

    let snapshot: unknown;
    try {
      snapshot = await locks.query();
    } catch {
      return false;
    }

    if (typeof snapshot !== "object" || snapshot === null) {
      return false;
    }

    const held = Reflect.get(snapshot, "held");
    if (!Array.isArray(held)) {
      return false;
    }

    return held.some(
      (lock) => Reflect.get(lock, "name") === CROSS_TAB_OWNER_LOCK_NAME,
    );
  }

  /**
   * Fail every still-outstanding remote request across all local clients with a
   * retryable error. Called when this tab is promoted to owner, because the owner
   * it had posted those requests to is now gone.
   */
  private failPendingRemoteRequests(): void {
    for (const [clientId, localClient] of this.localClientsById) {
      if (localClient.pendingRemoteRequestIds.size === 0) {
        continue;
      }

      for (const id of [...localClient.pendingRemoteRequestIds]) {
        this.dispatchLocalResponse(
          clientId,
          errorResponse(
            id,
            "The database owner tab changed; retry the request.",
          ),
        );
      }
    }
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
