import type { WriterProjectionTarget } from "@tearleads/api-client";
import { MAX_CONTAINER_PATH_LENGTH } from "@tearleads/validators/util";
import { and, eq, inArray } from "drizzle-orm";
import { documentContainerProjection } from "../../sqlite/schema";
import { containers } from "../../sqlite/schema/containerSchema";
import {
  documentDiscoveryHeads,
  pendingDocumentDiscoveries,
} from "../../sqlite/schema/documentDiscoveryEvidenceSchema";
import { verifiedAccessManifestBundles as bundles } from "../../sqlite/schema/verifiedManifestBundleSchema";
import type { ClientSQLiteDatabase } from "../../sqlite/sqlitePersistenceRuntime";

/** An object whose verified bytes a projection read may cite. */
export interface CitedObject {
  readonly kind: string;
  readonly id: string;
}

/** The requested object first, then each container whose lineage it cites. */
async function containerLineage(
  db: ClientSQLiteDatabase,
  containerId: string,
  prefix: readonly string[] = [],
): Promise<string[]> {
  const lineage = [...prefix, containerId];
  while (lineage.length < MAX_CONTAINER_PATH_LENGTH) {
    const [row] = await db
      .select({ parentId: containers.parentId })
      .from(containers)
      .where(eq(containers.id, lineage.at(-1) ?? ""))
      .limit(1);
    const parentId = row?.parentId;
    if (!parentId || lineage.includes(parentId)) break;
    lineage.push(parentId);
  }
  return lineage;
}

/**
 * A container the device has not stored yet has no local parent, so its
 * listing names one: the lineage continues through the listed parent's
 * stored lineage. A wrong parent only changes which held hashes are cited.
 */
async function containerTargetLineage(
  db: ClientSQLiteDatabase,
  target: WriterProjectionTarget,
): Promise<string[]> {
  const parentId = target.listing?.parentId;
  if (!parentId || parentId === target.id)
    return containerLineage(db, target.id);
  const [stored] = await db
    .select({ id: containers.id })
    .from(containers)
    .where(eq(containers.id, target.id))
    .limit(1);
  return stored
    ? containerLineage(db, target.id)
    : containerLineage(db, parentId, [target.id]);
}

export async function citedObjects(
  db: ClientSQLiteDatabase,
  target: WriterProjectionTarget,
): Promise<{ readonly kind: string; readonly id: string }[]> {
  if (target.kind === "container")
    return (await containerTargetLineage(db, target)).map((id) => ({
      kind: "container",
      id,
    }));
  // Linked containers, containers listing the document before its signed
  // placement is checked, and a container whose metadata document it is.
  const placements = [
    ...(await db
      .select({ containerId: documentContainerProjection.containerId })
      .from(documentContainerProjection)
      .where(eq(documentContainerProjection.documentId, target.id))),
    ...(await db
      .select({ containerId: pendingDocumentDiscoveries.containerId })
      .from(pendingDocumentDiscoveries)
      .where(eq(pendingDocumentDiscoveries.documentId, target.id))),
    ...(await db
      .select({ containerId: containers.id })
      .from(containers)
      .where(eq(containers.metadataDocumentId, target.id))),
  ];
  const containerIds = new Set<string>();
  for (const { containerId } of placements)
    if (containerId)
      for (const id of await containerLineage(db, containerId))
        containerIds.add(id);
  return [
    { kind: "document", id: target.id },
    ...[...containerIds].map((id) => ({ kind: "container", id })),
  ];
}

/**
 * The one organization every local source places the read in. Verified
 * ownership (stored verified bundles of the target and of the containers on
 * its walk, and a document's verified discovery head) and local placement
 * (listed container rows reached through links, pending listings, metadata,
 * or parents) must all agree: any disagreement, or no source at all, yields
 * null, so the read is sent with no hints rather than another
 * organization's.
 */
export async function targetOrganization(
  db: ClientSQLiteDatabase,
  target: WriterProjectionTarget,
  objects: readonly { readonly kind: string; readonly id: string }[],
): Promise<string | null> {
  const containerIds = objects
    .filter((object) => object.kind === "container")
    .map((object) => object.id);
  const listed =
    containerIds.length === 0
      ? []
      : await db
          .select({ organizationId: containers.organizationId })
          .from(containers)
          .where(inArray(containers.id, containerIds));
  const verifiedContainers =
    containerIds.length === 0
      ? []
      : await db
          .select({ organizationId: bundles.organizationId })
          .from(bundles)
          .where(
            and(
              eq(bundles.objectKind, "container"),
              inArray(bundles.objectId, containerIds),
            ),
          );
  const verifiedTarget = await db
    .select({ organizationId: bundles.organizationId })
    .from(bundles)
    .where(
      and(eq(bundles.objectKind, target.kind), eq(bundles.objectId, target.id)),
    );
  const discovered =
    target.kind === "document"
      ? await db
          .select({ organizationId: documentDiscoveryHeads.organizationId })
          .from(documentDiscoveryHeads)
          .where(eq(documentDiscoveryHeads.documentId, target.id))
      : [];
  // The listing that placed an unstored container must agree as well.
  const listing = target.listing ? [target.listing] : [];
  const sources = [
    listed,
    verifiedContainers,
    verifiedTarget,
    discovered,
    listing,
  ];
  const organizations = new Set(
    sources.flat().map((row) => row.organizationId),
  );
  const [organizationId] = organizations;
  return organizations.size === 1 && organizationId ? organizationId : null;
}
