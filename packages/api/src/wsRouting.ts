import { isPlainObject } from "@tearleads/validators/isPlainObject";
import { isUuidV4String } from "@tearleads/validators/util";
import type { WebSocketTicketIdentity } from "./wsIdentity";

/**
 * The subset of a Bun `ServerWebSocket` the router needs: the authenticated
 * identity bound at upgrade (`data`) and `send`. Narrowed so the router is
 * unit-testable with plain fakes.
 */
export interface WsConnection {
  readonly data: WebSocketTicketIdentity;
  close?(code?: number, reason?: string): unknown;
  send(message: string): unknown;
}

// Client -> server interest-declaration message types. Interest is the set of
// containers a socket wants invalidations for; it is NOT an authorization grant
// (the HTTP read models remain the source of access truth).
const KNOWN_CONTAINERS_REPLACE = "known_containers";
const KNOWN_CONTAINERS_ADD = "known_containers.add";
const KNOWN_CONTAINERS_REMOVE = "known_containers.remove";

// A container's access changed; sockets interested in it must resync (server ->
// router control event) and are told to over HTTP (router -> client).
const ACCESS_CHANGED = "access_changed";
const RESYNC_REQUIRED = "resync_required";
const SESSION_REVOKED = "session_revoked";
const SESSION_REVOKED_CLOSE_CODE = 1008;
const SESSION_REVOKED_CLOSE_REASON = "Session revoked";
export const MAX_CLIENT_MESSAGE_BYTES = 1_000_000;
const MAX_INTEREST_CONTAINER_IDS = 10_000;

/**
 * The interest change a client message applied, returned to the impure shell so
 * it can mirror the change into the Redis per-session interest set. Null when the
 * message was malformed or not an interest declaration.
 */
export type AppliedInterest = {
  readonly kind: "replace" | "add" | "remove";
  readonly containerIds: string[];
} | null;

// An interest the router dropped on an access change, returned so the caller can
// remove it from the persisted set too.
interface InterestEviction {
  readonly userId: string;
  readonly sessionId: string;
  readonly containerId: string;
}

function readContainerIdArray(value: unknown): string[] | null {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || value.length > MAX_INTEREST_CONTAINER_IDS) {
    return null;
  }

  const containerIds: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || !isUuidV4String(entry)) {
      return null;
    }
    containerIds.push(entry);
  }

  return containerIds;
}

function readEventStringArray(value: unknown): string[] {
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
    readEventStringArray(Reflect.get(event, "containerIds")),
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
  private readonly socketsBySessionKey = new Map<string, Set<WsConnection>>();
  private readonly socketsByUserId = new Map<string, Set<WsConnection>>();
  private readonly socketsByContainerId = new Map<string, Set<WsConnection>>();
  private readonly interestBySocket = new Map<WsConnection, Set<string>>();

  open(ws: WsConnection): void {
    addToIndex(this.socketsBySessionKey, socketSessionKey(ws), ws);
    addToIndex(this.socketsByUserId, ws.data.userId, ws);
    if (!this.interestBySocket.has(ws)) {
      this.interestBySocket.set(ws, new Set());
    }
  }

  close(ws: WsConnection): void {
    removeFromIndex(this.socketsBySessionKey, socketSessionKey(ws), ws);
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
    const parsed = parseClientJsonObject(rawMessage);
    if (!parsed) {
      return null;
    }
    const containerIds = readContainerIdArray(
      Reflect.get(parsed, "containerIds"),
    );
    if (!containerIds) {
      return null;
    }
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
   * so it routes correctly before (or without) the client re-declaring. Uses
   * union (add) semantics, NOT replace: hydration is awaited asynchronously in
   * `open`, during which a client `known_containers.add` may already have
   * declared live interest. Replacing would discard that just-declared interest
   * until the client noticed and re-sent it. No I/O (the caller loads the
   * persisted set and keeps the router pure).
   */
  hydrateInterest(ws: WsConnection, containerIds: string[]): void {
    this.addInterest(ws, containerIds);
  }

  /**
   * Route one event. Returns the interest evictions an access-change caused, so
   * the impure shell can mirror them into the persisted set (otherwise a
   * reconnect would re-hydrate an interest the access change just dropped).
   * Non-access events return no evictions.
   */
  routeServerEvent(rawMessage: string): InterestEviction[] {
    const event = parseJsonObject(rawMessage);
    if (!event) {
      return [];
    }
    if (Reflect.get(event, "type") === SESSION_REVOKED) {
      this.handleSessionRevoked(event);
      return [];
    }
    if (Reflect.get(event, "type") === ACCESS_CHANGED) {
      return this.handleAccessChanged(event);
    }
    for (const ws of this.recipientsForEvent(event)) {
      sendSafely(ws, rawMessage);
    }
    return [];
  }

  /**
   * A container's access changed (share/revoke/rekey/move/delete). Tell every
   * socket interested in it to resync and drop it from their interest, so no
   * further events for that container reach them until they reconcile over HTTP
   * and (if still authorized) re-declare it. This uses only the process-local
   * interest index — no member resolution — and over-evicts harmlessly: still-
   * authorized members simply re-add the container after their resync. The
   * returned evictions must also be persisted so a reconnect does not restore
   * the dropped interest.
   */
  private handleAccessChanged(
    event: Record<string, unknown>,
  ): InterestEviction[] {
    const containerId = readStringField(Reflect.get(event, "containerId"));
    if (!containerId) {
      return [];
    }
    const interested = this.socketsByContainerId.get(containerId);
    if (!interested) {
      return [];
    }
    const resync = JSON.stringify({ containerId, type: RESYNC_REQUIRED });
    const evictions: InterestEviction[] = [];
    for (const ws of [...interested]) {
      sendSafely(ws, resync);
      this.removeInterest(ws, [containerId]);
      evictions.push({
        containerId,
        sessionId: ws.data.sessionId,
        userId: ws.data.userId,
      });
    }
    return evictions;
  }

  private handleSessionRevoked(event: Record<string, unknown>): void {
    const sessionId = readStringField(Reflect.get(event, "sessionId"));
    const userId = readStringField(Reflect.get(event, "userId"));
    if (!sessionId || !userId) {
      return;
    }

    const sockets = this.socketsBySessionKey.get(sessionKey(userId, sessionId));
    if (!sockets) {
      return;
    }

    for (const ws of [...sockets]) {
      closeSafely(ws, SESSION_REVOKED_CLOSE_CODE, SESSION_REVOKED_CLOSE_REASON);
      this.close(ws);
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

function sessionKey(userId: string, sessionId: string): string {
  return `${userId}:${sessionId}`;
}

function socketSessionKey(ws: WsConnection): string {
  return sessionKey(ws.data.userId, ws.data.sessionId);
}

function closeSafely(ws: WsConnection, code: number, reason: string): void {
  try {
    ws.close?.(code, reason);
  } catch {
    // A broken/closing socket must not block revocation for the others.
  }
}

function sendSafely(ws: WsConnection, message: string): void {
  try {
    ws.send(message);
  } catch {
    // A broken/closing socket must not block delivery to the other recipients.
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

function parseClientJsonObject(
  rawMessage: string,
): Record<string, unknown> | null {
  if (rawMessage.length > MAX_CLIENT_MESSAGE_BYTES) {
    return null;
  }
  return parseJsonObject(rawMessage);
}
