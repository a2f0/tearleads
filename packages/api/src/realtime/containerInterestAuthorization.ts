import { serializeWsServerMessage } from "@tearleads/validators/realtime";
import { reportBackgroundFailure } from "../diagnostics/reportBackgroundFailure";
import {
  beforeDeadline,
  ContainerInterestQueries,
} from "./containerInterestQueries";
import { ContainerInterestRestoration } from "./containerInterestRestoration";
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
    });
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
    this.states.delete(ws);
  }

  invalidateAccess(containerId: string): void {
    this.restoration.invalidate(containerId);
    this.queries.invalidate(containerId);
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
