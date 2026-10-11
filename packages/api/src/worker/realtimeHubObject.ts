import { DurableObject } from "cloudflare:workers";
import { MAX_WS_CLIENT_MESSAGE_BYTES } from "@tearleads/validators/realtime";
import type { GatewaySocket } from "../realtime/wsConnection";
import type { WebSocketTicketIdentity } from "../realtime/wsIdentity";
import type { RealtimeHubRpc } from "./contracts";
import {
  bindWorkerEnvironment,
  setLocalRealtimePublisher,
  type WorkerBindings,
} from "./environment";

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
const CLOSE_MESSAGE_TOO_BIG = 1009;
const CLOSE_UNSUPPORTED_DATA = 1003;
const CLOSE_TRY_AGAIN_LATER = 1013;
/**
 * Messages a socket may have waiting behind its open or an earlier message.
 * The gateway bounds pending declarations once it sees them; this bounds what
 * a client can queue before it does, so one socket cannot grow the shared
 * hub's memory while an authorization is in flight.
 */
const MAX_QUEUED_SOCKET_MESSAGES = 32;

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
  private gateway: Promise<LoadedGateway> | undefined;

  constructor(ctx: DurableObjectState, env: WorkerBindings) {
    super(ctx, env);
    bindWorkerEnvironment(env);
    setLocalRealtimePublisher((message) => this.publish(message));
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
    // Bun delivers open before the first message; serialize the same order.
    let queue = gateway.websocket.open(socket).catch(gateway.report);
    let queued = 0;
    let closed = false;
    const close = () => {
      if (closed) {
        return;
      }
      closed = true;
      queue = queue.then(() => gateway.websocket.close(socket));
    };
    server.addEventListener("message", (event) => {
      const { data } = event;
      if (typeof data !== "string") {
        server.close(CLOSE_UNSUPPORTED_DATA, "Text frames only");
        return;
      }
      if (data.length > MAX_WS_CLIENT_MESSAGE_BYTES) {
        server.close(CLOSE_MESSAGE_TOO_BIG, "Message too large");
        return;
      }
      if (queued >= MAX_QUEUED_SOCKET_MESSAGES) {
        server.close(CLOSE_TRY_AGAIN_LATER, "Too many pending messages");
        return;
      }
      queued += 1;
      queue = queue
        .then(() => gateway.websocket.message(socket, data))
        .catch(gateway.report)
        .finally(() => {
          queued -= 1;
        });
    });
    server.addEventListener("close", close);
    server.addEventListener("error", close);
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
