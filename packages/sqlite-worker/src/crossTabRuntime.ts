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
  requestMethod,
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
  /**
   * Abrupt teardown for a runtime that could not close gracefully — its worker
   * went silent, so the `close` round-trip never came back to stop the owner via
   * {@link CrossTabOwner.stop}. Unregisters this client and, when safe, force-stops
   * the owner so the next boot re-contends and builds a fresh owner instead of
   * routing into the dead one. See {@link CrossTabCoordinator.forceStopOwnerFor}.
   */
  forceStopOwner(): void;
}

interface LocalClient {
  closing: boolean;
  readonly dispatch: (response: unknown) => void;
  readonly liveness: ClientLivenessLock;
  readonly timeoutsByRequestId: Map<number, ReturnType<typeof setTimeout>>;
  // Request ids this client posted over BroadcastChannel that have not yet been
  // answered by the owner tab. Used to fail them fast (rather than wait out the
  // timeout) when this tab is promoted to owner after the previous owner died.
  readonly pendingRemoteRequestIds: Set<number>;
}

function isTeardownRequest(request: unknown): boolean {
  const method = requestMethod(request);
  return method === "close" || method === "delete";
}

class CrossTabCoordinator {
  private readonly channel = new BroadcastChannel(CROSS_TAB_CHANNEL_NAME);
  private hasCreatedClient = false;
  private readonly localClientsById = new Map<string, LocalClient>();
  private owner: CrossTabOwner | null = null;
  // Set if this tab won ownership but its owner worker failed to construct.
  // Cleared if a later bid succeeds in installing an owner.
  private ownerError: Error | null = null;
  // Resolves when ownership is settled for the current owner generation (this tab
  // won and installed/failed to construct an owner, or it observed another tab
  // already owns), so routing never posts remotely while no owner exists.
  private ownershipBidActive = false;
  private ownershipGeneration = 0;
  private ownershipSettled: Promise<void> = Promise.resolve();
  private retryOwnershipAfterBid = false;
  private settleOwnershipGate: () => void = () => {};

  constructor(
    private readonly workerUrl: string | URL,
    private readonly workerConstructor: ModuleWorkerConstructor,
  ) {
    this.resetOwnershipGate();
    this.channel.addEventListener("message", (event) => {
      this.handleChannelMessage(event);
    });
    // Start the first ownership bid; later clients can restart it after teardown.
    this.contendForOwnership();
  }

  createWorker(): CrossTabDatabaseWorker {
    const clientId = crypto.randomUUID();
    const events = new EventTarget();
    if (this.ownerError && this.hasCreatedClient) {
      this.ownerError = null;
      this.retryOwnershipAfterBid = this.ownershipBidActive;
      this.resetOwnershipGate();
    }
    this.localClientsById.set(clientId, {
      closing: false,
      dispatch: (response) => {
        events.dispatchEvent(new MessageEvent("message", { data: response }));
      },
      liveness: createClientLivenessLock(clientId),
      timeoutsByRequestId: new Map(),
      pendingRemoteRequestIds: new Set(),
    });
    this.hasCreatedClient = true;
    this.contendForOwnership();

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
      forceStopOwner: () => {
        this.forceStopOwnerFor(clientId);
      },
    };
  }

  /**
   * Tear down a possibly-wedged owner on abrupt runtime teardown.
   *
   * `this.owner` is normally cleared only when the dedicated worker answers a
   * `close`/`delete` (→ {@link CrossTabOwner.stop} via `handleWorkerResponse`). A
   * worker hung inside OPFS never answers, so that path never runs and the plain
   * client `close()` (just {@link unregisterLocalClient}) leaves `this.owner`
   * pinned to the dead worker — every later boot then routes its `init` straight
   * into it over the untimed local path and hangs. Because the coordinator is a
   * per-URL module singleton, that pins EVERY database, not just the one that
   * wedged.
   *
   * So on abrupt teardown, after unregistering the client, stop the owner —
   * `stop()` terminates the worker, releases the owner lock, and (via the release
   * callback) nulls `this.owner` + resets the gate, so the next `createWorker()`
   * re-contends and constructs a fresh owner. Gated to stay multi-tab-safe: only
   * when this tab has no other open local client AND the owner serves no other
   * (remote) client, so it can never strand a sibling tab still routing here.
   *
   * The remote-client half of the gate reads the owner's `activeClientIds`, which
   * is coarse: a wedged local client that was force-torn-down without a close
   * response leaves a *stale* id there (only a close-response or the liveness sweep
   * removes it). So if TWO local clients on one coordinator were wedged and torn
   * down in the same tick, the second would see the first's stale id and decline to
   * stop — leaving the wedge unhealed. That cannot happen here: the app drives a
   * single runtime at a time (`useManagedSQLiteRuntime` holds one runtimeRef and
   * defers each spawn on the prior release), so a coordinator never has two live
   * local clients. The gate therefore errs, at worst, toward NOT stopping — which
   * only ever risks a missed heal, never wrongly stranding a real remote tab.
   */
  private forceStopOwnerFor(clientId: string): void {
    this.unregisterLocalClient(clientId);
    if (this.hasOpenLocalClients()) {
      return;
    }

    const owner = this.owner;
    if (owner && !owner.hasActiveClientsExcept(clientId)) {
      owner.stop();
    }
  }

  private route(clientId: string, request: unknown): void {
    void this.routeAsync(clientId, request);
  }

  private async routeAsync(clientId: string, request: unknown): Promise<void> {
    const id = requestId(request);
    try {
      const localClient = this.localClientsById.get(clientId);
      if (localClient && isTeardownRequest(request)) {
        localClient.closing = true;
      }

      const hasClientLock = await this.waitForLocalClientLock(clientId);
      if (!this.localClientsById.has(clientId)) {
        return;
      }

      // Wait for ownership so this request is not posted into the void.
      if (!this.owner && !this.ownerError) {
        this.contendForOwnership();
      }
      await this.ownershipSettled;
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
   * Hold one blocking owner-lock bid. The current holder owns until it releases;
   * queued bidders are promoted when the holder disappears.
   */
  private contendForOwnership(): void {
    if (this.owner || this.ownershipBidActive || this.ownerError) {
      return;
    }

    const locks = lockManager();
    if (!locks) {
      // No Web Locks: unblock routing and rely on the request timeout.
      this.settleOwnership();
      return;
    }

    this.ownershipBidActive = true;
    const generation = this.ownershipGeneration;
    // A non-owner tab's blocking bid stays queued (never enters its callback)
    // until the current owner dies, so it cannot settle the routing gate on its
    // own. Settle it from here as soon as ownership is known either way.
    this.observeExistingOwner(locks, generation);

    let releasedNormally = false;

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
                this.resetOwnershipGate();
              }
              releaseOwner?.();
            },
          );
          this.owner = owner;
          this.ownerError = null;
          // Requests posted to the previous owner are orphaned; fail them with a
          // retryable error instead of waiting out the timeout.
          this.failPendingRemoteRequests();
          this.settleOwnership(generation);
          await ownerReleased;
          releasedNormally = true;
        } catch (error) {
          // This tab won ownership but could not stand up the owner worker. Record
          // the failure so its own clients see the error instead of hanging, then
          // rethrow to release the lock so another tab can try to own.
          this.owner = null;
          this.ownerError =
            error instanceof Error ? error : new Error(String(error));
          this.failPendingRemoteRequests();
          this.settleOwnership(generation);
          throw error;
        }
      })
      .catch(() => {
        // The bid itself failed (e.g. the lock manager rejected). Unblock routing
        // so requests fall back to the remote path instead of hanging forever.
        this.settleOwnership(generation);
      })
      .finally(() => {
        this.ownershipBidActive = false;
        const shouldRetryOwnership =
          releasedNormally || this.retryOwnershipAfterBid;
        this.retryOwnershipAfterBid = false;
        if (!shouldRetryOwnership) {
          return;
        }

        queueMicrotask(() => {
          if (this.hasOpenLocalClients() && !this.owner && !this.ownerError) {
            this.contendForOwnership();
          }
        });
      });
  }

  private hasOpenLocalClients(): boolean {
    for (const localClient of this.localClientsById.values()) {
      if (!localClient.closing) {
        return true;
      }
    }

    return false;
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
  private observeExistingOwner(
    locks: LockManagerLike,
    generation: number,
  ): void {
    if (!locks.query) {
      // No query support: cannot observe another tab's owner without contending
      // for the lock (which would steal it). Settle so routing proceeds remotely.
      this.settleOwnership(generation);
      return;
    }

    void this.pollForOwner(locks, generation);
  }

  private async pollForOwner(
    locks: LockManagerLike,
    generation: number,
  ): Promise<void> {
    const deadline = OWNER_OBSERVE_BUDGET_MS / OWNER_OBSERVE_INTERVAL_MS;
    for (let attempt = 0; attempt < deadline; attempt += 1) {
      if (this.owner || (await this.isOwnerLockHeld(locks))) {
        this.settleOwnership(generation);
        return;
      }

      await new Promise((resolve) => {
        setTimeout(resolve, OWNER_OBSERVE_INTERVAL_MS);
      });
    }

    // Budget elapsed without observing an owner; settle anyway so routing is never
    // wedged. A tab has almost certainly won the bid by now.
    this.settleOwnership(generation);
  }

  private resetOwnershipGate(): void {
    this.ownershipGeneration += 1;
    this.ownershipSettled = new Promise((resolve) => {
      this.settleOwnershipGate = resolve;
    });
  }

  private settleOwnership(generation = this.ownershipGeneration): void {
    if (generation !== this.ownershipGeneration) {
      return;
    }

    this.settleOwnershipGate();
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
