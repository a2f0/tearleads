import {
  type ContainerNode,
  type DocumentSummary,
  deriveStableDocumentId,
  syncedContainerDocumentObjectSyncState,
} from "@tearleads/client-sdk";
import type { SelfContactIdentityView } from "../../../stores/contacts/currentSelfContactIdentityState";
import { getSelfContactLocalId } from "../../../stores/contacts/selfContact";
import { createExplorerContainerRulesContext } from "./containerRules";

const SELF_IDENTITY_FINGERPRINT = "explorer-canonical-me";
export const SELF_IDENTITY_UPDATED_AT = "2026-06-01T00:00:00.000Z";

export const selfIdentityNodes: ReadonlyArray<ContainerNode> = [
  "contacts",
  "trash",
  "linked-folder",
  "destination",
].map((id) => ({
  id,
  kind: "container",
  name: id,
  organizationId: "identity-org",
  parentId: null,
  effectiveAccessLevel: "write",
  systemSlot:
    id === "contacts" ? "contacts-slot" : id === "trash" ? "trash-slot" : null,
  syncState: syncedContainerDocumentObjectSyncState,
}));

export async function createReadySelfIdentity(
  isCurrent: () => boolean = () => true,
): Promise<Extract<SelfContactIdentityView, { status: "ready" }>> {
  const localId = getSelfContactLocalId(SELF_IDENTITY_FINGERPRINT);
  return {
    status: "ready",
    identity: {
      documentId: await deriveStableDocumentId(localId),
      localId,
      localIds: new Set([localId]),
    },
    isCurrent,
  };
}

export function createSelfIdentityRules(
  selfContactIdentity: SelfContactIdentityView,
  currentSelfContactLocalId = getSelfContactLocalId(SELF_IDENTITY_FINGERPRINT),
) {
  // A variable permits the new view before production consumes it, without a
  // cast. The old authority fields only keep the pre-fix input type satisfied.
  const input = {
    contactsContainerId: "contacts",
    contactsSystemSlot: "contacts-slot",
    currentOrganizationId: "identity-org",
    currentSelfContactLocalId,
    currentSigningFingerprint: SELF_IDENTITY_FINGERPRINT,
    selfContactIdentity,
    trashSystemSlot: "trash-slot",
  };
  return createExplorerContainerRulesContext(input);
}

export function identityDocument(
  overrides: Partial<DocumentSummary> = {},
): DocumentSummary {
  return {
    id: "ordinary-local",
    documentId: "ordinary-document",
    documentKind: "note",
    containerId: "linked-folder",
    effectiveAccessLevel: "write",
    title: "Document",
    updatedAt: SELF_IDENTITY_UPDATED_AT,
    ...overrides,
  };
}
