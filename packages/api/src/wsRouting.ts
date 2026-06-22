import { isPlainObject } from "@tearleads/validators/isPlainObject";
import type { WebSocketTicketIdentity } from "./wsTicket";

/**
 * The subset of a Bun `ServerWebSocket` the router needs: the authenticated
 * identity bound at upgrade (`data`) and `send`. Narrowed so the router is
 * unit-testable with plain fakes.
 */
export interface WsConnection {
  readonly data: WebSocketTicketIdentity;
  send(message: string): unknown;
}

// Client -> server interest-declaration message types. Interest is the set of
// containers a socket wants invalidations for; it is NOT an authorization grant
// (the HTTP read models remain the source of access truth).
const KNOWN_CONTAINERS_REPLACE = "known_containers";
const KNOWN_CONTAINERS_ADD = "known_containers.add";
const KNOWN_CONTAINERS_REMOVE = "known_containers.remove";

/**
 * The interest change a client message applied, returned to the impure shell so
 * it can mirror the change into the Redis per-session interest set. Null when the
 * message was malformed or not an interest declaration.
 */
export type AppliedInterest = {
  readonly kind: "replace" | "add" | "remove";
  readonly containerIds: string[];
} | null;

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter(
        (entry): entry is string =>
          typeof entry === "string" && entry.length > 0,
      )
    : [];
}

function readStringField(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Containers an event is scoped to. Document events already carry the linked
 * container set resolved during sync; container events carry the container plus
 * its (previous) parent so a parent's watchers learn about child changes. The
 * router only delivers to sockets that declared interest in one of these.
 */
function eventContainerIds(event: Record<string, unknown>): string[] {
  const containerIds = new Set(
    readStringArray(Reflect.get(event, "containerIds")),
  );
  for (const key of ["containerId", "parentId", "previousParentId"]) {
    const value = readStringField(Reflect.get(event, key));
    if (value) {
      containerIds.add(value);
    }
  }
  return [...containerIds];
}

function addToIndex<K>(
  index: Map<K, Set<WsConnection>>,
  key: K,
  ws: WsConnection,
): void {
  const existing = index.get(key);
  if (existing) {
    existing.add(ws);
    return;
  }
  index.set(key, new Set([ws]));
}

function removeFromIndex<K>(
  index: Map<K, Set<WsConnection>>,
  key: K,
  ws: WsConnection,
): void {
  const existing = index.get(key);
  if (!existing) {
    return;
  }
  existing.delete(ws);
  if (existing.size === 0) {
    index.delete(key);
  }
}

/**
 * Process-local websocket router. Redis pub/sub still fans every event to every
 * API process; this routes within one process to only the sockets that are both
 * connected here and interested in the event's containers, sending the minimal
 * client payload unchanged. Socket handles never leave the process.
 */
export class WsEventRouter {
  private readonly socketsByUserId = new Map<string, Set<WsConnection>>();
  private readonly socketsByContainerId = new Map<string, Set<WsConnection>>();
  private readonly interestBySocket = new Map<WsConnection, Set<string>>();

  open(ws: WsConnection): void {
    addToIndex(this.socketsByUserId, ws.data.userId, ws);
    if (!this.interestBySocket.has(ws)) {
      this.interestBySocket.set(ws, new Set());
    }
  }

  close(ws: WsConnection): void {
    removeFromIndex(this.socketsByUserId, ws.data.userId, ws);
    const interest = this.interestBySocket.get(ws);
    if (interest) {
      for (const containerId of interest) {
        removeFromIndex(this.socketsByContainerId, containerId, ws);
      }
      this.interestBySocket.delete(ws);
    }
  }

  handleClientMessage(ws: WsConnection, rawMessage: string): AppliedInterest {
    const parsed = parseJsonObject(rawMessage);
    if (!parsed) {
      return null;
    }
    const containerIds = readStringArray(Reflect.get(parsed, "containerIds"));
    switch (Reflect.get(parsed, "type")) {
      case KNOWN_CONTAINERS_REPLACE:
        this.replaceInterest(ws, containerIds);
        return { containerIds, kind: "replace" };
      case KNOWN_CONTAINERS_ADD:
        this.addInterest(ws, containerIds);
        return { containerIds, kind: "add" };
      case KNOWN_CONTAINERS_REMOVE:
        this.removeInterest(ws, containerIds);
        return { containerIds, kind: "remove" };
      default:
        return null;
    }
  }

  /**
   * Seed a reconnecting socket's interest from the server-side persisted set,
   * so it routes correctly before (or without) the client re-declaring. Same
   * replace semantics as a `known_containers` message; no I/O (the caller loads
   * the persisted set and keeps the router pure).
   */
  hydrateInterest(ws: WsConnection, containerIds: string[]): void {
    this.replaceInterest(ws, containerIds);
  }

  routeServerEvent(rawMessage: string): void {
    const event = parseJsonObject(rawMessage);
    if (!event) {
      return;
    }
    for (const ws of this.recipientsForEvent(event)) {
      ws.send(rawMessage);
    }
  }

  // Test/diagnostics: number of sockets currently interested in a container.
  interestedSocketCount(containerId: string): number {
    return this.socketsByContainerId.get(containerId)?.size ?? 0;
  }

  private recipientsForEvent(
    event: Record<string, unknown>,
  ): Set<WsConnection> {
    const recipients = new Set<WsConnection>();
    const containerIds = eventContainerIds(event);
    if (containerIds.length > 0) {
      for (const containerId of containerIds) {
        for (const ws of this.socketsByContainerId.get(containerId) ?? []) {
          recipients.add(ws);
        }
      }
      return recipients;
    }

    // No container scope (e.g. user_registered): fall back to user scope so the
    // event reaches that user's own connected sockets and no one else's.
    const userId = readStringField(Reflect.get(event, "userId"));
    if (userId) {
      for (const ws of this.socketsByUserId.get(userId) ?? []) {
        recipients.add(ws);
      }
    }
    return recipients;
  }

  private replaceInterest(ws: WsConnection, containerIds: string[]): void {
    const previous = this.interestBySocket.get(ws);
    if (previous) {
      for (const containerId of previous) {
        removeFromIndex(this.socketsByContainerId, containerId, ws);
      }
    }
    const next = new Set(containerIds);
    this.interestBySocket.set(ws, next);
    for (const containerId of next) {
      addToIndex(this.socketsByContainerId, containerId, ws);
    }
  }

  private addInterest(ws: WsConnection, containerIds: string[]): void {
    const interest = this.interestBySocket.get(ws) ?? new Set<string>();
    this.interestBySocket.set(ws, interest);
    for (const containerId of containerIds) {
      if (!interest.has(containerId)) {
        interest.add(containerId);
        addToIndex(this.socketsByContainerId, containerId, ws);
      }
    }
  }

  private removeInterest(ws: WsConnection, containerIds: string[]): void {
    const interest = this.interestBySocket.get(ws);
    if (!interest) {
      return;
    }
    for (const containerId of containerIds) {
      if (interest.delete(containerId)) {
        removeFromIndex(this.socketsByContainerId, containerId, ws);
      }
    }
  }
}

function parseJsonObject(rawMessage: string): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawMessage);
  } catch {
    return null;
  }
  return isPlainObject(parsed) ? parsed : null;
}
