import {
  MAX_WS_CLIENT_MESSAGE_BYTES,
  serializeWsServerMessage,
} from "@tearleads/validators/realtime";
import type { ServerWebSocket } from "bun";
import {
  addListener,
  addSubscriberReconnectListener,
} from "../adapters/redisPubSub";
import { reportBackgroundFailure } from "../diagnostics/reportBackgroundFailure";
import { authorizeContainerAccessWithWorkflow } from "./containerInterestAccess";
import { ContainerInterestAuthorizer } from "./containerInterestAuthorization";
import {
  ContainerInterestRevalidationSchedule,
  type RevalidationScheduleOptions,
  resolveProofAgePolicy,
} from "./containerInterestRevalidation";
import {
  type AuthorizeContainerAccess,
  principalInterestKey,
} from "./containerInterestTypes";
import { parsePublishedRealtimeEvent } from "./publishedRealtimeEvents";
import { sendSafely } from "./wsConnection";
import type { WebSocketTicketIdentity } from "./wsIdentity";
import { wsInterestStore } from "./wsInterestStore";
import {
  type OrganizationInterestDeclaration,
  type OrganizationReadModelAudience,
  readOrganizationReadModelAudienceMessage,
} from "./wsOrganizationRouting";
import { type AppliedInterest, WsEventRouter } from "./wsRouting";

type InterestStore = Pick<typeof wsInterestStore, "apply" | "load">;
type Subscribe = typeof addListener;
type SubscribeReconnect = typeof addSubscriberReconnectListener;
type AuthorizeOrganizationAccess = (
  userId: string,
  organizationId: string,
) => Promise<boolean>;
const CONTAINER_AUTHORIZATION_TIMEOUT_MS = 10_000;
const ORGANIZATION_AUTHORIZATION_TIMEOUT_MS = 10_000;

interface RealtimeGatewayDeps {
  readonly authorizeContainerAccess?: AuthorizeContainerAccess;
  readonly containerAuthorizationTimeoutMs?: number;
  readonly authorizeOrganizationAccess?: AuthorizeOrganizationAccess;
  readonly interestStore?: InterestStore;
  readonly organizationAuthorizationTimeoutMs?: number;
  readonly revalidation?: RevalidationScheduleOptions;
  readonly router?: WsEventRouter;
  readonly subscribe?: Subscribe;
  readonly subscribeReconnect?: SubscribeReconnect;
}

async function authorizeOrganizationAccessWithWorkflow(
  userId: string,
  organizationId: string,
): Promise<boolean> {
  // Keep the database/runtime dependency lazy: constructing the realtime
  // gateway has no persistence or object-store side effects. The workflow is
  // the same authoritative access check used by the HTTP read model.
  const [runtimeModule, accessModule, errorModule] = await Promise.all([
    import("../services/runtime"),
    import("../workflows/organizations/access"),
    import("../workflows/organizations/errors"),
  ]);
  try {
    await runtimeModule.getDefaultApiServiceRuntime().db.transaction((tx) =>
      accessModule.requireDirectOrganizationAccess({
        executor: tx,
        organizationId,
        userId,
      }),
    );
    return true;
  } catch (error) {
    if (
      error instanceof errorModule.OrganizationManagerError &&
      (error.status === 403 || error.status === 404)
    ) {
      return false;
    }
    throw error;
  }
}

function messageToString(message: string | Buffer): string {
  return typeof message === "string" ? message : message.toString("utf8");
}

function createOrderedInterestPersister(interestStore: InterestStore) {
  const interestWriteChains = new Map<string, Promise<void>>();
  return (
    userId: string,
    sessionId: string,
    applied: AppliedInterest,
  ): void => {
    const sessionKey = `${userId}:${sessionId}`;
    const chain = (interestWriteChains.get(sessionKey) ?? Promise.resolve())
      .then(() => interestStore.apply(userId, sessionId, applied))
      .catch((error: unknown) => {
        console.error("Failed to persist websocket interest:", error);
        reportBackgroundFailure(error, "websocket.persist");
      });
    interestWriteChains.set(sessionKey, chain);
    void chain.finally(() => {
      if (interestWriteChains.get(sessionKey) === chain) {
        interestWriteChains.delete(sessionKey);
      }
    });
  };
}

type OrganizationSocket = ServerWebSocket<WebSocketTicketIdentity>;

interface OrganizationAuthorizationState {
  readonly organizationId: string;
  authorization: Promise<boolean> | null;
  authorized: boolean;
}

type PendingOrganizationAuthorization = [
  OrganizationSocket,
  OrganizationAuthorizationState,
];

class OrganizationInterestAuthorizer {
  private readonly restorationAuthorizations = new Map<
    string,
    Promise<boolean>
  >();
  private readonly states = new Map<
    OrganizationSocket,
    OrganizationAuthorizationState
  >();

  constructor(
    private readonly authorizeOrganizationAccess: AuthorizeOrganizationAccess,
    private readonly authorizationTimeoutMs: number,
    private readonly router: WsEventRouter,
  ) {}

  async apply(
    ws: OrganizationSocket,
    declaration: OrganizationInterestDeclaration,
  ): Promise<void> {
    this.router.applyAuthorizedOrganizationInterest(ws, null);
    if (declaration.organizationId === null) {
      this.states.delete(ws);
      this.sendAcknowledgement(ws, declaration, true);
      return;
    }

    const state: OrganizationAuthorizationState = {
      authorization: null,
      authorized: false,
      organizationId: declaration.organizationId,
    };
    this.states.set(ws, state);
    const authorization = this.authorize(ws.data.userId, state.organizationId);
    state.authorization = authorization;
    const authorized = await authorization;
    if (state.authorization === authorization) {
      state.authorization = null;
    }
    if (this.states.get(ws) !== state) {
      return;
    }
    if (authorized && !this.applyAuthorizedState(ws, state)) {
      return;
    }
    this.sendAcknowledgement(ws, declaration, authorized);
  }

  close(ws: OrganizationSocket): void {
    this.states.delete(ws);
  }

  prepareServerEvent(rawMessage: string): Promise<void> | null {
    const audience = readOrganizationReadModelAudienceMessage(rawMessage);
    if (!audience) {
      return null;
    }
    const pendingByUserId = this.collectPending(audience);
    if (pendingByUserId.size === 0) {
      return null;
    }
    return Promise.all(
      [...pendingByUserId].map(([userId, pending]) =>
        this.restorePending(userId, audience.organizationId, pending),
      ),
    ).then(() => undefined);
  }

  private applyAuthorizedState(
    ws: OrganizationSocket,
    state: OrganizationAuthorizationState,
  ): boolean {
    if (this.states.get(ws) !== state) {
      return false;
    }
    state.authorized = true;
    this.router.applyAuthorizedOrganizationInterest(ws, state.organizationId);
    return true;
  }

  private sendAcknowledgement(
    ws: OrganizationSocket,
    declaration: OrganizationInterestDeclaration,
    authorized: boolean,
  ): void {
    sendSafely(
      ws,
      serializeWsServerMessage({
        type: "known_organizations_ack",
        declarationId: declaration.declarationId,
        organizationId: declaration.organizationId,
        authorized,
      }),
    );
  }

  private authorize(userId: string, organizationId: string): Promise<boolean> {
    const authorization = this.authorizeOrganizationAccess(
      userId,
      organizationId,
    ).catch((error) => {
      console.error(
        "Failed to authorize websocket organization interest:",
        error,
      );
      reportBackgroundFailure(error, "websocket.authorize");
      return false;
    });
    return new Promise((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const finish = (authorized: boolean) => {
        if (settled) {
          return;
        }
        settled = true;
        if (timer) {
          clearTimeout(timer);
        }
        resolve(authorized);
      };
      timer = setTimeout(() => finish(false), this.authorizationTimeoutMs);
      timer.unref();
      void authorization.then(finish);
    });
  }

  private collectPending(
    audience: OrganizationReadModelAudience,
  ): Map<string, PendingOrganizationAuthorization[]> {
    const pendingByUserId = new Map<
      string,
      PendingOrganizationAuthorization[]
    >();
    for (const [ws, state] of this.states) {
      if (
        !state.authorized &&
        state.organizationId === audience.organizationId &&
        audience.recipientUserIds.has(ws.data.userId)
      ) {
        const pending = pendingByUserId.get(ws.data.userId) ?? [];
        pending.push([ws, state]);
        pendingByUserId.set(ws.data.userId, pending);
      }
    }
    return pendingByUserId;
  }

  private restorationAuthorization(
    userId: string,
    organizationId: string,
  ): Promise<boolean> {
    const key = `${userId}:${organizationId}`;
    const active = this.restorationAuthorizations.get(key);
    if (active) {
      return active;
    }
    const next = this.authorize(userId, organizationId).finally(() => {
      if (this.restorationAuthorizations.get(key) === next) {
        this.restorationAuthorizations.delete(key);
      }
    });
    this.restorationAuthorizations.set(key, next);
    return next;
  }

  private async restorePending(
    userId: string,
    organizationId: string,
    pending: PendingOrganizationAuthorization[],
  ): Promise<void> {
    await Promise.all(pending.map(([, state]) => state.authorization ?? false));
    const current = pending.filter(
      ([ws, state]) => this.states.get(ws) === state && !state.authorized,
    );
    if (
      current.length === 0 ||
      !(await this.restorationAuthorization(userId, organizationId))
    ) {
      return;
    }
    for (const [ws, state] of current) {
      this.applyAuthorizedState(ws, state);
    }
  }
}

function createWebsocketHandler(input: {
  readonly containerInterest: ContainerInterestAuthorizer;
  readonly organizationInterest: OrganizationInterestAuthorizer;
  readonly revalidation: ContainerInterestRevalidationSchedule;
  readonly router: WsEventRouter;
}) {
  return {
    maxPayloadLength: MAX_WS_CLIENT_MESSAGE_BYTES,
    async open(ws: ServerWebSocket<WebSocketTicketIdentity>) {
      input.router.open(ws);
      input.revalidation.open(ws);
      await input.containerInterest.open(ws);
    },
    close(ws: ServerWebSocket<WebSocketTicketIdentity>) {
      input.revalidation.close(ws);
      input.containerInterest.close(ws);
      input.organizationInterest.close(ws);
      input.router.close(ws);
    },
    async message(
      ws: ServerWebSocket<WebSocketTicketIdentity>,
      message: string | Buffer,
    ) {
      const action = input.router.handleClientMessage(
        ws,
        messageToString(message),
      );
      if (!action) {
        return;
      }
      if (action.kind === "organization-replace") {
        await input.organizationInterest.apply(ws, action);
        return;
      }
      await input.containerInterest.apply(ws, action);
    },
  };
}

/**
 * The realtime sync gateway owns the in-memory socket/interest router, the
 * per-session interest write serialization, and the Redis pub/sub subscription.
 * Constructing it has no side effects; the subscription opens only when
 * `start()` is called, so importing this module never connects to Redis. The
 * gateway is constructed and started once at the composition root (index.ts),
 * the same place the HTTP app is assembled — there is no second, import-time
 * composition root. Deps default to production singletons and are injectable for
 * tests.
 */
export function createRealtimeGateway(deps: RealtimeGatewayDeps = {}) {
  const router = deps.router ?? new WsEventRouter();
  const interestStore = deps.interestStore ?? wsInterestStore;
  const subscribe = deps.subscribe ?? addListener;
  const subscribeReconnect =
    deps.subscribeReconnect ?? addSubscriberReconnectListener;
  const authorizeOrganizationAccess =
    deps.authorizeOrganizationAccess ?? authorizeOrganizationAccessWithWorkflow;
  const persistInterest = createOrderedInterestPersister(interestStore);
  const organizationInterest = new OrganizationInterestAuthorizer(
    authorizeOrganizationAccess,
    deps.organizationAuthorizationTimeoutMs ??
      ORGANIZATION_AUTHORIZATION_TIMEOUT_MS,
    router,
  );
  const containerInterest = new ContainerInterestAuthorizer(
    deps.authorizeContainerAccess ?? authorizeContainerAccessWithWorkflow,
    deps.containerAuthorizationTimeoutMs ?? CONTAINER_AUTHORIZATION_TIMEOUT_MS,
    interestStore,
    persistInterest,
    router,
    resolveProofAgePolicy(deps.revalidation),
  );
  const revalidation = new ContainerInterestRevalidationSchedule(
    (ws) => containerInterest.revalidate(ws),
    deps.revalidation,
  );
  const websocket = createWebsocketHandler({
    containerInterest,
    organizationInterest,
    revalidation,
    router,
  });
  let unsubscribe: (() => void) | undefined;
  let unsubscribeReconnect: (() => void) | undefined;

  // Redis pub/sub fans every event to every API process; this process routes
  // each event only to its locally-connected sockets that declared interest. An
  // access change drops interest locally; mirror that into the persisted set so
  // a reconnect does not restore it before the client re-checks access.
  function start(): void {
    if (unsubscribe) {
      return;
    }
    const routeMessage = (message: string): void => {
      const event = parsePublishedRealtimeEvent(message);
      if (event?.type === "access_changed") {
        containerInterest.invalidateAccess(event.containerId);
      } else if (event?.type === "principal_access_changed") {
        containerInterest.invalidateAccess(principalInterestKey(event));
      }
      for (const eviction of router.routeServerEvent(message)) {
        persistInterest(eviction.userId, eviction.sessionId, {
          containerIds: [eviction.containerId],
          kind: "remove",
        });
      }
    };
    unsubscribe = subscribe((message) => {
      const preparation = organizationInterest.prepareServerEvent(message);
      if (!preparation) {
        routeMessage(message);
        return;
      }
      void preparation
        .then(() => routeMessage(message))
        .catch((error: unknown) => {
          console.error(
            "Failed to prepare websocket organization event:",
            error,
          );
          reportBackgroundFailure(error, "websocket.event");
          routeMessage(message);
        });
    });
    // Every invalidation published during a subscriber outage is lost, so a
    // reconnect re-verifies each live socket's subscriptions server-side and
    // asks every client to resync what it holds.
    unsubscribeReconnect = subscribeReconnect(() => {
      void containerInterest
        .revalidateAll({ resyncAll: true })
        .catch((error: unknown) => {
          reportBackgroundFailure(error, "websocket.revalidate");
        });
    });
  }

  function stop(): void {
    revalidation.stop();
    containerInterest.stop();
    unsubscribe?.();
    unsubscribe = undefined;
    unsubscribeReconnect?.();
    unsubscribeReconnect = undefined;
  }

  return { start, stop, websocket };
}
