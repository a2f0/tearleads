import { readStoredDocumentState } from "../../../data/documents/documentKinds";
import { sqlContainerContentsPersistence } from "../../../data/persistence/container-contents/containerContentsPersistence";
import {
  DOCUMENTS_APP_KIND,
  sqlDocumentsPersistence,
} from "../../../data/persistence/documents/documentsPersistence";
import { findLocalIdByDocumentId } from "../../../data/persistence/documents/records";
import { loadOrganizationProfileDocumentIds } from "../../../data/persistence/organizations/organizationProfileDocumentPointers";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import { loadPersistedDocumentContent } from "../../documents";
import {
  getOrganizationProfileDocumentLocalId,
  readOrganizationProfileName,
} from "../organizationProfile";
import { deriveOrganizationMetadataContainerSystemSlot } from "../rosterProfileContainer";

// Just the container fields this module needs to locate an org's metadata
// container among the locally-persisted containers.
interface LocalContainerForNameLookup {
  id: string;
  systemSlot: string | null;
}

/**
 * A locally-known organization: one the user holds at least one persisted
 * container of. `name` is the decrypted organization-profile display name when
 * one is stored locally, or null when it has not synced yet.
 *
 * `rootContainerId` is the organization's workspace root when this user can
 * reach it. It is null for an organization the user reaches only through its
 * Members-granted metadata container or through folders shared from beneath a
 * root the user cannot see; such an organization can be browsed but not made
 * the active workspace.
 */
export interface LocalOrganizationSummary {
  name: string | null;
  organizationId: string;
  rootContainerId: string | null;
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

interface LocalOrganizationContainers {
  readonly containers: LocalContainerForNameLookup[];
  earliestLocalCreatedAt: string;
  root: { readonly id: string; readonly localCreatedAt: string } | null;
}

type PersistedContainers = Awaited<
  ReturnType<typeof sqlContainerContentsPersistence.loadContainers>
>;

// Groups every persisted container by organization, keeping the first
// workspace root (a parentless, non-system container) and the earliest local
// creation time. Name resolution reuses the grouped containers to locate an
// organization's independent metadata root without a second DB scan.
function indexLocalOrganizations(
  containers: PersistedContainers,
): Map<string, LocalOrganizationContainers> {
  const organizations = new Map<string, LocalOrganizationContainers>();
  for (const { container } of containers) {
    const localCreatedAt = container.localCreatedAt ?? "";
    let organization = organizations.get(container.organizationId);
    if (!organization) {
      organization = {
        containers: [],
        earliestLocalCreatedAt: localCreatedAt,
        root: null,
      };
      organizations.set(container.organizationId, organization);
    }
    organization.containers.push({
      id: container.id,
      systemSlot: container.systemSlot ?? null,
    });
    if (localCreatedAt < organization.earliestLocalCreatedAt) {
      organization.earliestLocalCreatedAt = localCreatedAt;
    }
    if (
      organization.root === null &&
      container.parentId === null &&
      !container.systemSlot
    ) {
      organization.root = { id: container.id, localCreatedAt };
    }
  }
  return organizations;
}

// Workspaces (organizations with a reachable root) come first in root
// creation order, so the personal organization provisioned with this device
// keeps its place. Organizations reached without a root follow in the order
// their first container arrived locally.
function compareLocalOrganizations(
  [leftId, left]: [string, LocalOrganizationContainers],
  [rightId, right]: [string, LocalOrganizationContainers],
): number {
  if (left.root && right.root) {
    return (
      left.root.localCreatedAt.localeCompare(right.root.localCreatedAt) ||
      leftId.localeCompare(rightId) ||
      left.root.id.localeCompare(right.root.id)
    );
  }
  if (left.root || right.root) {
    return left.root ? -1 : 1;
  }
  return (
    left.earliestLocalCreatedAt.localeCompare(right.earliestLocalCreatedAt) ||
    leftId.localeCompare(rightId)
  );
}

/**
 * Enumerates every organization the user holds a persisted container of, from
 * local state alone. This is intentionally offline: membership is visible
 * locally because every Members recipient can read the organization's metadata
 * root, and shared folders arrive with their organization attached, so listing
 * organizations needs no server round-trip.
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
  const organizations = [...indexLocalOrganizations(containers)].sort(
    compareLocalOrganizations,
  );

  // Read each organization's profile name concurrently; readLocalOrganizationName
  // already falls back to null per organization, so a single corrupt profile
  // cannot reject the batch.
  return Promise.all(
    organizations.map(async ([organizationId, organization]) => ({
      name: await readLocalOrganizationName(
        input.execSql,
        organizationId,
        organization.containers,
        profileDocumentIdsByOrganizationId.get(organizationId) ?? null,
      ),
      organizationId,
      rootContainerId: organization.root?.id ?? null,
    })),
  );
}
