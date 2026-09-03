import {
  parseWsServerMessage,
  type WsInvalidationHint,
} from "@tearleads/validators/realtime";

/**
 * Route one incoming frame through the shared schema-derived server-message
 * union. Malformed and unknown frames fail closed and are dropped.
 */
export function routeIncomingWsMessage(
  rawData: string,
  handlers: {
    onContainerInterestAcknowledged: (declarationId: string) => void;
    onInterestState: (baseline: string[]) => void;
    onOrganizationInterestAcknowledged: (
      declarationId: string,
      organizationId: string | null,
      authorized: boolean,
    ) => void;
    onOrganizationReadModelChanged: (
      organizationId: string,
      originatedFromSession: boolean,
    ) => void;
    onResyncRequired: (containerId: string) => void;
    onSharedWithYou: () => void;
    onServerEvent: (event: WsInvalidationHint) => void;
  },
): void {
  const message = parseWsServerMessage(rawData);
  if (!message) {
    return;
  }

  switch (message.type) {
    case "interest_state":
      handlers.onInterestState(message.containerIds);
      return;
    case "known_containers_ack":
      handlers.onContainerInterestAcknowledged(message.declarationId);
      return;
    case "known_organizations_ack":
      handlers.onOrganizationInterestAcknowledged(
        message.declarationId,
        message.organizationId,
        message.authorized,
      );
      return;
    case "resync_required":
      handlers.onResyncRequired(message.containerId);
      return;
    case "organization_read_model_changed":
      handlers.onOrganizationReadModelChanged(
        message.organizationId,
        message.originatedFromSession,
      );
      return;
    case "organization_read_model_access_revoked":
      handlers.onOrganizationReadModelChanged(message.organizationId, false);
      return;
    // The share carries no container id (the recipient does not know the
    // container yet, so it is routed by user, not interest); the client reacts
    // by re-listing root containers.
    case "shared_with_you":
      handlers.onSharedWithYou();
      return;
    default:
      handlers.onServerEvent(message);
  }
}
