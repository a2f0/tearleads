import { bytesToBase64 } from "@symcrypt/encoding";
import { createDocument, exportAllUpdates } from "@symcrypt/loro";

export {
  deriveOrganizationMetadataContainerSystemSlot,
  deriveOrganizationRosterProfileContainerSystemSlot,
} from "@symcrypt/validators/containerSystemSlot";

import { getScopedPeerSeed } from "../../data/crdtPeerSeed";
import {
  initializeStoredDocumentKind,
  writeStoredDocumentFields,
} from "../../data/documents/documentKinds";
import { DOCUMENTS_APP_KIND } from "../../data/persistence/documents/documentsPersistence";

export const ORGANIZATION_ROSTER_PROFILE_CONTAINER_NAME = "Roster Profiles";
export const ROSTER_PROFILE_DOCUMENT_KIND = "contact";

// Dedicated container for org-wide public metadata (the organization display
// name today; logo/color later). Distinct from the Admins-scoped roster profile
// container so it can be granted read to the reserved Members group without
// exposing the founder's private roster PII.
export const ORGANIZATION_METADATA_CONTAINER_NAME = "Organization Metadata";

// The self roster-profile nickname seeded at registration when the caller does
// not override it. The demo host passes each pane's peer-labeled self name
// instead (e.g. "Peer 1 (You)").
export const DEFAULT_ROSTER_PROFILE_SELF_NICKNAME = "You";

export function getRosterProfileDocumentLocalId(input: {
  readonly organizationId: string;
  readonly userId: string;
}): string {
  return `org-profile:${input.organizationId}:${input.userId}`;
}

export function buildRosterProfileDocumentPatch(input: {
  readonly encapsulationPublicKey: string;
  readonly isSelf: boolean;
  readonly userId: string;
}): Record<string, string | undefined> {
  return {
    encapsulationPublicKey: input.encapsulationPublicKey,
    isSelf: input.isSelf ? "1" : "0",
    userId: input.userId,
  };
}

export async function createInitializedRosterProfileDocument(input: {
  readonly encapsulationPublicKey: string;
  readonly isSelf: boolean;
  readonly nickname?: string | undefined;
  readonly userId: string;
}): Promise<{
  readonly initialUpdate: Uint8Array;
  readonly snapshot: string;
}> {
  const doc = await createDocument(await getScopedPeerSeed(DOCUMENTS_APP_KIND));
  initializeStoredDocumentKind(doc, ROSTER_PROFILE_DOCUMENT_KIND);
  writeStoredDocumentFields(doc, ROSTER_PROFILE_DOCUMENT_KIND, {
    ...buildRosterProfileDocumentPatch(input),
    ...(input.nickname ? { nickname: input.nickname } : {}),
  });

  const initialUpdate = exportAllUpdates(doc);

  return {
    initialUpdate,
    snapshot: bytesToBase64(initialUpdate),
  };
}
