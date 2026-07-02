import { bytesToBase64 } from "@tearleads/encoding";
import { createDocument, exportAllUpdates } from "@tearleads/loro";
import type { ContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import { getScopedPeerSeed } from "../../data/crdtPeerSeed";
import {
  initializeStoredDocumentKind,
  writeStoredDocumentFields,
} from "../../data/documents/documentKinds";
import { DOCUMENTS_APP_KIND } from "../../data/persistence/documents/documentsPersistence";

const CONTAINER_SYSTEM_SLOT_PREFIX = "sys_v1_";

export const ORGANIZATION_ROSTER_PROFILE_CONTAINER_NAME = "Roster Profiles";
export const ROSTER_PROFILE_DOCUMENT_KIND = "contact";

// The self roster-profile nickname seeded at registration when the caller does
// not override it. The demo host passes each pane's peer-labeled self name
// instead (e.g. "Peer 1 (You)").
export const DEFAULT_ROSTER_PROFILE_SELF_NICKNAME = "You";

function toBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export async function deriveOrganizationRosterProfileContainerSystemSlot(input: {
  readonly organizationId: string;
}): Promise<ContainerSystemSlot> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      JSON.stringify({
        namespace: "tearleads.organization-roster-profiles",
        organizationId: input.organizationId,
        version: 1,
      }),
    ),
  );

  return `${CONTAINER_SYSTEM_SLOT_PREFIX}${toBase64Url(
    new Uint8Array(digest),
  )}`;
}

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
