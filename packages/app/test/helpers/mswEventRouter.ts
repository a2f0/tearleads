import { isUuidV4String } from "@symcrypt/validators/util";

export interface MswSocketClient {
  addEventListener?: (
    type: "close" | "message",
    listener: (event: { data?: unknown }) => void,
  ) => void;
  send: (data: string) => void;
  url?: URL | string;
}

interface MswSocketIdentity {
  sessionId: string;
  userId: string;
}

type MswServerEventPredicate = (event: Record<string, unknown>) => boolean;

interface MswEventDropRule {
  droppedCount: number;
  predicate: MswServerEventPredicate;
  remainingCount: number;
}

const eventDropRules: MswEventDropRule[] = [];

/**
 * Test-only fault injection for the MSW websocket router.
 *
 * The production sync contract must tolerate a missed websocket invalidation:
 * websocket events are hints to pull, not the durable source of document data.
 * Regression tests use this hook to drop one matching server event after the
 * writer has successfully committed over HTTP, then assert an explicit refresh
 * or open path can still recover the committed remote state.
 */
export function dropNextMswServerEventWhere(
  predicate: MswServerEventPredicate,
): () => number {
  const rule: MswEventDropRule = {
    droppedCount: 0,
    predicate,
    remainingCount: 1,
  };
  eventDropRules.push(rule);
  return () => rule.droppedCount;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJsonRecord(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readContainerIdArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const containerIds: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || entry.length === 0) {
      return null;
    }
    containerIds.push(entry);
  }
  return containerIds;
}

function readOrganizationIdArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 1) {
    return null;
  }
  if (value.some((entry) => !isUuidV4String(entry))) {
    return null;
  }
  return value;
}

function readOrganizationDeclarationId(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= 128
    ? value
    : null;
}

function readOrganizationReadModelAudience(event: Record<string, unknown>): {
  organizationId: string;
  recipientUserIds: ReadonlySet<string>;
} | null {
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

function readStringField(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readEventContainerIds(event: Record<string, unknown>): string[] {
  const containerIds = new Set<string>();
  const scopedContainerIds = Reflect.get(event, "containerIds");
  if (Array.isArray(scopedContainerIds)) {
    for (const containerId of scopedContainerIds) {
      if (typeof containerId === "string" && containerId.length > 0) {
        containerIds.add(containerId);
      }
    }
  }
  for (const field of ["containerId", "parentId", "previousParentId"]) {
    const containerId = readStringField(Reflect.get(event, field));
    if (containerId) {
      containerIds.add(containerId);
    }
  }
  return [...containerIds];
}

/**
 * The authoring session an event came from, if the publisher tagged it. Mirrors
 * production `wsRouting.readOrigin`: a malformed or partial `origin` yields
 * null, which the router treats as "exclude nobody".
 */
function readEventOrigin(
  event: Record<string, unknown>,
): MswSocketIdentity | null {
  const origin = Reflect.get(event, "origin");
  if (!isRecord(origin)) {
    return null;
  }
  const userId = readStringField(Reflect.get(origin, "userId"));
  const sessionId = readStringField(Reflect.get(origin, "sessionId"));
  return userId && sessionId ? { sessionId, userId } : null;
}

/**
 * Re-serialize the event without its `origin` field, mirroring production
 * `wsRouting.stripOrigin`: `origin` is server-internal routing data carrying a
 * per-session identifier that must not reach clients. Stripped on PRESENCE of
 * the key (not on whether it parsed into a valid identity) so a malformed
 * origin cannot leak its sessionId either.
 */
function stripEventOrigin(event: Record<string, unknown>): string {
  const { origin: _origin, ...rest } = event;
  return JSON.stringify(rest);
}

function readTicketFromClientUrl(client: MswSocketClient): string | null {
  const rawUrl = client.url;
  if (!rawUrl) {
    return null;
  }
  try {
    const url = rawUrl instanceof URL ? rawUrl : new URL(rawUrl);
    return readStringField(url.searchParams.get("ticket"));
  } catch {
    return null;
  }
}

function shouldDropServerEvent(event: Record<string, unknown>): boolean {
  // Evaluate before access_changed/document routing so a test can suppress the
  // exact server event it is modeling as missed by the websocket transport.
  for (const [index, rule] of eventDropRules.entries()) {
    if (!rule.predicate(event)) {
      continue;
    }
    rule.droppedCount += 1;
    rule.remainingCount -= 1;
    if (rule.remainingCount <= 0) {
      eventDropRules.splice(index, 1);
    }
    return true;
  }

  return false;
}

/**
 * Test twin of the production `WsEventRouter` (packages/api/src/realtime/wsRouting.ts).
 * The routing semantics the budget tests measure must match production:
 *
 * - container-scoped events go to sockets that declared interest;
 * - organization read-model hints go only to sockets interested in that
 *   organization whose authenticated user is in the internal audience;
 * - scopeless events route by the event's `userId` to that user's own sockets
 *   (e.g. `shared_with_you`) and to nobody else;
 * - a non-organization event tagged with `origin` is NOT delivered to the
 *   exact authoring session (matched on userId+sessionId), so the author never
 *   receives its own echo — the author's other sessions still do;
 * - `origin` is stripped from the delivered payload.
 *
 * Socket identity comes from the same one-time ws-ticket the production
 * upgrade consumes: the connection URL carries `?ticket=`, resolved via the
 * injected `resolveTicketIdentity` (backed by the test API app's ticket store).
 * A socket whose ticket cannot be resolved (e.g. suites that stub the ws-ticket
 * route without the real API app) stays anonymous: it still receives
 * container-interest-routed events but never matches an organization audience,
 * origin, or user scope.
 */
export function createMswEventRouter(
  options: {
    resolveTicketIdentity?: (
      ticket: string,
    ) => Promise<MswSocketIdentity | null>;
  } = {},
) {
  const socketInterestByClient = new Map<MswSocketClient, Set<string>>();
  const organizationInterestByClient = new Map<
    MswSocketClient,
    string | null
  >();
  const absentOrganizationAudienceByClient = new Map<
    MswSocketClient,
    Set<string>
  >();
  const socketIdentityByClient = new Map<
    MswSocketClient,
    Promise<MswSocketIdentity | null>
  >();

  const resolveClientIdentity = (
    client: MswSocketClient,
  ): Promise<MswSocketIdentity | null> =>
    socketIdentityByClient.get(client) ?? Promise.resolve(null);

  const sendRawSocketEvent = (client: MswSocketClient, data: string): void => {
    try {
      client.send(data);
    } catch {
      socketInterestByClient.delete(client);
      organizationInterestByClient.delete(client);
      absentOrganizationAudienceByClient.delete(client);
      socketIdentityByClient.delete(client);
    }
  };

  const sendSocketEvent = (
    client: MswSocketClient,
    event: Record<string, unknown>,
  ): void => {
    sendRawSocketEvent(client, JSON.stringify(event));
  };

  const handleSocketInterestMessage = (
    client: MswSocketClient,
    rawMessage: string,
  ): void => {
    const message = readJsonRecord(rawMessage);
    if (!message) {
      return;
    }

    if (Reflect.get(message, "type") === "known_organizations") {
      const declarationId = readOrganizationDeclarationId(
        Reflect.get(message, "declarationId"),
      );
      const organizationIds = readOrganizationIdArray(
        Reflect.get(message, "organizationIds"),
      );
      if (!declarationId || !organizationIds) {
        return;
      }
      const organizationId = organizationIds[0] ?? null;
      organizationInterestByClient.set(client, organizationId);
      absentOrganizationAudienceByClient.set(client, new Set());
      // The proxied HTTP read-model route remains the authorization authority
      // in app tests. This transport twin acknowledges only after installing
      // the declaration, preserving the production catch-up/routing order.
      sendSocketEvent(client, {
        type: "known_organizations_ack",
        authorized: true,
        declarationId,
        organizationId,
      });
      return;
    }

    const containerIds = readContainerIdArray(
      Reflect.get(message, "containerIds"),
    );
    if (!containerIds) {
      return;
    }

    const current = socketInterestByClient.get(client) ?? new Set<string>();
    switch (Reflect.get(message, "type")) {
      case "known_containers":
        socketInterestByClient.set(client, new Set(containerIds));
        break;
      case "known_containers.add":
        for (const containerId of containerIds) {
          current.add(containerId);
        }
        socketInterestByClient.set(client, current);
        break;
      case "known_containers.remove":
        for (const containerId of containerIds) {
          current.delete(containerId);
        }
        socketInterestByClient.set(client, current);
        break;
    }
    const declarationId = readOrganizationDeclarationId(
      Reflect.get(message, "declarationId"),
    );
    if (declarationId) {
      // Production acknowledges only after the process-local router has
      // synchronously installed this exact declaration.
      sendSocketEvent(client, {
        type: "known_containers_ack",
        declarationId,
      });
    }
  };

  const handleAccessChangedEvent = (event: Record<string, unknown>): void => {
    const containerId = readStringField(Reflect.get(event, "containerId"));
    if (!containerId) {
      return;
    }

    for (const [client, interest] of socketInterestByClient) {
      if (!interest.has(containerId)) {
        continue;
      }
      interest.delete(containerId);
      sendSocketEvent(client, { containerId, type: "resync_required" });
    }
  };

  const handleOrganizationReadModelChanged = async (
    event: Record<string, unknown>,
  ): Promise<void> => {
    const audience = readOrganizationReadModelAudience(event);
    if (!audience) {
      return;
    }
    const origin = readEventOrigin(event);

    for (const [client, organizationId] of organizationInterestByClient) {
      if (organizationId !== audience.organizationId) {
        continue;
      }
      const identity = await resolveClientIdentity(client);
      if (!identity) {
        continue;
      }
      const absentOrganizations =
        absentOrganizationAudienceByClient.get(client) ?? new Set<string>();
      absentOrganizationAudienceByClient.set(client, absentOrganizations);
      if (audience.recipientUserIds.has(identity.userId)) {
        absentOrganizations.delete(audience.organizationId);
        // Organization author echoes are deliberate. Multiple app clients can
        // share one authenticated session, so session-wide origin suppression
        // would leave sibling clients stale.
        sendSocketEvent(client, {
          type: "organization_read_model_changed",
          organizationId: audience.organizationId,
          originatedFromSession:
            origin?.userId === identity.userId &&
            origin.sessionId === identity.sessionId,
        });
      } else if (!absentOrganizations.has(audience.organizationId)) {
        absentOrganizations.add(audience.organizationId);
        sendSocketEvent(client, {
          type: "organization_read_model_access_revoked",
          organizationId: audience.organizationId,
        });
      }
    }
  };

  return {
    clear: () => {
      eventDropRules.length = 0;
      socketInterestByClient.clear();
      organizationInterestByClient.clear();
      absentOrganizationAudienceByClient.clear();
      socketIdentityByClient.clear();
    },
    handleConnection: (client: MswSocketClient) => {
      socketInterestByClient.set(client, new Set());
      organizationInterestByClient.set(client, null);
      absentOrganizationAudienceByClient.set(client, new Set());
      const ticket = readTicketFromClientUrl(client);
      const resolveTicketIdentity = options.resolveTicketIdentity;
      socketIdentityByClient.set(
        client,
        ticket && resolveTicketIdentity
          ? resolveTicketIdentity(ticket).catch(() => null)
          : Promise.resolve(null),
      );
      client.addEventListener?.("message", (event) => {
        handleSocketInterestMessage(client, String(event.data ?? ""));
      });
      client.addEventListener?.("close", () => {
        socketInterestByClient.delete(client);
        organizationInterestByClient.delete(client);
        absentOrganizationAudienceByClient.delete(client);
        socketIdentityByClient.delete(client);
      });

      client.send(JSON.stringify({ type: "interest_state", containerIds: [] }));
    },
    publish: async (event: Record<string, unknown>): Promise<void> => {
      if (shouldDropServerEvent(event)) {
        return;
      }

      if (Reflect.get(event, "type") === "access_changed") {
        // Mirrors production handleAccessChanged: resync_required fans to every
        // interested socket with NO origin exclusion, and interest is dropped
        // until the client reconciles over HTTP and re-declares.
        handleAccessChangedEvent(event);
        return;
      }

      if (Reflect.get(event, "type") === "organization_read_model_changed") {
        await handleOrganizationReadModelChanged(event);
        return;
      }

      const containerIds = readEventContainerIds(event);
      const recipients: MswSocketClient[] = [];
      if (containerIds.length > 0) {
        for (const [client, interest] of socketInterestByClient) {
          if (containerIds.some((containerId) => interest.has(containerId))) {
            recipients.push(client);
          }
        }
      } else {
        // No container scope (e.g. shared_with_you): route by user scope, like
        // production recipientsForEvent — the event reaches only that user's
        // own sockets, or nobody when it carries no userId either.
        const userId = readStringField(Reflect.get(event, "userId"));
        if (userId) {
          for (const client of socketInterestByClient.keys()) {
            if ((await resolveClientIdentity(client))?.userId === userId) {
              recipients.push(client);
            }
          }
        }
      }
      if (recipients.length === 0) {
        return;
      }

      const origin = readEventOrigin(event);
      const clientMessage = Reflect.has(event, "origin")
        ? stripEventOrigin(event)
        : JSON.stringify(event);
      for (const client of recipients) {
        if (origin) {
          const identity = await resolveClientIdentity(client);
          if (
            identity &&
            identity.userId === origin.userId &&
            identity.sessionId === origin.sessionId
          ) {
            continue;
          }
        }
        sendRawSocketEvent(client, clientMessage);
      }
    },
  };
}
