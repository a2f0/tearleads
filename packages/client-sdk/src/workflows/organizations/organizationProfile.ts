import { bytesToBase64 } from "@tearleads/encoding";
import { createDocument, exportAllUpdates } from "@tearleads/loro";
import { getScopedPeerSeed } from "../../data/crdtPeerSeed";
import {
  type DocumentProjectorDefinition,
  type DocumentProjectorRegistryInput,
  initializeStoredDocumentKind,
  writeStoredDocumentFields,
} from "../../data/documents/documentKinds";
import { DOCUMENTS_APP_KIND } from "../../data/persistence/documents/documentsPersistence";

export const ORGANIZATION_PROFILE_DOCUMENT_KIND = "organization_profile";
export const DEFAULT_PERSONAL_ORGANIZATION_PROFILE_NAME = "Personal Org";

// The title the pre-projection bootstrap wrote. A host that registers the
// org-profile projector derives its own title; a host that does not would
// otherwise fall through to the registry's generic untitled form.
const ORGANIZATION_PROFILE_FALLBACK_TITLE = "Organization Profile";

// A projector definition carrying only the stable title: with no `project`
// function the default projection path still runs, but the untitled lookup
// resolves to this title instead of the generic humanized form.
const organizationProfileFallbackDefinition: DocumentProjectorDefinition = {
  kind: ORGANIZATION_PROFILE_DOCUMENT_KIND,
  label: "organization profile",
  untitledTitle: ORGANIZATION_PROFILE_FALLBACK_TITLE,
};

/**
 * Give the org-profile document its stable fallback title on hosts that do
 * not register the projector for this kind — for every save path, not just
 * bootstrap, so a later re-projection cannot overwrite the title with the
 * generic untitled form. Hosts that DO register the projector keep full
 * control: their input passes through untouched.
 *
 * Definition arrays (and an absent input) gain a title-only definition, so
 * the resolved registry needs no wrapping. A prebuilt registry is wrapped by
 * explicit per-method delegation — never by spreading, which would drop
 * prototype-backed methods on class-implemented registries.
 */
export function withOrganizationProfileFallbackTitle(
  documentProjectors: DocumentProjectorRegistryInput | undefined,
): DocumentProjectorRegistryInput {
  if (documentProjectors == null) {
    return [organizationProfileFallbackDefinition];
  }

  if (!("getDefinition" in documentProjectors)) {
    return documentProjectors.some(
      (definition) => definition.kind === ORGANIZATION_PROFILE_DOCUMENT_KIND,
    )
      ? documentProjectors
      : [...documentProjectors, organizationProfileFallbackDefinition];
  }

  const registry = documentProjectors;
  if (registry.getDefinition(ORGANIZATION_PROFILE_DOCUMENT_KIND)) {
    return registry;
  }

  return {
    getDefinition: (kind) =>
      kind === ORGANIZATION_PROFILE_DOCUMENT_KIND
        ? organizationProfileFallbackDefinition
        : registry.getDefinition(kind),
    getClientProjectionTables: () => registry.getClientProjectionTables(),
    getStoredDocumentTypeLabel: (kind) =>
      registry.getStoredDocumentTypeLabel(kind),
    getUntitledDocumentTitle: (kind) =>
      kind === ORGANIZATION_PROFILE_DOCUMENT_KIND
        ? ORGANIZATION_PROFILE_FALLBACK_TITLE
        : registry.getUntitledDocumentTitle(kind),
    initializeStoredDocumentKind: (doc, kind) =>
      registry.initializeStoredDocumentKind(doc, kind),
    projectStoredDocumentState: (input) => {
      const state = registry.projectStoredDocumentState(input);
      return input.documentKind === ORGANIZATION_PROFILE_DOCUMENT_KIND
        ? { ...state, title: ORGANIZATION_PROFILE_FALLBACK_TITLE }
        : state;
    },
    deleteStoredDocumentClientProjection: (input) =>
      registry.deleteStoredDocumentClientProjection(input),
    saveStoredDocumentClientProjection: (input) =>
      registry.saveStoredDocumentClientProjection(input),
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
