import { serializeWsServerMessage } from "@tearleads/validators/realtime";
import { reportBackgroundFailure } from "../diagnostics/reportBackgroundFailure";
import {
  beforeDeadline,
  ContainerInterestQueries,
} from "./containerInterestQueries";
import { ContainerInterestRestoration } from "./containerInterestRestoration";
import type { ProofAgePolicy } from "./containerInterestRevalidation";
import type {
  AuthorizeContainerAccess,
  VerifiedContainerInterest,
} from "./containerInterestTypes";
import { closeSafely, sendSafely, type WsConnection } from "./wsConnection";
import type { wsInterestStore } from "./wsInterestStore";
import type { AppliedInterest, WsEventRouter } from "./wsRouting";

type Interest = Exclude<AppliedInterest, null>;
const MAX_PENDING_DECLARATIONS = 32;
const MAX_PENDING_CONTAINER_IDS = 20_000;
type PersistInterest = (
  userId: string,
  sessionId: string,
  action: Interest,
) => void;

interface SocketState {
  pending: Promise<void>;
  declarations: number;
  containerIds: number;
  /** A reconnect asked for a full resync; held until a verification lands. */
  resyncAll: boolean;
  /** When every installed proof was last confirmed by a full verification. */
  verifiedAt: number;
  /** Bumped by an eviction so a pass that started earlier discards its result. */
  epoch: number;
  /** The revalidation pass queued or in flight, if any; passes never stack. */
  revalidation: Promise<void> | null;
  /** Cancels the timer that evicts at `verifiedAt + maxProofAgeMs`. */
  deadline: (() => void) | null;
}

export class ContainerInterestAuthorizer {
  private readonly states = new WeakMap<WsConnection, SocketState>();
  private readonly queries: ContainerInterestQueries;
  private readonly restoration = new ContainerInterestRestoration();

  constructor(
    authorize: AuthorizeContainerAccess,
    private readonly authorizationTimeoutMs: number,
    private readonly interestStore: Pick<typeof wsInterestStore, "load">,
    private readonly persist: PersistInterest,
    private readonly router: WsEventRouter,
    private readonly proofAge: ProofAgePolicy,
  ) {
    this.queries = new ContainerInterestQueries(
      authorize,
      authorizationTimeoutMs,
    );
  }

  open(ws: WsConnection): Promise<void> {
    this.restoration.clear(ws);
    this.states.set(ws, {
      pending: Promise.resolve(),
      declarations: 0,
      containerIds: 0,
      resyncAll: false,
      verifiedAt: this.proofAge.now(),
      epoch: 0,
      revalidation: null,
      deadline: null,
    });
    this.armDeadline(ws, this.states.get(ws));
    return this.enqueue(ws, async () => {
      try {
        const cached = await beforeDeadline(
          this.interestStore.load(ws.data.userId, ws.data.sessionId),
          Date.now() + this.authorizationTimeoutMs,
        );
        await this.queries.run(
          ws,
          cached,
          () => this.isOpen(ws),
          (proofs) => this.installRestored(ws, cached, proofs),
        );
      } catch (error) {
        console.error("Failed to hydrate websocket interest:", error);
        reportBackgroundFailure(error);
        if (!this.isOpen(ws)) return;
        // Reconnect cache is only an optimization. An empty baseline lets the
        // client's authoritative declaration recover without trusting the cache.
        this.router.applyAuthorizedContainerInterest(
          ws,
          { kind: "replace", containerIds: [] },
          [],
        );
        sendSafely(
          ws,
          serializeWsServerMessage({
            type: "interest_state",
            containerIds: [],
          }),
        );
      }
    });
  }

  private installRestored(
    ws: WsConnection,
    cached: string[],
    proofs: VerifiedContainerInterest[],
  ): void {
    const state = this.states.get(ws);
    if (!state) return;
    this.confirm(ws, state);
    this.restoration.put(
      ws,
      cached,
      proofs,
      Date.now() + this.authorizationTimeoutMs,
    );
    const containerIds = proofs.map((proof) => proof.containerId);
    this.router.applyAuthorizedContainerInterest(
      ws,
      { kind: "replace", containerIds },
      proofs,
    );
    sendSafely(
      ws,
      serializeWsServerMessage({ type: "interest_state", containerIds }),
    );
    const accepted = new Set(containerIds);
    const refused = cached.filter((id) => !accepted.has(id));
    if (refused.length > 0)
      this.persist(ws.data.userId, ws.data.sessionId, {
        kind: "remove",
        containerIds: refused,
      });
  }

  close(ws: WsConnection): void {
    this.restoration.clear(ws);
    this.states.get(ws)?.deadline?.();
    this.states.delete(ws);
  }

  /** A completed verification re-dates the proofs and re-arms their deadline. */
  private confirm(ws: WsConnection, state: SocketState): void {
    state.verifiedAt = this.proofAge.now();
    this.armDeadline(ws, state);
  }

  /**
   * The proof-age bound is a wall-clock deadline, not a tick: the timer fires
   * at exactly `verifiedAt + maxProofAgeMs` and evicts whatever no completed
   * verification has re-dated by then, independent of the jittered
   * revalidation ticks and of the declaration queue.
   */
  private armDeadline(ws: WsConnection, state: SocketState | undefined): void {
    if (!state) return;
    state.deadline?.();
    state.deadline = null;
    const { maxProofAgeMs, now, schedule } = this.proofAge;
    if (maxProofAgeMs <= 0) return;
    state.deadline = schedule(
      () => {
        state.deadline = null;
        if (this.states.get(ws) !== state) return;
        this.evictUnconfirmed(ws, state, this.router.interestOf(ws));
        // Fired ahead of the clock or found nothing due: stay armed.
        if (!state.deadline) this.armDeadline(ws, state);
      },
      Math.max(0, state.verifiedAt + maxProofAgeMs - now()),
    );
  }

  invalidateAccess(containerId: string): void {
    this.restoration.invalidate(containerId);
    this.queries.invalidate(containerId);
  }

  /**
   * Re-verify every subscription this socket currently holds against the
   * signed access workflow, evicting (with `resync_required`) any the workflow
   * no longer grants. Bounds the window a lost `access_changed` leaves a revoked
   * subscription live. `resyncAll` additionally tells the client to resync every
   * held container — used when this process may have missed hints wholesale
   * (a pub/sub reconnect), not only access changes. Runs on the socket's own
   * queue so it never interleaves with a declaration; a verification failure
   * keeps the socket (the next pass retries) instead of closing it, and a
   * pending `resyncAll` survives the failure until a later pass succeeds.
   * Proof age is enforced by wall clock on every call, before anything is
   * queued: proofs no completed verification has confirmed within
   * `maxProofAgeMs` are evicted wholesale (`evictUnconfirmed`) whether the
   * pass that would confirm them is queued behind slow declarations, in
   * flight, or cannot be enqueued at all. Only a completed verification
   * re-dates the proofs, so a client cannot shelter a revoked subscription
   * behind a busy queue. Passes never stack: a tick that finds one queued or
   * in flight joins it — except a reconnect, whose in-flight pass may carry
   * proofs authorized before the outage; that pass is discarded (its epoch
   * is left behind) and a fresh verification carries the resync request.
   */
  revalidate(
    ws: WsConnection,
    options: { readonly resyncAll?: boolean } = {},
  ): Promise<void> {
    const state = this.states.get(ws);
    if (!state) return Promise.resolve();
    if (options.resyncAll) {
      state.resyncAll = true;
      if (state.revalidation) {
        state.epoch++;
        state.revalidation = null;
      }
    }
    this.evictUnconfirmed(ws, state, this.router.interestOf(ws));
    if (state.revalidation) return state.revalidation;
    if (state.declarations >= MAX_PENDING_DECLARATIONS)
      return Promise.resolve();
    const pass: Promise<void> = this.enqueue(ws, () =>
      this.runRevalidation(ws, state),
    ).finally(() => {
      if (state.revalidation === pass) state.revalidation = null;
    });
    state.revalidation = pass;
    return pass;
  }

  private async runRevalidation(
    ws: WsConnection,
    state: SocketState,
  ): Promise<void> {
    const ids = this.router.interestOf(ws);
    if (ids.length === 0) {
      // Nothing held means no container hint could have been missed, but a
      // share granted during the outage reached no socket either; this is the
      // frame on which the client re-lists its roots.
      if (state.resyncAll)
        sendSafely(
          ws,
          serializeWsServerMessage({
            type: "shared_with_you",
            userId: ws.data.userId,
          }),
        );
      state.resyncAll = false;
      this.confirm(ws, state);
      return;
    }
    const epoch = state.epoch;
    try {
      await this.queries.run(
        ws,
        ids,
        () => this.isOpen(ws),
        (proofs) => {
          // An eviction while this pass ran already dropped these ids and
          // re-dated the socket; installing them now would resurrect them.
          if (state.epoch !== epoch) return;
          this.installRevalidated(ws, ids, proofs);
        },
      );
    } catch (error) {
      console.error("Failed to revalidate websocket interest:", error);
      reportBackgroundFailure(error);
      this.evictUnconfirmed(ws, state, ids);
    }
  }

  /**
   * Fail closed. Proofs no verification has confirmed within the max age may
   * hide a lost revocation, so drop them all with one `resync_required`; the
   * client redeclares through fresh authorization.
   */
  private evictUnconfirmed(
    ws: WsConnection,
    state: SocketState,
    ids: string[],
  ): void {
    const { maxProofAgeMs, now } = this.proofAge;
    if (maxProofAgeMs <= 0 || now() - state.verifiedAt < maxProofAgeMs) return;
    if (!this.isOpen(ws)) return;
    if (ids.length === 0) {
      this.confirm(ws, state);
      return;
    }
    state.epoch++;
    this.restoration.clear(ws);
    this.router.applyAuthorizedContainerInterest(
      ws,
      { kind: "replace", containerIds: [] },
      [],
    );
    sendSafely(
      ws,
      serializeWsServerMessage({ type: "resync_required", containerIds: ids }),
    );
    this.persist(ws.data.userId, ws.data.sessionId, {
      kind: "remove",
      containerIds: ids,
    });
    state.resyncAll = false;
    this.confirm(ws, state);
  }

  revalidateAll(options: { readonly resyncAll?: boolean } = {}): Promise<void> {
    // Queries already running answer from access read before the outage; the
    // fresh passes below must await them but never accept their results.
    if (options.resyncAll) this.queries.markAllStale();
    return Promise.all(
      this.router.openSockets().map((ws) => this.revalidate(ws, options)),
    ).then(() => undefined);
  }

  private installRevalidated(
    ws: WsConnection,
    ids: string[],
    proofs: VerifiedContainerInterest[],
  ): void {
    const state = this.states.get(ws);
    if (!state) return;
    this.confirm(ws, state);
    const accepted = new Set(proofs.map((proof) => proof.containerId));
    const refused = ids.filter((id) => !accepted.has(id));
    // The reconnect handoff predates this verification; a matching declaration
    // inside its window must reauthorize, not reinstall an evicted proof.
    this.restoration.clear(ws);
    // Re-adding the held set refreshes each surviving proof's dependency path
    // (a move re-parents it) and drops the refused ids in one step.
    this.router.applyAuthorizedContainerInterest(
      ws,
      { kind: "add", containerIds: ids },
      proofs,
    );
    const resync = state.resyncAll ? ids : refused;
    state.resyncAll = false;
    if (resync.length > 0)
      sendSafely(
        ws,
        serializeWsServerMessage({
          type: "resync_required",
          containerIds: resync,
        }),
      );
    if (refused.length > 0)
      this.persist(ws.data.userId, ws.data.sessionId, {
        kind: "remove",
        containerIds: refused,
      });
  }

  apply(ws: WsConnection, declaration: Interest): Promise<void> {
    return this.enqueue(
      ws,
      async () => {
        const ids = [...new Set(declaration.containerIds)];
        const install = (proofs: VerifiedContainerInterest[]): void => {
          const containerIds =
            declaration.kind === "remove"
              ? ids
              : proofs.map((proof) => proof.containerId);
          const action = { ...declaration, containerIds };
          this.router.applyAuthorizedContainerInterest(ws, declaration, proofs);
          // A replace leaves only proofs verified just now installed.
          const state = this.states.get(ws);
          if (state && declaration.kind === "replace") this.confirm(ws, state);
          // An acknowledgement means processing is complete, including denials.
          // It lets reconnect reconciliation remove stale local IDs over HTTP.
          if (declaration.declarationId)
            sendSafely(
              ws,
              serializeWsServerMessage({
                type: "known_containers_ack",
                containerIds,
                declarationId: declaration.declarationId,
              }),
            );
          if (declaration.kind === "add") {
            const accepted = new Set(containerIds);
            const refused = ids.filter((id) => !accepted.has(id));
            if (refused.length > 0)
              this.persist(ws.data.userId, ws.data.sessionId, {
                kind: "remove",
                containerIds: refused,
              });
          }
          this.persist(ws.data.userId, ws.data.sessionId, action);
        };
        const restored = this.restoration.take(
          ws,
          declaration.kind === "replace" ? ids : null,
        );
        if (declaration.kind === "remove") install([]);
        else if (restored) install(restored);
        else await this.queries.run(ws, ids, () => this.isOpen(ws), install);
      },
      declaration.containerIds.length,
    );
  }

  private isOpen(ws: WsConnection): boolean {
    return this.states.has(ws) && this.router.isOpen(ws);
  }

  private enqueue(
    ws: WsConnection,
    operation: () => Promise<void>,
    containerIds = 0,
  ): Promise<void> {
    const state = this.states.get(ws);
    if (!state) return Promise.resolve();
    if (
      state.declarations >= MAX_PENDING_DECLARATIONS ||
      state.containerIds + containerIds > MAX_PENDING_CONTAINER_IDS
    ) {
      this.close(ws);
      this.router.close(ws);
      closeSafely(ws, 1013, "Too many pending container declarations");
      return Promise.resolve();
    }
    state.declarations++;
    state.containerIds += containerIds;
    state.pending = state.pending
      .then(async () => {
        if (this.states.get(ws) !== state || !this.router.isOpen(ws)) return;
        await operation();
      })
      .catch((error: unknown) => {
        reportBackgroundFailure(error);
        if (this.states.get(ws) !== state) return;
        this.close(ws);
        this.router.close(ws);
        closeSafely(ws, 1011, "Container authorization unavailable");
      })
      .finally(() => {
        state.declarations--;
        state.containerIds -= containerIds;
      });
    return state.pending;
  }
}
