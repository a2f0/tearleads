import { base64ToBytes } from "@tearleads/encoding";
import { createDocument, importUpdates } from "@tearleads/loro";
import { getScopedPeerSeed } from "../../data/crdtPeerSeed";
import { readStoredDocumentState } from "../../data/documents/documentKinds";
import { sqlContainerContentsPersistence } from "../../data/persistence/container-contents/containerContentsPersistence";
import {
  DOCUMENTS_APP_KIND,
  sqlDocumentsPersistence,
} from "../../data/persistence/documents/documentsPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import {
  getOrganizationProfileDocumentLocalId,
  readOrganizationProfileName,
} from "./organizationProfile";
import { deriveOrganizationMetadataContainerSystemSlot } from "./rosterProfileContainer";

// Just the container fields this module needs to locate an org's metadata
// container among the locally-persisted containers.
interface LocalContainerForNameLookup {
  id: string;
  systemSlot: string | null;
}

/**
 * A locally-known organization the user belongs to, derived from its persisted
 * root container. `name` is the decrypted organization-profile display name when
 * one is stored locally, or null when it has not synced yet.
 */
export interface LocalOrganizationSummary {
  name: string | null;
  organizationId: string;
  rootContainerId: string;
}

// Reads and decrypts the `name` field of the organization_profile document
// persisted under `documentLocalId`, or null if it is absent, empty, or
// unparseable. A single corrupt profile must not break the whole list, so every
// failure collapses to a null (unnamed) organization.
async function readOrganizationNameFromDocument(
  execSql: ExecSql,
  documentLocalId: string,
): Promise<string | null> {
  try {
    const record = await sqlDocumentsPersistence.loadDocument(
      execSql,
      documentLocalId,
    );
    if (!record?.loroSnapshot) {
      return null;
    }

    const doc = await createDocument(
      await getScopedPeerSeed(DOCUMENTS_APP_KIND),
    );
    importUpdates(doc, [base64ToBytes(record.loroSnapshot)]);
    const name = readOrganizationProfileName(
      readStoredDocumentState(doc).structuredFields,
    );
    return name;
  } catch {
    return null;
  }
}

/**
 * Resolves an organization's decrypted display name from local state.
 *
 * The same organization_profile document is addressed by two different local-id
 * conventions depending on how it arrived, so one lookup by id is not enough:
 *
 *  - The org's own **provisioner** (and any admin who later edits the name)
 *    writes the document under the deterministic alias
 *    `org-profile:<organizationId>` — resolved by the fast path below.
 *  - A **member of another org** never runs that write. They receive the very
 *    same document by *syncing* the Members-granted metadata container, and the
 *    sync ingest keys it under the server documentId (there is no local alias to
 *    reuse — see `upsertDiscoveredDocumentWithExec`). The alias lookup therefore
 *    misses for every foreign org, which is why cross-org display names never
 *    surfaced before this fallback.
 *
 * The fallback bridges the gap without relying on the provisioner-only alias: it
 * locates the org's metadata container by its deterministic system slot and
 * reads whichever profile document is linked there. Keying on the system slot
 * (rather than the document kind) keeps it correct even before the projected
 * document kind has been rebuilt from a freshly-synced snapshot.
 */
async function readLocalOrganizationName(
  execSql: ExecSql,
  organizationId: string,
  organizationContainers: ReadonlyArray<LocalContainerForNameLookup>,
): Promise<string | null> {
  const aliasName = await readOrganizationNameFromDocument(
    execSql,
    getOrganizationProfileDocumentLocalId({ organizationId }),
  );
  if (aliasName !== null) {
    return aliasName;
  }

  const metadataSystemSlot =
    await deriveOrganizationMetadataContainerSystemSlot({ organizationId });
  const metadataContainer = organizationContainers.find(
    (container) => container.systemSlot === metadataSystemSlot,
  );
  if (!metadataContainer) {
    return null;
  }

  const documentLocalIds =
    await sqlDocumentsPersistence.findDocumentLocalIdsByContainerId(
      execSql,
      metadataContainer.id,
    );
  for (const documentLocalId of documentLocalIds) {
    const name = await readOrganizationNameFromDocument(
      execSql,
      documentLocalId,
    );
    if (name !== null) {
      return name;
    }
  }
  return null;
}

/**
 * Enumerates the organizations the user can manage from local state: one per
 * persisted root container. This is intentionally offline — the Explorer already
 * resolves files across organizations by effective permission, so listing the
 * organizations to manage needs no server round-trip.
 */
export async function listLocalOrganizations(input: {
  execSql: ExecSql;
}): Promise<LocalOrganizationSummary[]> {
  const containers = await sqlContainerContentsPersistence.loadContainers(
    input.execSql,
  );

  // Group every persisted container by org so name resolution can locate an
  // org's metadata container (a non-root child) without a second DB scan.
  const containersByOrganizationId = new Map<
    string,
    LocalContainerForNameLookup[]
  >();
  for (const { container } of containers) {
    const entry: LocalContainerForNameLookup = {
      id: container.id,
      systemSlot: container.systemSlot ?? null,
    };
    const group = containersByOrganizationId.get(container.organizationId);
    if (group) {
      group.push(entry);
    } else {
      containersByOrganizationId.set(container.organizationId, [entry]);
    }
  }

  const seen = new Set<string>();
  const rootContainers = containers.filter(({ container }) => {
    if (container.parentId !== null || seen.has(container.organizationId)) {
      return false;
    }
    seen.add(container.organizationId);
    return true;
  });
  rootContainers.sort(
    (left, right) =>
      (left.container.localCreatedAt ?? "").localeCompare(
        right.container.localCreatedAt ?? "",
      ) ||
      left.container.organizationId.localeCompare(
        right.container.organizationId,
      ) ||
      left.container.id.localeCompare(right.container.id),
  );

  // Read each organization's profile name concurrently; readLocalOrganizationName
  // already falls back to null per organization, so a single corrupt profile
  // cannot reject the batch.
  return Promise.all(
    rootContainers.map(async ({ container }) => ({
      name: await readLocalOrganizationName(
        input.execSql,
        container.organizationId,
        containersByOrganizationId.get(container.organizationId) ?? [],
      ),
      organizationId: container.organizationId,
      rootContainerId: container.id,
    })),
  );
}
