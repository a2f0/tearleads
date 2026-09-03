import { serializeWsServerMessage } from "@tearleads/validators/realtime";
import {
  type PublishedOrganizationReadModelChangedEvent,
  parsePublishedRealtimeEvent,
} from "./publishedRealtimeEvents";
import { isSameSession, sendSafely, type WsConnection } from "./wsConnection";

export type OrganizationInterestDeclaration = {
  readonly declarationId: string;
  readonly kind: "organization-replace";
  readonly organizationId: string | null;
};

export interface OrganizationReadModelAudience {
  readonly organizationId: string;
  readonly recipientUserIds: ReadonlySet<string>;
}

function organizationReadModelAudience(
  event: PublishedOrganizationReadModelChangedEvent,
): OrganizationReadModelAudience {
  return {
    organizationId: event.organizationId,
    recipientUserIds: new Set(event.recipientUserIds),
  };
}

/** Parse the trusted internal audience used to revalidate a denied interest. */
export function readOrganizationReadModelAudienceMessage(
  rawMessage: string,
): OrganizationReadModelAudience | null {
  const event = parsePublishedRealtimeEvent(rawMessage);
  return event?.type === "organization_read_model_changed"
    ? organizationReadModelAudience(event)
    : null;
}

function addToIndex(
  index: Map<string, Set<WsConnection>>,
  key: string,
  ws: WsConnection,
): void {
  const existing = index.get(key);
  if (existing) {
    existing.add(ws);
  } else {
    index.set(key, new Set([ws]));
  }
}

function removeFromIndex(
  index: Map<string, Set<WsConnection>>,
  key: string,
  ws: WsConnection,
): void {
  const existing = index.get(key);
  existing?.delete(ws);
  if (existing?.size === 0) {
    index.delete(key);
  }
}

/** Process-local, authorized organization-interest routing. */
export class WsOrganizationRouter {
  private readonly socketsByOrganizationId = new Map<
    string,
    Set<WsConnection>
  >();
  private readonly interestBySocket = new Map<WsConnection, Set<string>>();
  private readonly absentAudienceBySocket = new Map<
    WsConnection,
    Set<string>
  >();

  open(ws: WsConnection): void {
    if (!this.interestBySocket.has(ws)) {
      this.interestBySocket.set(ws, new Set());
    }
    if (!this.absentAudienceBySocket.has(ws)) {
      this.absentAudienceBySocket.set(ws, new Set());
    }
  }

  close(ws: WsConnection): void {
    for (const organizationId of this.interestBySocket.get(ws) ?? []) {
      removeFromIndex(this.socketsByOrganizationId, organizationId, ws);
    }
    this.interestBySocket.delete(ws);
    this.absentAudienceBySocket.delete(ws);
  }

  applyAuthorizedInterest(
    ws: WsConnection,
    organizationId: string | null,
  ): void {
    const previous = this.interestBySocket.get(ws);
    if (!previous) {
      return;
    }
    for (const previousOrganizationId of previous) {
      removeFromIndex(this.socketsByOrganizationId, previousOrganizationId, ws);
    }
    const next = new Set(organizationId ? [organizationId] : []);
    this.interestBySocket.set(ws, next);
    this.absentAudienceBySocket.set(ws, new Set());
    if (organizationId) {
      addToIndex(this.socketsByOrganizationId, organizationId, ws);
    }
  }

  /**
   * Route only through the authoritative internal audience. Client frames are
   * reconstructed from the shared public schema so neither the audience nor
   * the authoring origin crosses the websocket boundary.
   */
  routeReadModelChanged(
    event: PublishedOrganizationReadModelChangedEvent,
  ): void {
    const audience = organizationReadModelAudience(event);
    const interested = this.socketsByOrganizationId.get(
      audience.organizationId,
    );
    if (!interested) {
      return;
    }
    const origin = event.origin ?? null;
    const revokedMessage = serializeWsServerMessage({
      type: "organization_read_model_access_revoked",
      organizationId: audience.organizationId,
    });
    for (const ws of [...interested]) {
      const absent = this.absentAudienceBySocket.get(ws) ?? new Set<string>();
      this.absentAudienceBySocket.set(ws, absent);
      if (audience.recipientUserIds.has(ws.data.userId)) {
        absent.delete(audience.organizationId);
        // Author echoes are deliberate: one session can own multiple clients.
        sendSafely(
          ws,
          serializeWsServerMessage({
            type: "organization_read_model_changed",
            organizationId: audience.organizationId,
            originatedFromSession: origin ? isSameSession(ws, origin) : false,
          }),
        );
      } else if (!absent.has(audience.organizationId)) {
        absent.add(audience.organizationId);
        sendSafely(ws, revokedMessage);
      }
    }
  }
}
