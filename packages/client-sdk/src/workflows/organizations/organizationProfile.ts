import { bytesToBase64 } from "@tearleads/encoding";
import { createDocument, exportAllUpdates } from "@tearleads/loro";
import { getScopedPeerSeed } from "../../data/crdtPeerSeed";
import {
  initializeStoredDocumentKind,
  writeStoredDocumentFields,
} from "../../data/documents/documentKinds";
import { DOCUMENTS_APP_KIND } from "../../data/persistence/documents/documentsPersistence";

export const ORGANIZATION_PROFILE_DOCUMENT_KIND = "organization_profile";
export const DEFAULT_PERSONAL_ORGANIZATION_PROFILE_NAME = "Personal Org";

export function getOrganizationProfileDocumentLocalId(input: {
  readonly organizationId: string;
}): string {
  return `org-profile:${input.organizationId}`;
}

export function getOrganizationProfileDocumentPatch(input: {
  readonly name: string;
}): Record<string, string | undefined> {
  return {
    name: input.name.trim(),
  };
}

export async function createInitializedOrganizationProfileDocument(input: {
  readonly name: string;
}): Promise<{
  readonly initialUpdate: Uint8Array;
  readonly snapshot: string;
}> {
  const doc = await createDocument(getScopedPeerSeed(DOCUMENTS_APP_KIND));
  initializeStoredDocumentKind(doc, ORGANIZATION_PROFILE_DOCUMENT_KIND);
  writeStoredDocumentFields(
    doc,
    ORGANIZATION_PROFILE_DOCUMENT_KIND,
    getOrganizationProfileDocumentPatch({ name: input.name }),
  );

  const initialUpdate = exportAllUpdates(doc);

  return {
    initialUpdate,
    snapshot: bytesToBase64(initialUpdate),
  };
}

export function readOrganizationProfileName(
  structuredFields: Readonly<Record<string, unknown>>,
): string | null {
  const value = Reflect.get(structuredFields, "name");

  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}
