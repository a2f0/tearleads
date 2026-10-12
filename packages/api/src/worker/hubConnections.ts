import type { GatewaySocketSnapshot } from "../realtime/gatewayHibernation";
import { type GatewaySocket, socketSessionKey } from "../realtime/wsConnection";
import type { LoadedHubGateway } from "./hubGateway";
import type { HubSocketAttachment, HubSocketStore } from "./hubSocketStore";
import {
  DEFAULT_SOCKET_QUEUE_LIMITS,
  SharedQueueBudget,
  SocketQueue,
} from "./socketQueue";

/** Pending client bytes the whole hub may hold; see SharedQueueBudget. */
const HUB_QUEUE_BUDGET_BYTES = 32 * 1024 * 1024;

interface Connection {
  readonly attachment: HubSocketAttachment;
  readonly socket: GatewaySocket;
  readonly queue: SocketQueue;
}

/** Owns per-socket ordering, resource bounds, and server-owned persistence. */
export class HubConnections {
  private readonly connections = new Map<
    CloudflareServerWebSocket,
    Connection
  >();
  private readonly dirty = new Set<CloudflareServerWebSocket>();
  private readonly sessionCounts = new Map<string, number>();
  private readonly budget = new SharedQueueBudget(HUB_QUEUE_BUDGET_BYTES);

  constructor(
    private readonly loaded: LoadedHubGateway,
    private readonly store: HubSocketStore,
  ) {}

  countSession(userId: string, sessionId: string): number {
    return this.sessionCounts.get(`${userId}:${sessionId}`) ?? 0;
  }

  attach(
    server: CloudflareServerWebSocket,
    attachment: HubSocketAttachment,
    saved?: GatewaySocketSnapshot,
  ): Promise<void> {
    const { gateway, report } = this.loaded;
    const socket: GatewaySocket = {
      data: attachment.identity,
      stateChanged: () => {
        if (this.connections.has(server)) this.dirty.add(server);
      },
      send: (message) => {
        if (!this.connections.has(server)) return;
        // Persist routing before exposing an acknowledgement. SQLite's output
        // gate holds the frame until this write has committed.
        this.save(server);
        server.send(message);
      },
      close: (code, reason) => this.close(server, code, reason),
    };
    const queue = new SocketQueue(
      {
        open: async () => {
          // Register the connection before restoration can expire and close it.
          await Promise.resolve();
          if (saved) await gateway.hibernation.restore(socket, saved);
          else await gateway.websocket.open(socket);
        },
        message: (data) => gateway.websocket.message(socket, data),
        close: () => gateway.websocket.close(socket),
        report: (error) => {
          report(error);
          this.close(server, 1011, "Gateway unavailable");
        },
        overflow: (reason) => this.close(server, 1013, reason),
      },
      DEFAULT_SOCKET_QUEUE_LIMITS,
      this.budget,
    );
    this.connections.set(server, { attachment, socket, queue });
    const key = socketSessionKey(socket);
    this.sessionCounts.set(key, (this.sessionCounts.get(key) ?? 0) + 1);
    if (!saved) this.dirty.add(server);
    return queue.settled();
  }

  async message(
    server: CloudflareServerWebSocket,
    message: string,
    bytes: number,
  ): Promise<void> {
    const connection = this.connections.get(server);
    if (!connection) return;
    connection.queue.enqueue(message, bytes);
    await connection.queue.settled();
  }

  close(server: CloudflareServerWebSocket, code = 1000, reason = ""): void {
    const connection = this.connections.get(server);
    if (connection) {
      this.connections.delete(server);
      this.dirty.delete(server);
      const key = socketSessionKey(connection.socket);
      const count = (this.sessionCounts.get(key) ?? 1) - 1;
      if (count === 0) this.sessionCounts.delete(key);
      else this.sessionCounts.set(key, count);
      this.store.remove(connection.attachment.id);
      // Remove routing immediately, including while authorization is pending.
      this.loaded.gateway.websocket.close(connection.socket);
      connection.queue.close();
    }
    try {
      server.close(code, reason);
    } catch {
      /* Already closed. */
    }
  }

  saveDirty(): void {
    for (const server of this.dirty) this.save(server);
  }

  private save(server: CloudflareServerWebSocket): void {
    if (!this.dirty.has(server)) return;
    const connection = this.connections.get(server);
    if (!connection) return;
    const snapshot = this.loaded.gateway.hibernation.snapshot(
      connection.socket,
    );
    if (snapshot) this.store.save(connection.attachment.id, snapshot);
    else this.store.remove(connection.attachment.id);
    this.dirty.delete(server);
  }
}
