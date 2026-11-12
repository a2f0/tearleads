import type { WriterProjectionTarget } from "@tearleads/api-client";
import { MAX_CONTAINER_PATH_LENGTH } from "@tearleads/validators/util";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { unionAll } from "drizzle-orm/sqlite-core";
import { containers } from "../../sqlite/schema/containerSchema";
import {
  documentDiscoveryHeads,
  pendingDocumentDiscoveries,
} from "../../sqlite/schema/documentDiscoveryEvidenceSchema";
import {
  documentContainerProjection,
  documentProjection,
} from "../../sqlite/schema/documentProjectionSchema";
import { verifiedAccessManifestBundles as bundles } from "../../sqlite/schema/verifiedManifestBundleSchema";
import { sqliteRowsPerStatement } from "../../sqlite/sqliteBindBudget";
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
  const placements = await unionAll(
    db
      .select({
        containerId: sql<
          string | null
        >`${documentContainerProjection.containerId}`,
        source: sql<number>`0`,
      })
      .from(documentContainerProjection)
      .where(eq(documentContainerProjection.documentId, target.id)),
    db
      .select({
        containerId: pendingDocumentDiscoveries.containerId,
        source: sql<number>`1`,
      })
      .from(pendingDocumentDiscoveries)
      .where(eq(pendingDocumentDiscoveries.documentId, target.id)),
    db
      .select({ containerId: containers.id, source: sql<number>`2` })
      .from(containers)
      .where(eq(containers.metadataDocumentId, target.id)),
  );
  // UNION ALL does not promise branch order. Keep the original source order
  // without reordering rows within a source.
  placements.sort((a, b) => a.source - b.source);
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

async function organizationSources(
  db: ClientSQLiteDatabase,
  target: WriterProjectionTarget,
  ids: string[],
) {
  const verified = db
    .select({ organizationId: bundles.organizationId })
    .from(bundles)
    .where(
      or(
        and(
          eq(bundles.objectKind, "container"),
          inArray(bundles.objectId, ids),
        ),
        // Container targets are already in the container branch.
        target.kind === "document"
          ? and(
              eq(bundles.objectKind, target.kind),
              eq(bundles.objectId, target.id),
            )
          : undefined,
      ),
    );
  const listed = db
    .select({ organizationId: containers.organizationId })
    .from(containers)
    .where(inArray(containers.id, ids));
  return target.kind === "document"
    ? await unionAll(
        verified,
        listed,
        db
          .select({ organizationId: documentDiscoveryHeads.organizationId })
          .from(documentDiscoveryHeads)
          .where(eq(documentDiscoveryHeads.documentId, target.id)),
      )
    : await unionAll(verified, listed);
}

/**
 * The one organization every local source places the read in. Verified
 * ownership (stored verified bundles of the target and of the containers on
 * its walk, and a document's verified discovery head) and local placement
 * (listed container rows reached through links, pending listings, metadata,
 * or parents) must all agree. Only when these sources are absent may a local
 * document projection supply its organization. Disagreement, or no source at
 * all, yields null rather than another organization's hints.
 */
export async function targetOrganization(
  db: ClientSQLiteDatabase,
  target: WriterProjectionTarget,
  objects: readonly { readonly kind: string; readonly id: string }[],
): Promise<string | null> {
  const containerIds = objects
    .filter((object) => object.kind === "container")
    .map((object) => object.id);
  const organizations = new Set<string>();
  // Each container binds twice; the document branches bind four more values.
  const batchSize = sqliteRowsPerStatement(2, 4);
  for (
    let offset = 0;
    offset < Math.max(containerIds.length, 1);
    offset += batchSize
  ) {
    const ids = containerIds.slice(offset, offset + batchSize);
    const sources = await organizationSources(db, target, ids);
    for (const row of sources) organizations.add(row.organizationId);
  }
  // The listing that placed an unstored container must agree as well.
  if (target.listing) organizations.add(target.listing.organizationId);
  // Only absence permits the local-record fallback; disagreement must never
  // be rescued by another hint. A live primary container outranks the stored
  // orphan organization, as it does in other document projection reads.
  if (organizations.size === 0 && target.kind === "document") {
    const local = await db
      .select({
        organizationId: sql<
          string | null
        >`coalesce(${containers.organizationId}, ${documentProjection.organizationId})`,
      })
      .from(documentProjection)
      .leftJoin(containers, eq(containers.id, documentProjection.containerId))
      .where(eq(documentProjection.documentId, target.id));
    for (const row of local)
      if (row.organizationId) organizations.add(row.organizationId);
  }
  const [organizationId] = organizations;
  return organizations.size === 1 && organizationId ? organizationId : null;
}
