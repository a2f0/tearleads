import { readStoredDocumentState } from "../../data/documents/documentKinds";
import { sqlContainerContentsPersistence } from "../../data/persistence/container-contents/containerContentsPersistence";
import {
  DOCUMENTS_APP_KIND,
  sqlDocumentsPersistence,
} from "../../data/persistence/documents/documentsPersistence";
import { loadOrganizationProfileDocumentIds } from "../../data/persistence/organizations/organizationProfileDocumentPointers";
import { findLocalIdByDocumentId } from "../../data/sqlite/documentPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { loadPersistedDocumentContent } from "../documents/historyContent";
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
    const doc = await loadPersistedDocumentContent({
      execSql,
      localId: documentLocalId,
      persistence: sqlDocumentsPersistence,
    });
    if (!doc) {
      return null;
    }

    return readOrganizationProfileName(
      readStoredDocumentState(doc).structuredFields,
    );
  } catch {
    return null;
  }
}

/**
 * Resolves an organization's decrypted display name from local state.
 *
 * The same organization_profile document is addressed by several different
 * local-id conventions depending on how it arrived, so one lookup by id is not
 * enough:
 *
 *  - The org's own **provisioner** (and any admin who later edits the name)
 *    writes the document under the deterministic alias
 *    `org-profile:<organizationId>` — resolved by the fast path below.
 *  - A **device that only synced it** — a member of another org, or this same
 *    user's freshly re-hydrated device after an identity restore — never runs
 *    that write. The sync ingest keys the document under the server documentId
 *    (there is no local alias to reuse — see `upsertDiscoveredDocumentWithExec`),
 *    so the alias lookup misses.
 *
 * Two fallbacks cover the synced case, in order of authority:
 *
 *  1. The **organization read model** records the org's `profileDocumentId`.
 *     That pointer is container-independent, so it resolves the name wherever
 *     the document happens to be linked — including a profile document created
 *     by an admin through the org-manager editor rather than by provisioning.
 *  2. Failing that, locate the org's metadata container by its deterministic
 *     system slot and read whichever profile document is linked there. Keying on
 *     the system slot (rather than the document kind) keeps it correct even
 *     before the projected document kind has been rebuilt from a freshly-synced
 *     snapshot, and it still works before the read model has been projected.
 */
async function readLocalOrganizationName(
  execSql: ExecSql,
  organizationId: string,
  organizationContainers: ReadonlyArray<LocalContainerForNameLookup>,
  profileDocumentId: string | null,
): Promise<string | null> {
  const aliasName = await readOrganizationNameFromDocument(
    execSql,
    getOrganizationProfileDocumentLocalId({ organizationId }),
  );
  if (aliasName !== null) {
    return aliasName;
  }

  if (profileDocumentId) {
    // Reach the row wherever it landed: a device that only synced the document
    // keys it under the server documentId rather than any local alias.
    const syncedLocalId = await findLocalIdByDocumentId(
      execSql,
      DOCUMENTS_APP_KIND,
      profileDocumentId,
    );
    const syncedName = syncedLocalId
      ? await readOrganizationNameFromDocument(execSql, syncedLocalId)
      : null;
    if (syncedName !== null) {
      return syncedName;
    }
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
  // A projected read model is not a precondition for listing organizations, so
  // an unreadable one degrades to the container-derived lookups below.
  const profileDocumentIdsByOrganizationId =
    await loadOrganizationProfileDocumentIds(input.execSql).catch(
      () => new Map<string, string>(),
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
        profileDocumentIdsByOrganizationId.get(container.organizationId) ??
          null,
      ),
      organizationId: container.organizationId,
      rootContainerId: container.id,
    })),
  );
}
