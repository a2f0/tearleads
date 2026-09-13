import { serializeWsServerMessage } from "@tearleads/validators/realtime";
import { reportBackgroundFailure } from "../diagnostics/reportBackgroundFailure";
import { ContainerInterestQueries } from "./containerInterestQueries";
import type {
  AuthorizeContainerAccess,
  VerifiedContainerInterest,
} from "./containerInterestTypes";
import { closeSafely, sendSafely, type WsConnection } from "./wsConnection";
import type { wsInterestStore } from "./wsInterestStore";
import type { AppliedInterest, WsEventRouter } from "./wsRouting";

type Interest = Exclude<AppliedInterest, null>;
type PersistInterest = (
  userId: string,
  sessionId: string,
  action: Interest,
) => void;

interface SocketState {
  pending: Promise<void>;
}

export class ContainerInterestAuthorizer {
  private readonly states = new WeakMap<WsConnection, SocketState>();
  private readonly queries: ContainerInterestQueries;

  constructor(
    authorize: AuthorizeContainerAccess,
    authorizationTimeoutMs: number,
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
    this.states.set(ws, { pending: Promise.resolve() });
    return this.enqueue(ws, async () => {
      const cached = await this.interestStore
        .load(ws.data.userId, ws.data.sessionId)
        .catch((error: unknown) => {
          console.error("Failed to hydrate websocket interest:", error);
          reportBackgroundFailure(error);
          return [];
        });
      await this.queries.run(
        ws,
        cached,
        () => this.isOpen(ws),
        (proofs) => {
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
        },
      );
    });
  }

  close(ws: WsConnection): void {
    this.states.delete(ws);
  }

  invalidateAccess(containerId: string): void {
    this.queries.invalidate(containerId);
  }

  apply(ws: WsConnection, declaration: Interest): Promise<void> {
    return this.enqueue(ws, async () => {
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
      if (declaration.kind === "remove") install([]);
      else await this.queries.run(ws, ids, () => this.isOpen(ws), install);
    });
  }

  private isOpen(ws: WsConnection): boolean {
    return this.states.has(ws) && this.router.isOpen(ws);
  }

  private enqueue(
    ws: WsConnection,
    operation: () => Promise<void>,
  ): Promise<void> {
    const state = this.states.get(ws);
    if (!state) return Promise.resolve();
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
      });
    return state.pending;
  }
}
