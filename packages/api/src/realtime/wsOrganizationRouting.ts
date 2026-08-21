import { isPlainObject } from "@symcrypt/validators/isPlainObject";
import { isUuidV4String } from "@symcrypt/validators/util";
import {
  isSameSession,
  readOrigin,
  sendSafely,
  type WsConnection,
} from "./wsConnection";

export const KNOWN_ORGANIZATIONS_REPLACE = "known_organizations";
export const KNOWN_ORGANIZATIONS_ACK = "known_organizations_ack";
export const ORGANIZATION_READ_MODEL_CHANGED =
  "organization_read_model_changed";
const ORGANIZATION_READ_MODEL_ACCESS_REVOKED =
  "organization_read_model_access_revoked";

export type OrganizationInterestDeclaration = {
  readonly declarationId: string;
  readonly kind: "organization-replace";
  readonly organizationId: string | null;
};

export function readOrganizationInterest(
  value: unknown,
): string | null | undefined {
  if (!Array.isArray(value) || value.length > 1) {
    return undefined;
  }
  if (value.some((entry) => !isUuidV4String(entry))) {
    return undefined;
  }
  return value[0] ?? null;
}

export interface OrganizationReadModelAudience {
  readonly organizationId: string;
  readonly recipientUserIds: ReadonlySet<string>;
}

function readOrganizationReadModelAudience(
  event: Record<string, unknown>,
): OrganizationReadModelAudience | null {
  const organizationId = Reflect.get(event, "organizationId");
  const recipientUserIds = Reflect.get(event, "recipientUserIds");
  if (
    typeof organizationId !== "string" ||
    !isUuidV4String(organizationId) ||
    !Array.isArray(recipientUserIds) ||
    recipientUserIds.some(
      (userId) => typeof userId !== "string" || !isUuidV4String(userId),
    )
  ) {
    return null;
  }
  return { organizationId, recipientUserIds: new Set(recipientUserIds) };
}

/** Parse the trusted internal audience used to revalidate a denied interest. */
export function readOrganizationReadModelAudienceMessage(
  rawMessage: string,
): OrganizationReadModelAudience | null {
  let event: unknown;
  try {
    event = JSON.parse(rawMessage);
  } catch {
    return null;
  }
  return isPlainObject(event) &&
    Reflect.get(event, "type") === ORGANIZATION_READ_MODEL_CHANGED
    ? readOrganizationReadModelAudience(event)
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
   * Route only through the authoritative internal audience. Missing or
   * malformed audiences fail closed, and client frames are reconstructed so
   * neither the audience nor authoring origin crosses the websocket boundary.
   */
  routeReadModelChanged(event: Record<string, unknown>): void {
    const audience = readOrganizationReadModelAudience(event);
    if (!audience) {
      return;
    }
    const interested = this.socketsByOrganizationId.get(
      audience.organizationId,
    );
    if (!interested) {
      return;
    }
    const origin = readOrigin(event);
    const revokedMessage = JSON.stringify({
      type: ORGANIZATION_READ_MODEL_ACCESS_REVOKED,
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
          JSON.stringify({
            type: ORGANIZATION_READ_MODEL_CHANGED,
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
