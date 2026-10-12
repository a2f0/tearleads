import { DurableObject } from "cloudflare:workers";
import { MAX_WS_CLIENT_MESSAGE_BYTES } from "@tearleads/validators/realtime";
import type { RealtimeHubRpc } from "./contracts";
import { bindWorkerEnvironment, type WorkerBindings } from "./environment";
import { HubAlarmScheduler } from "./hubAlarmScheduler";
import { HubConnections } from "./hubConnections";
import { type LoadedHubGateway, loadHubGateway } from "./hubGateway";
import { HubSocketAttachmentSchema } from "./hubSocketState";
import { type HubSocketAttachment, HubSocketStore } from "./hubSocketStore";
import { clientMessageByteLength } from "./socketMessageLimit";

const MAX_SOCKETS_PER_SESSION = 8;
const CLOSE_UNSUPPORTED_DATA = 1003;
const CLOSE_MESSAGE_TOO_BIG = 1009;
const CLOSE_STATE_UNAVAILABLE = 1011;

interface LoadedHub extends LoadedHubGateway {
  readonly connections: HubConnections;
}

/**
 * Sockets survive eviction. SQLite retains each socket's verified routing and
 * absolute authorization deadlines; a durable alarm replaces idle timers.
 * Every entry restores all sockets before routing, including an HTTP publish
 * that wakes the hub without any client sending a message.
 */
export class RealtimeHub
  extends DurableObject<WorkerBindings>
  implements RealtimeHubRpc
{
  private readonly scheduler: HubAlarmScheduler;
  private readonly store: HubSocketStore;
  private hub: Promise<LoadedHub> | undefined;

  constructor(ctx: DurableObjectState, env: WorkerBindings) {
    super(ctx, env);
    bindWorkerEnvironment(env);
    this.scheduler = new HubAlarmScheduler(ctx.storage);
    this.store = new HubSocketStore(ctx.storage.sql);
  }

  async publish(message: string): Promise<void> {
    const routed = Promise.withResolvers<void>();
    const completed = this.run(
      async (hub) => {
        await hub.gateway.publish(message);
      },
      () => routed.resolve(),
    );
    this.ctx.waitUntil(
      completed.catch((error: unknown) => {
        // Hints are best effort, as with the previous listener-based hub.
        // A failed wake-up must not fail an already committed HTTP mutation.
        console.error("Realtime publication background work failed:", error);
        routed.resolve();
      }),
    );
    await routed.promise;
  }

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("WebSocket upgrade required", { status: 426 });
    }
    const url = new URL(request.url);
    if (url.pathname !== "/events")
      return new Response("WebSocket endpoint not found", { status: 404 });
    let accepted:
      | { hub: LoadedHub; server: CloudflareServerWebSocket }
      | undefined;
    return this.run(async (hub) => {
      const identity = await hub.consumeTicket(
        url.searchParams.get("ticket") ?? "",
      );
      if (!identity)
        return new Response("WebSocket ticket required", { status: 401 });
      if (
        hub.connections.countSession(identity.userId, identity.sessionId) >=
        MAX_SOCKETS_PER_SESSION
      ) {
        return new Response("Too many sockets for this session", {
          status: 429,
        });
      }
      const pair = new WebSocketPair();
      const attachment: HubSocketAttachment = {
        id: crypto.randomUUID(),
        identity,
      };
      pair[1].serializeAttachment(attachment);
      this.ctx.acceptWebSocket(pair[1]);
      accepted = { hub, server: pair[1] };
      await hub.connections.attach(pair[1], attachment);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }).catch((error: unknown) => {
      accepted?.hub.connections.close(
        accepted.server,
        CLOSE_STATE_UNAVAILABLE,
        "Socket setup failed",
      );
      throw error;
    });
  }

  override async webSocketMessage(
    server: CloudflareServerWebSocket,
    message: string | ArrayBuffer,
  ): Promise<void> {
    await this.run(async (hub) => {
      if (typeof message !== "string") {
        hub.connections.close(
          server,
          CLOSE_UNSUPPORTED_DATA,
          "Text frames only",
        );
        return;
      }
      const bytes = clientMessageByteLength(message);
      if (bytes > MAX_WS_CLIENT_MESSAGE_BYTES) {
        hub.connections.close(
          server,
          CLOSE_MESSAGE_TOO_BIG,
          "Message too large",
        );
        return;
      }
      await hub.connections.message(server, message, bytes);
    });
  }

  override async webSocketClose(
    server: CloudflareServerWebSocket,
  ): Promise<void> {
    await this.run(async (hub) => {
      hub.connections.close(server);
    });
  }

  override async webSocketError(
    server: CloudflareServerWebSocket,
  ): Promise<void> {
    await this.run(async (hub) => {
      hub.connections.close(server, CLOSE_STATE_UNAVAILABLE, "Socket error");
    });
  }

  override async alarm(): Promise<void> {
    await this.run(async () => undefined);
  }

  private async run<T>(
    operation: (hub: LoadedHub) => Promise<T>,
    routed?: () => void,
  ): Promise<T> {
    this.hub ??= this.restore().catch((error: unknown) => {
      this.hub = undefined;
      throw error;
    });
    const hub = await this.hub;
    const leave = this.scheduler.enter(() => this.ctx.waitUntil(this.alarm()));
    try {
      return await hub.withDatabase(async () =>
        this.runEvent(hub, operation, routed),
      );
    } finally {
      leave();
    }
  }

  private async runEvent<T>(
    hub: LoadedHub,
    operation: (hub: LoadedHub) => Promise<T>,
    routed?: () => void,
  ): Promise<T> {
    // runDue invokes expired deadline callbacks before yielding. Keep periodic
    // reads beside the event so a slow store cannot delay a revocation RPC.
    const failures: unknown[] = [];
    const checks = this.scheduler.runDue().catch((error: unknown) => {
      failures.push(error);
    });
    const [outcome] = await Promise.allSettled([
      Promise.resolve().then(() => operation(hub)),
    ]);
    if (outcome.status === "fulfilled") routed?.();
    else failures.push(outcome.reason);
    for (const complete of [
      () => checks,
      () => hub.gateway.flush(),
      () => hub.connections.saveDirty(),
      () => this.scheduler.flush(),
    ]) {
      try {
        await complete();
      } catch (error) {
        failures.push(error);
      }
    }
    if (outcome.status === "fulfilled" && failures.length === 0)
      return outcome.value;
    throw new AggregateError(failures, "Realtime event failed");
  }

  private async restore(): Promise<LoadedHub> {
    const loaded = await loadHubGateway(this.scheduler);
    const connections = new HubConnections(loaded, this.store);
    const liveIds = new Set<string>();
    const restores: Promise<void>[] = [];
    for (const server of this.ctx.getWebSockets()) {
      const parsed = HubSocketAttachmentSchema.safeParse(
        server.deserializeAttachment(),
      );
      const attachment = parsed.success ? parsed.data : null;
      const saved = attachment ? this.store.load(attachment.id) : null;
      if (!attachment || !saved || server.readyState !== WebSocket.OPEN) {
        connections.close(
          server,
          CLOSE_STATE_UNAVAILABLE,
          "Socket state unavailable",
        );
        continue;
      }
      liveIds.add(attachment.id);
      restores.push(connections.attach(server, attachment, saved));
    }
    this.store.prune(liveIds);
    await Promise.all(restores);
    return { ...loaded, connections };
  }
}
