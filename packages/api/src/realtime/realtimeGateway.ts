import { MAX_WS_CLIENT_MESSAGE_BYTES } from "@tearleads/validators/realtime";
import {
  addListener,
  addSubscriberReconnectListener,
} from "../adapters/redisPubSub";
import { reportBackgroundFailure } from "../diagnostics/reportBackgroundFailure";
import { authorizeContainerAccessWithWorkflow } from "./containerInterestAccess";
import { ContainerInterestAuthorizer } from "./containerInterestAuthorization";
import {
  type ProofAgePolicy,
  RevalidationSchedule,
  type RevalidationScheduleOptions,
  resolveProofAgePolicy,
} from "./containerInterestRevalidation";
import {
  type AuthorizeContainerAccess,
  principalInterestKey,
} from "./containerInterestTypes";
import {
  type AuthorizeOrganizationAccess,
  OrganizationInterestAuthorizer,
} from "./organizationInterestAuthorization";
import { parsePublishedRealtimeEvent } from "./publishedRealtimeEvents";
import type { GatewaySocket, WsConnection } from "./wsConnection";
import type { WsSessionValidator } from "./wsIdentity";
import {
  createOrderedInterestPersister,
  MAX_PENDING_INTEREST_WRITES,
  type OrderedInterestPersister,
  wsInterestStore,
} from "./wsInterestStore";
import { WsEventRouter } from "./wsRouting";
import { WsSessionLiveness } from "./wsSessionLiveness";

type InterestStore = Pick<typeof wsInterestStore, "apply" | "load">;
type Subscribe = typeof addListener;
type SubscribeReconnect = typeof addSubscriberReconnectListener;
const CONTAINER_AUTHORIZATION_TIMEOUT_MS = 10_000;
const ORGANIZATION_AUTHORIZATION_TIMEOUT_MS = 10_000;
const SESSION_READ_TIMEOUT_MS = 10_000;

interface RealtimeGatewayDeps {
  readonly authorizeContainerAccess?: AuthorizeContainerAccess;
  readonly containerAuthorizationTimeoutMs?: number;
  readonly authorizeOrganizationAccess?: AuthorizeOrganizationAccess;
  readonly interestStore?: InterestStore;
  readonly organizationAuthorizationTimeoutMs?: number;
  readonly revalidation?: RevalidationScheduleOptions;
  readonly router?: WsEventRouter;
  /** How long a session liveness check waits on the session store. */
  readonly sessionReadTimeoutMs?: number;
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
  readonly persistInterest: OrderedInterestPersister;
  readonly revalidation: RevalidationSchedule<WsConnection>;
  readonly router: WsEventRouter;
}) {
  return {
    maxPayloadLength: MAX_WS_CLIENT_MESSAGE_BYTES,
    async open(ws: GatewaySocket) {
      input.router.open(ws);
      input.revalidation.open(ws);
      input.liveness.open(ws);
      await input.containerInterest.open(ws);
    },
    close(ws: GatewaySocket) {
      input.revalidation.close(ws);
      input.liveness.close(ws);
      input.containerInterest.close(ws);
      input.organizationInterest.close(ws);
      input.router.close(ws);
    },
    async message(ws: GatewaySocket, message: string | Buffer) {
      // A session whose interest writes lag holds its next frame until the
      // store catches up; the frame stays counted by the socket's queue.
      if (
        input.persistInterest.pending(ws.data.userId, ws.data.sessionId) >=
        MAX_PENDING_INTEREST_WRITES
      ) {
        await input.persistInterest.drain(ws.data.userId, ws.data.sessionId);
      }
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
      revalidation: deps.revalidation,
      router,
      validateSession: deps.validateSession,
    }),
    revalidation: new RevalidationSchedule<WsConnection>(
      (ws) => containerInterest.revalidate(ws),
      deps.revalidation,
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
    readonly interestStore: InterestStore;
    readonly persistInterest: OrderedInterestPersister;
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
    shared.interestStore,
    shared.persistInterest,
    shared.router,
    shared.proofAge,
  );
  return { containerInterest, organizationInterest };
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
  const persistInterest = createOrderedInterestPersister(interestStore);
  const subscribe = deps.subscribe ?? addListener;
  const subscribeReconnect =
    deps.subscribeReconnect ?? addSubscriberReconnectListener;
  const proofAge = resolveProofAgePolicy(deps.revalidation);
  const { containerInterest, organizationInterest } = createInterestAuthorizers(
    deps,
    { interestStore, persistInterest, proofAge, router },
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
    persistInterest,
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

  return { start, stop, websocket };
}
