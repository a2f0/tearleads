import {
  parseWsClientDeclaration,
  serializeWsServerMessage,
  type WsInvalidationHint,
} from "@tearleads/validators/realtime";
import {
  type PublishedRealtimeEvent,
  parsePublishedRealtimeEvent,
} from "./publishedRealtimeEvents";
import {
  closeSafely,
  isSameSession,
  sendSafely,
  sessionKey,
  socketSessionKey,
  type WsConnection,
} from "./wsConnection";
import {
  type OrganizationInterestDeclaration,
  WsOrganizationRouter,
} from "./wsOrganizationRouting";

export type { WsConnection } from "./wsConnection";

const SESSION_REVOKED_CLOSE_CODE = 1008;
const SESSION_REVOKED_CLOSE_REASON = "Session revoked";

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

type PublishedHintEvent = Extract<
  PublishedRealtimeEvent,
  { type: WsInvalidationHint["type"] }
>;

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
 * Containers a hint is scoped to. Document hints already carry the linked
 * container set resolved during sync; container hints carry the container plus
 * its (previous) parent so a parent's watchers learn about child changes. The
 * router only delivers to sockets that declared interest in one of these.
 */
function hintContainerIds(event: PublishedHintEvent): string[] {
  switch (event.type) {
    case "document_mutation_created":
    case "document_update_created":
      return [...new Set(event.containerIds)];
    case "container_mutation_created":
      return [
        ...new Set(
          [event.containerId, event.parentId, event.previousParentId].filter(
            (containerId): containerId is string => !!containerId,
          ),
        ),
      ];
    case "shared_with_you":
    case "user_registered":
      return [];
  }
}

/**
 * Rebuild the client frame from the shared public schema. The parsed event may
 * carry internal routing metadata (the authoring session `origin`, which holds
 * a per-session identifier that must not leak to clients); reconstructing from
 * the typed hint is what keeps it off the websocket boundary.
 */
function publicHint(event: PublishedHintEvent): WsInvalidationHint {
  const { origin: _origin, ...hint } = event;
  return hint;
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
 * connected here and interested in the event's containers, reconstructing the
 * minimal client payload from the shared frame schemas. Malformed and unknown
 * published events fail closed and route nowhere. Socket handles never leave
 * the process.
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
    const declaration = parseWsClientDeclaration(rawMessage);
    if (!declaration) {
      return null;
    }
    switch (declaration.type) {
      case "known_containers": {
        const containerIds = declaration.containerIds ?? [];
        this.replaceInterest(ws, containerIds);
        return containerInterestAction(
          "replace",
          containerIds,
          declaration.declarationId,
        );
      }
      case "known_containers.add": {
        const containerIds = declaration.containerIds ?? [];
        this.addInterest(ws, containerIds);
        return containerInterestAction(
          "add",
          containerIds,
          declaration.declarationId,
        );
      }
      case "known_containers.remove": {
        const containerIds = declaration.containerIds ?? [];
        this.removeInterest(ws, containerIds);
        return containerInterestAction(
          "remove",
          containerIds,
          declaration.declarationId,
        );
      }
      case "known_organizations":
        // Unlike container interest, an organization declaration is not
        // applied here. The gateway must authorize the authenticated socket
        // against the requested organization first, then call
        // applyAuthorizedOrganizationInterest.
        return {
          declarationId: declaration.declarationId,
          kind: "organization-replace",
          organizationId: declaration.organizationIds[0] ?? null,
        };
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
   * Route one published event. Returns the interest evictions an access-change
   * caused, so the impure shell can mirror them into the persisted set
   * (otherwise a reconnect would re-hydrate an interest the access change just
   * dropped). Non-access events return no evictions.
   */
  routeServerEvent(rawMessage: string): InterestEviction[] {
    const event = parsePublishedRealtimeEvent(rawMessage);
    if (!event) {
      return [];
    }
    switch (event.type) {
      case "session_revoked":
        this.handleSessionRevoked(event.userId, event.sessionId);
        return [];
      case "access_changed":
        return this.handleAccessChanged(event.containerId);
      case "organization_read_model_changed":
        this.organizationRouter.routeReadModelChanged(event);
        return [];
      default:
        this.routeHint(event);
        return [];
    }
  }

  private routeHint(event: PublishedHintEvent): void {
    // Resolve recipients before serializing. Redis fans every event to every
    // API process, but most processes hold no socket interested in a given
    // event's containers; returning early there skips the reconstruction
    // entirely on the common no-recipient path.
    const recipients = this.recipientsForHint(event);
    if (recipients.size === 0) {
      return;
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
    const origin = event.origin ?? null;
    const clientMessage = serializeWsServerMessage(publicHint(event));
    for (const ws of recipients) {
      if (origin && isSameSession(ws, origin)) {
        continue;
      }
      sendSafely(ws, clientMessage);
    }
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
  private handleAccessChanged(containerId: string): InterestEviction[] {
    const interested = this.socketsByContainerId.get(containerId);
    if (!interested) {
      return [];
    }
    const resync = serializeWsServerMessage({
      containerId,
      type: "resync_required",
    });
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

  private handleSessionRevoked(userId: string, sessionId: string): void {
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

  private recipientsForHint(event: PublishedHintEvent): Set<WsConnection> {
    const recipients = new Set<WsConnection>();
    const containerIds = hintContainerIds(event);
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
    if (event.type === "shared_with_you" || event.type === "user_registered") {
      for (const ws of this.socketsByUserId.get(event.userId) ?? []) {
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
