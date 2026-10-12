import { DurableObject } from "cloudflare:workers";
import { MAX_WS_CLIENT_MESSAGE_BYTES } from "@tearleads/validators/realtime";
import type { GatewaySocket } from "../realtime/wsConnection";
import type { WebSocketTicketIdentity } from "../realtime/wsIdentity";
import type { RealtimeHubRpc } from "./contracts";
import { bindWorkerEnvironment, type WorkerBindings } from "./environment";
import { clientMessageByteLength } from "./socketMessageLimit";
import {
  DEFAULT_SOCKET_QUEUE_LIMITS,
  SharedQueueBudget,
  SocketQueue,
} from "./socketQueue";

type EventListener = (message: string) => void;

interface LoadedGateway {
  readonly consumeTicket: (
    ticket: string,
  ) => Promise<WebSocketTicketIdentity | null>;
  readonly report: (error: unknown) => void;
  readonly websocket: {
    open(ws: GatewaySocket): Promise<void>;
    close(ws: GatewaySocket): void;
    message(ws: GatewaySocket, message: string): Promise<void>;
  };
}

const EVENTS_PATH = "/events";
/** Pending client bytes the whole hub may hold; see SharedQueueBudget. */
const HUB_QUEUE_BUDGET_BYTES = 32 * 1024 * 1024;
/** Open sockets one session may hold; a client needs one, a few for tabs. */
const MAX_SOCKETS_PER_SESSION = 8;
const CLOSE_MESSAGE_TOO_BIG = 1009;
const CLOSE_UNSUPPORTED_DATA = 1003;
const CLOSE_TRY_AGAIN_LATER = 1013;

/**
 * One Durable Object hosts the realtime gateway exactly as the Bun process
 * did: it owns every live socket, the in-memory interest router, and the
 * revalidation timers. HTTP Workers publish events to it over RPC instead of
 * Redis pub/sub, so the gateway's own routing and authorization code runs
 * unchanged. Sockets are accepted without the hibernation API because the
 * gateway keeps per-socket state and timers in memory; that keeps the object
 * resident while clients are connected, which is the intended trade at the
 * current connection count. Hibernation is a follow-up, not a prerequisite.
 */
export class RealtimeHub
  extends DurableObject<WorkerBindings>
  implements RealtimeHubRpc
{
  private readonly listeners = new Set<EventListener>();
  private readonly budget = new SharedQueueBudget(HUB_QUEUE_BUDGET_BYTES);
  private readonly socketsBySession = new Map<string, number>();
  private gateway: Promise<LoadedGateway> | undefined;

  constructor(ctx: DurableObjectState, env: WorkerBindings) {
    super(ctx, env);
    bindWorkerEnvironment(env);
  }

  /** Fan an HTTP-side event to the gateway, as the Redis subscriber did. */
  publish(message: string): void {
    for (const listener of this.listeners) {
      try {
        listener(message);
      } catch (error) {
        console.error("Realtime hub listener error:", error);
      }
    }
  }

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("WebSocket upgrade required", { status: 426 });
    }
    const url = new URL(request.url);
    if (url.pathname !== EVENTS_PATH) {
      return new Response("WebSocket endpoint not found", { status: 404 });
    }
    const gateway = await this.loadGateway();
    const identity = await gateway.consumeTicket(
      url.searchParams.get("ticket") ?? "",
    );
    if (!identity) {
      return new Response("WebSocket ticket required", { status: 401 });
    }
    const sessionKey = `${identity.userId}:${identity.sessionId}`;
    if (
      (this.socketsBySession.get(sessionKey) ?? 0) >= MAX_SOCKETS_PER_SESSION
    ) {
      return new Response("Too many sockets for this session", { status: 429 });
    }
    this.socketsBySession.set(
      sessionKey,
      (this.socketsBySession.get(sessionKey) ?? 0) + 1,
    );

    const pair = new WebSocketPair();
    const server = pair[1];
    server.accept();
    this.attach(gateway, server, identity);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  private attach(
    gateway: LoadedGateway,
    server: CloudflareServerWebSocket,
    identity: WebSocketTicketIdentity,
  ): void {
    const socket: GatewaySocket = {
      data: identity,
      send: (message) => server.send(message),
      close: (code, reason) => server.close(code, reason),
    };
    const sessionKey = `${identity.userId}:${identity.sessionId}`;
    let counted = true;
    const release = () => {
      if (!counted) {
        return;
      }
      counted = false;
      const remaining = (this.socketsBySession.get(sessionKey) ?? 1) - 1;
      if (remaining <= 0) {
        this.socketsBySession.delete(sessionKey);
      } else {
        this.socketsBySession.set(sessionKey, remaining);
      }
    };
    const queue = new SocketQueue(
      {
        open: () => gateway.websocket.open(socket),
        message: (data) => gateway.websocket.message(socket, data),
        close: () => {
          release();
          gateway.websocket.close(socket);
        },
        report: gateway.report,
        overflow: (reason) => server.close(CLOSE_TRY_AGAIN_LATER, reason),
      },
      DEFAULT_SOCKET_QUEUE_LIMITS,
      this.budget,
    );
    server.addEventListener("message", (event) => {
      const { data } = event;
      if (typeof data !== "string") {
        server.close(CLOSE_UNSUPPORTED_DATA, "Text frames only");
        return;
      }
      const byteLength = clientMessageByteLength(data);
      if (byteLength > MAX_WS_CLIENT_MESSAGE_BYTES) {
        server.close(CLOSE_MESSAGE_TOO_BIG, "Message too large");
        return;
      }
      queue.enqueue(data, byteLength);
    });
    server.addEventListener("close", () => queue.close());
    server.addEventListener("error", () => queue.close());
  }

  private loadGateway(): Promise<LoadedGateway> {
    this.gateway ??= this.createGateway();
    return this.gateway;
  }

  // The gateway and its dependencies read configuration at import time, so
  // they load only after the constructor has bound the environment.
  private async createGateway(): Promise<LoadedGateway> {
    const [gatewayModule, ticketModule, diagnosticsModule] = await Promise.all([
      import("../realtime/realtimeGateway"),
      import("../realtime/wsTicket"),
      import("../diagnostics/reportBackgroundFailure"),
    ]);
    const gateway = gatewayModule.createRealtimeGateway({
      subscribe: (listener) => {
        this.listeners.add(listener);
        return () => {
          this.listeners.delete(listener);
        };
      },
      // Publishing is an in-process call here, so there are no delivery gaps
      // for a reconnect pass to repair.
      subscribeReconnect: () => () => {},
    });
    gateway.start();
    return {
      consumeTicket: ticketModule.consumeWebSocketTicket,
      report: (error) =>
        diagnosticsModule.reportBackgroundFailure(error, "websocket.event"),
      websocket: gateway.websocket,
    };
  }
}
