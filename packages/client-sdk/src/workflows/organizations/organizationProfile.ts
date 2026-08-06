import { bytesToBase64 } from "@tearleads/encoding";
import { createDocument, exportAllUpdates } from "@tearleads/loro";
import { getScopedPeerSeed } from "../../data/crdtPeerSeed";
import {
  type DocumentProjectorRegistry,
  type DocumentProjectorRegistryInput,
  initializeStoredDocumentKind,
  resolveDocumentProjectorRegistry,
  writeStoredDocumentFields,
} from "../../data/documents/documentKinds";
import { DOCUMENTS_APP_KIND } from "../../data/persistence/documents/documentsPersistence";

export const ORGANIZATION_PROFILE_DOCUMENT_KIND = "organization_profile";
export const DEFAULT_PERSONAL_ORGANIZATION_PROFILE_NAME = "Personal Org";

// The title the pre-projection bootstrap wrote. A host that registers the
// org-profile projector derives its own title; a host that does not would
// otherwise fall through to the registry's generic untitled form.
const ORGANIZATION_PROFILE_FALLBACK_TITLE = "Organization Profile";

/**
 * Give the org-profile document its stable fallback title on hosts that do
 * not register the projector for this kind. Hosts that DO register it keep
 * full control: the registry passes through untouched. The wrap overrides
 * projection (which stamps the stored title) and the untitled lookup, and
 * changes nothing for any other document kind.
 */
export function withOrganizationProfileFallbackTitle(
  documentProjectors: DocumentProjectorRegistryInput | undefined,
): DocumentProjectorRegistry {
  const registry = resolveDocumentProjectorRegistry(documentProjectors);
  if (registry.getDefinition(ORGANIZATION_PROFILE_DOCUMENT_KIND)) {
    return registry;
  }

  return {
    ...registry,
    getUntitledDocumentTitle(kind) {
      return kind === ORGANIZATION_PROFILE_DOCUMENT_KIND
        ? ORGANIZATION_PROFILE_FALLBACK_TITLE
        : registry.getUntitledDocumentTitle(kind);
    },
    projectStoredDocumentState(input) {
      const state = registry.projectStoredDocumentState(input);
      return input.documentKind === ORGANIZATION_PROFILE_DOCUMENT_KIND
        ? { ...state, title: ORGANIZATION_PROFILE_FALLBACK_TITLE }
        : state;
    },
  };
}

export function getOrganizationProfileDocumentLocalId(input: {
  readonly organizationId: string;
}): string {
  return `org-profile:${input.organizationId}`;
}

export function buildOrganizationProfileDocumentPatch(input: {
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
  const doc = await createDocument(await getScopedPeerSeed(DOCUMENTS_APP_KIND));
  initializeStoredDocumentKind(doc, ORGANIZATION_PROFILE_DOCUMENT_KIND);
  writeStoredDocumentFields(
    doc,
    ORGANIZATION_PROFILE_DOCUMENT_KIND,
    buildOrganizationProfileDocumentPatch({ name: input.name }),
  );

  const initialUpdate = exportAllUpdates(doc);

  return {
    initialUpdate,
    snapshot: bytesToBase64(initialUpdate),
  };
}

export function readOrganizationProfileName(
  structuredFields: Readonly<Record<string, unknown>> | null | undefined,
): string | null {
  if (!structuredFields) {
    return null;
  }

  const value = Reflect.get(structuredFields, "name");

  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}
