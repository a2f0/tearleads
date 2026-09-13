import { serializeWsServerMessage } from "@tearleads/validators/realtime";
import { reportBackgroundFailure } from "../diagnostics/reportBackgroundFailure";
import type { AuthorizeContainerAccess } from "./containerInterestAccess";
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
  private accessGeneration = 0;

  constructor(
    private readonly authorize: AuthorizeContainerAccess,
    private readonly authorizationTimeoutMs: number,
    private readonly interestStore: Pick<typeof wsInterestStore, "load">,
    private readonly persist: PersistInterest,
    private readonly router: WsEventRouter,
  ) {}

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
      const containerIds = await this.authorizedIds(ws, cached);
      if (!this.isOpen(ws)) return;
      this.router.applyAuthorizedContainerInterest(ws, {
        kind: "replace",
        containerIds,
      });
      sendSafely(
        ws,
        serializeWsServerMessage({ type: "interest_state", containerIds }),
      );
      if (cached.length > 0)
        this.persist(ws.data.userId, ws.data.sessionId, {
          kind: "replace",
          containerIds,
        });
    });
  }

  close(ws: WsConnection): void {
    this.states.delete(ws);
  }

  invalidateAccess(): void {
    this.accessGeneration += 1;
  }

  apply(ws: WsConnection, declaration: Interest): Promise<void> {
    return this.enqueue(ws, async () => {
      const ids = [...new Set(declaration.containerIds)];
      const containerIds =
        declaration.kind === "remove" ? ids : await this.authorizedIds(ws, ids);
      if (!this.isOpen(ws)) return;
      if (containerIds.length !== ids.length) {
        this.close(ws);
        this.router.close(ws);
        closeSafely(ws, 1008, "Container access denied");
        return;
      }
      const action = { ...declaration, containerIds };
      this.router.applyAuthorizedContainerInterest(ws, action);
      if (declaration.declarationId) {
        sendSafely(
          ws,
          serializeWsServerMessage({
            type: "known_containers_ack",
            declarationId: declaration.declarationId,
          }),
        );
      }
      this.persist(ws.data.userId, ws.data.sessionId, action);
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

  private async authorizedIds(
    ws: WsConnection,
    ids: string[],
  ): Promise<string[]> {
    if (ids.length === 0) return [];
    while (this.isOpen(ws)) {
      const generation = this.accessGeneration;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const authorized = await Promise.race([
          this.authorize(ws.data.userId, ids),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(
              () => reject(new Error("Container authorization timed out")),
              this.authorizationTimeoutMs,
            );
          }),
        ]);
        if (generation === this.accessGeneration) {
          const allowed = new Set(authorized);
          return ids.filter((id) => allowed.has(id));
        }
      } finally {
        clearTimeout(timer);
      }
    }
    return [];
  }
}
