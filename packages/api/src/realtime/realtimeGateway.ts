import { MAX_WS_CLIENT_MESSAGE_BYTES } from "@tearleads/validators/realtime";
import {
  addListener,
  addSubscriberReconnectListener,
} from "../adapters/pubSub";
import { reportBackgroundFailure } from "../diagnostics/reportBackgroundFailure";
import { authorizeContainerAccessWithWorkflow } from "./containerInterestAccess";
import { ContainerInterestAuthorizer } from "./containerInterestAuthorization";
import {
  type ProofAgePolicy,
  RevalidationSchedule,
  type RevalidationScheduleOptions,
  resolveProofAgePolicy,
  type ScheduleTimer,
} from "./containerInterestRevalidation";
import {
  type AuthorizeContainerAccess,
  principalInterestKey,
} from "./containerInterestTypes";
import { createGatewayHibernation } from "./gatewayHibernation";
import {
  type AuthorizeOrganizationAccess,
  OrganizationInterestAuthorizer,
} from "./organizationInterestAuthorization";
import { parsePublishedRealtimeEvent } from "./publishedRealtimeEvents";
import type { GatewaySocket, WsConnection } from "./wsConnection";
import type { WsSessionValidator } from "./wsIdentity";
import { WsEventRouter } from "./wsRouting";
import { WsSessionLiveness } from "./wsSessionLiveness";

type Subscribe = typeof addListener;
type SubscribeReconnect = typeof addSubscriberReconnectListener;
const CONTAINER_AUTHORIZATION_TIMEOUT_MS = 10_000;
const ORGANIZATION_AUTHORIZATION_TIMEOUT_MS = 10_000;
const SESSION_READ_TIMEOUT_MS = 10_000;

interface RealtimeGatewayDeps {
  readonly authorizeContainerAccess?: AuthorizeContainerAccess;
  readonly containerAuthorizationTimeoutMs?: number;
  readonly authorizeOrganizationAccess?: AuthorizeOrganizationAccess;
  readonly organizationAuthorizationTimeoutMs?: number;
  readonly revalidation?: RevalidationScheduleOptions;
  readonly router?: WsEventRouter;
  /** How long a session liveness check waits on the session store. */
  readonly sessionReadTimeoutMs?: number;
  readonly scheduleReadTimeout?: ScheduleTimer;
  readonly subscribe?: Subscribe;
  readonly subscribeReconnect?: SubscribeReconnect;
  /** Whether a socket's session is still live; defaults to the session store. */
  readonly validateSession?: WsSessionValidator;
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

function createWebsocketHandler(input: {
  readonly containerInterest: ContainerInterestAuthorizer;
  readonly liveness: WsSessionLiveness;
  readonly organizationInterest: OrganizationInterestAuthorizer;
  readonly revalidation: RevalidationSchedule<WsConnection>;
  readonly router: WsEventRouter;
}) {
  return {
    maxPayloadLength: MAX_WS_CLIENT_MESSAGE_BYTES,
    // A new socket holds no container interest until its client declares;
    // the client's acknowledged declaration is the only interest source.
    open(ws: GatewaySocket) {
      input.router.open(ws);
      input.revalidation.open(ws);
      input.liveness.open(ws);
      input.containerInterest.open(ws);
    },
    close(ws: GatewaySocket) {
      input.revalidation.close(ws);
      input.liveness.close(ws);
      input.containerInterest.close(ws);
      input.organizationInterest.close(ws);
      input.router.close(ws);
    },
    async message(ws: GatewaySocket, message: string | Buffer) {
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

/** Per-socket proof re-verification, and per-session liveness rechecks. */
function createRevalidationPasses(
  deps: RealtimeGatewayDeps,
  router: WsEventRouter,
  containerInterest: ContainerInterestAuthorizer,
  proofAge: ProofAgePolicy,
) {
  return {
    liveness: new WsSessionLiveness({
      policy: proofAge,
      readTimeoutMs: deps.sessionReadTimeoutMs ?? SESSION_READ_TIMEOUT_MS,
      scheduleReadTimeout: deps.scheduleReadTimeout,
      revalidation: deps.revalidation,
      router,
      validateSession: deps.validateSession,
    }),
    revalidation: new RevalidationSchedule<WsConnection>(
      (ws) => containerInterest.revalidate(ws),
      deps.revalidation,
      (ws) => ws.stateChanged?.(),
    ),
  };
}

/**
 * Every invalidation published during a subscriber outage is lost, so a
 * reconnect re-verifies each live socket's subscriptions server-side, asks
 * every client to resync what it holds, and rechecks each open session.
 */
function revalidateAfterReconnect(
  containerInterest: ContainerInterestAuthorizer,
  liveness: WsSessionLiveness,
): void {
  void containerInterest
    .revalidateAll({ resyncAll: true })
    .catch((error: unknown) => {
      reportBackgroundFailure(error, "websocket.revalidate");
    });
  // Beside the pass, never ahead of it: a hung session read must not hold back
  // marking the outage's queries stale.
  void liveness.checkAll();
}

/** The two interest authorizers and the dependencies they share. */
function createInterestAuthorizers(
  deps: RealtimeGatewayDeps,
  shared: {
    readonly proofAge: ProofAgePolicy;
    readonly router: WsEventRouter;
  },
) {
  const authorizeOrganizationAccess =
    deps.authorizeOrganizationAccess ?? authorizeOrganizationAccessWithWorkflow;
  const organizationInterest = new OrganizationInterestAuthorizer(
    authorizeOrganizationAccess,
    deps.organizationAuthorizationTimeoutMs ??
      ORGANIZATION_AUTHORIZATION_TIMEOUT_MS,
    shared.router,
  );
  const containerInterest = new ContainerInterestAuthorizer(
    deps.authorizeContainerAccess ?? authorizeContainerAccessWithWorkflow,
    deps.containerAuthorizationTimeoutMs ?? CONTAINER_AUTHORIZATION_TIMEOUT_MS,
    shared.router,
    shared.proofAge,
  );
  return { containerInterest, organizationInterest };
}

/**
 * The realtime sync gateway owns the in-memory socket/interest router and its
 * pub/sub subscription. Interest belongs to one open socket: a client
 * declares it after every connect, and no reconnect cache outlives the socket.
 * Constructing it has no side effects; the subscription opens only when
 * `start()` is called. On the local server the gateway is constructed and
 * started once at the composition root (index.ts),
 * the same place the HTTP app is assembled — there is no second, import-time
 * composition root. Deps default to production singletons and are injectable for
 * tests.
 */
export function createRealtimeGateway(deps: RealtimeGatewayDeps = {}) {
  const router = deps.router ?? new WsEventRouter();
  const subscribe = deps.subscribe ?? addListener;
  const subscribeReconnect =
    deps.subscribeReconnect ?? addSubscriberReconnectListener;
  const proofAge = resolveProofAgePolicy(deps.revalidation);
  const { containerInterest, organizationInterest } = createInterestAuthorizers(
    deps,
    { proofAge, router },
  );
  const { liveness, revalidation } = createRevalidationPasses(
    deps,
    router,
    containerInterest,
    proofAge,
  );
  const websocket = createWebsocketHandler({
    containerInterest,
    liveness,
    organizationInterest,
    revalidation,
    router,
  });
  let unsubscribe: (() => void) | undefined;
  let unsubscribeReconnect: (() => void) | undefined;

  // The Worker awaits this same path directly; an event cannot finish while
  // organization authorization is still outstanding.
  async function publish(message: string): Promise<void> {
    try {
      const preparation = organizationInterest.prepareServerEvent(message);
      if (preparation) await preparation;
    } catch (error) {
      reportBackgroundFailure(error, "websocket.event");
    }
    const event = parsePublishedRealtimeEvent(message);
    if (event?.type === "access_changed") {
      containerInterest.invalidateAccess(event.containerId);
    } else if (event?.type === "principal_access_changed") {
      containerInterest.invalidateAccess(principalInterestKey(event));
    }
    router.routeServerEvent(message);
  }

  function start(): void {
    if (unsubscribe) return;
    unsubscribe = subscribe((message) => {
      void publish(message).catch((error: unknown) => {
        reportBackgroundFailure(error, "websocket.event");
      });
    });
    unsubscribeReconnect = subscribeReconnect(() =>
      revalidateAfterReconnect(containerInterest, liveness),
    );
  }

  function stop(): void {
    revalidation.stop();
    liveness.stop();
    containerInterest.stop();
    unsubscribe?.();
    unsubscribe = undefined;
    unsubscribeReconnect?.();
    unsubscribeReconnect = undefined;
  }

  return {
    start,
    stop,
    websocket,
    publish,
    hibernation: createGatewayHibernation({
      containerInterest,
      liveness,
      organizationInterest,
      revalidation,
      router,
    }),
  };
}
