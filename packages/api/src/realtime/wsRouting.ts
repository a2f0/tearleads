import { isPlainObject } from "@tearleads/validators/isPlainObject";
import { isUuidV4String } from "@tearleads/validators/util";
import {
  closeSafely,
  isSameSession,
  readOrigin,
  sendSafely,
  sessionKey,
  socketSessionKey,
  type WsConnection,
} from "./wsConnection";
import {
  KNOWN_ORGANIZATIONS_REPLACE,
  ORGANIZATION_READ_MODEL_CHANGED,
  type OrganizationInterestDeclaration,
  readOrganizationInterest,
  WsOrganizationRouter,
} from "./wsOrganizationRouting";

export type { WsConnection } from "./wsConnection";

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
const MAX_DECLARATION_ID_LENGTH = 128;

/**
 * The interest change a client message applied, returned to the impure shell so
 * it can mirror the change into Redis. Null for malformed or unrelated messages.
 */
export type AppliedInterest = {
  readonly declarationId?: string | undefined;
  readonly kind: "replace" | "add" | "remove";
  readonly containerIds: string[];
} | null;

type ClientMessageAction =
  | Exclude<AppliedInterest, null>
  | OrganizationInterestDeclaration
  | null;

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

function readDeclarationId(value: unknown): string | null {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_DECLARATION_ID_LENGTH
    ? value
    : null;
}

function readOptionalDeclarationId(value: unknown): string | null | undefined {
  return value === undefined ? undefined : readDeclarationId(value);
}

function containerInterestAction(
  kind: Exclude<AppliedInterest, null>["kind"],
  containerIds: string[],
  declarationId: string | undefined,
): Exclude<AppliedInterest, null> {
  return declarationId
    ? { containerIds, declarationId, kind }
    : { containerIds, kind };
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

/**
 * Re-serialize the event without its `origin` field. `origin` is internal
 * server-to-server routing data — it carries a per-session identifier that must
 * not leak to clients, and clients have no use for it. Done with a destructuring
 * rest rather than `delete` to avoid mutating the parsed event the caller still
 * holds.
 */
function stripOrigin(event: Record<string, unknown>): string {
  const { origin: _origin, ...rest } = event;
  return JSON.stringify(rest);
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
  private readonly organizationRouter = new WsOrganizationRouter();

  open(ws: WsConnection): void {
    addToIndex(this.socketsBySessionKey, socketSessionKey(ws), ws);
    addToIndex(this.socketsByUserId, ws.data.userId, ws);
    if (!this.interestBySocket.has(ws)) {
      this.interestBySocket.set(ws, new Set());
    }
    this.organizationRouter.open(ws);
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
    this.organizationRouter.close(ws);
  }

  handleClientMessage(
    ws: WsConnection,
    rawMessage: string,
  ): ClientMessageAction {
    const parsed = parseClientJsonObject(rawMessage);
    if (!parsed) {
      return null;
    }
    const declarationId = readOptionalDeclarationId(
      Reflect.get(parsed, "declarationId"),
    );
    if (declarationId === null) {
      return null;
    }
    switch (Reflect.get(parsed, "type")) {
      case KNOWN_CONTAINERS_REPLACE: {
        const containerIds = readContainerIdArray(
          Reflect.get(parsed, "containerIds"),
        );
        if (!containerIds) {
          return null;
        }
        this.replaceInterest(ws, containerIds);
        return containerInterestAction("replace", containerIds, declarationId);
      }
      case KNOWN_CONTAINERS_ADD: {
        const containerIds = readContainerIdArray(
          Reflect.get(parsed, "containerIds"),
        );
        if (!containerIds) {
          return null;
        }
        this.addInterest(ws, containerIds);
        return containerInterestAction("add", containerIds, declarationId);
      }
      case KNOWN_CONTAINERS_REMOVE: {
        const containerIds = readContainerIdArray(
          Reflect.get(parsed, "containerIds"),
        );
        if (!containerIds) {
          return null;
        }
        this.removeInterest(ws, containerIds);
        return containerInterestAction("remove", containerIds, declarationId);
      }
      case KNOWN_ORGANIZATIONS_REPLACE: {
        const organizationId = readOrganizationInterest(
          Reflect.get(parsed, "organizationIds"),
        );
        if (!declarationId || organizationId === undefined) {
          return null;
        }
        // Unlike container interest, an organization declaration is not
        // applied here. The gateway must authorize the authenticated socket
        // against the requested organization first, then call
        // applyAuthorizedOrganizationInterest.
        return {
          declarationId,
          kind: "organization-replace",
          organizationId,
        };
      }
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
   * Apply a gateway-authorized organization declaration. A null organization
   * clears interest immediately. Closed sockets are absent from the interest
   * map, so a late authorization result cannot re-index one after close.
   */
  applyAuthorizedOrganizationInterest(
    ws: WsConnection,
    organizationId: string | null,
  ): void {
    this.organizationRouter.applyAuthorizedInterest(ws, organizationId);
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
    if (Reflect.get(event, "type") === ORGANIZATION_READ_MODEL_CHANGED) {
      this.organizationRouter.routeReadModelChanged(event);
      return [];
    }
    // Resolve recipients before touching `origin`. Redis fans every event to
    // every API process, but most processes hold no socket interested in a
    // given event's containers; returning early there skips the origin parse
    // and re-serialization below entirely on the common no-recipient path.
    const recipients = this.recipientsForEvent(event);
    if (recipients.size === 0) {
      return [];
    }
    // The authoring session is identified by `origin` (added by the publisher
    // on the HTTP sync path). We skip that exact socket so the author does not
    // receive its own update echoed back over its own connection. Matching is
    // on (userId, sessionId) — globally unique — NOT a socket handle, so it
    // works even though redis fanned this event in from another API process and
    // the authoring socket may be connected here. Per-SESSION, never per-user:
    // the author's other devices/tabs are distinct sessions and must still
    // receive the event so they sync. Absent `origin` (e.g. attachment-bind
    // events) means "exclude nobody" — every interested socket gets it.
    const origin = readOrigin(event);
    // `rawMessage` carries `origin`, which includes a sensitive sessionId.
    // Strip it on PRESENCE of the key, not on whether it parsed into a valid
    // identity: a malformed origin (e.g. a sessionId with no userId) makes
    // readOrigin return null but the sessionId is still in the payload, so
    // gating the strip on `origin` would forward `rawMessage` and leak it.
    // Stripping is about not exposing the field; exclusion below is what needs
    // a valid identity.
    const clientMessage = Reflect.has(event, "origin")
      ? stripOrigin(event)
      : rawMessage;
    for (const ws of recipients) {
      if (origin && isSameSession(ws, origin)) {
        continue;
      }
      sendSafely(ws, clientMessage);
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
