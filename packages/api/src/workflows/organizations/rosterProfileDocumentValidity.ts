import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  accessManifestDocumentLinkProjection,
  accessManifestHeads,
  containerMetadataDocuments,
  containers,
} from "@tearleads/api-shared/schema";
import { deriveOrganizationRosterProfileContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import { and, eq, inArray } from "drizzle-orm";
import { uniqueSortedStrings } from "../../utils/array";

interface RosterProfileLinkRow {
  readonly containerMetadataDocumentId: string | null;
  readonly containerOrganizationId: string;
  readonly documentId: string;
  readonly systemSlot: string | null;
}

function collectLinksByDocumentId(
  rows: readonly RosterProfileLinkRow[],
): ReadonlyMap<string, RosterProfileLinkRow[]> {
  const linksByDocumentId = new Map<string, RosterProfileLinkRow[]>();
  for (const row of rows) {
    const links = linksByDocumentId.get(row.documentId) ?? [];
    links.push(row);
    linksByDocumentId.set(row.documentId, links);
  }
  return linksByDocumentId;
}

/**
 * Filters persisted roster pointers through the authoritative current link
 * set. This keeps legacy or database-corrupt pointers out of every directory
 * projection instead of asking clients to hydrate an unrelated document.
 */
export async function listValidRosterProfileDocumentIds(input: {
  readonly executor: DatabaseSession;
  readonly organizationId: string;
  readonly profileDocumentIds: readonly string[];
}): Promise<ReadonlySet<string>> {
  const profileDocumentIds = uniqueSortedStrings(input.profileDocumentIds);
  if (profileDocumentIds.length === 0) {
    return new Set();
  }
  const rows = await input.executor
    .select({
      containerMetadataDocumentId: containerMetadataDocuments.documentId,
      containerOrganizationId: containers.organizationId,
      documentId: accessManifestHeads.objectId,
      systemSlot: containers.systemSlot,
    })
    .from(accessManifestHeads)
    .innerJoin(
      accessManifestDocumentLinkProjection,
      and(
        eq(
          accessManifestDocumentLinkProjection.documentId,
          accessManifestHeads.objectId,
        ),
        eq(
          accessManifestDocumentLinkProjection.manifestHash,
          accessManifestHeads.manifestHash,
        ),
      ),
    )
    .innerJoin(
      containers,
      eq(containers.id, accessManifestDocumentLinkProjection.containerId),
    )
    .leftJoin(
      containerMetadataDocuments,
      eq(containerMetadataDocuments.documentId, accessManifestHeads.objectId),
    )
    .where(
      and(
        eq(accessManifestHeads.objectKind, "document"),
        eq(accessManifestHeads.organizationId, input.organizationId),
        inArray(accessManifestHeads.objectId, profileDocumentIds),
      ),
    );
  const rosterProfileSystemSlot =
    await deriveOrganizationRosterProfileContainerSystemSlot({
      organizationId: input.organizationId,
    });
  const linksByDocumentId = collectLinksByDocumentId(rows);
  return new Set(
    profileDocumentIds.filter((documentId) => {
      const links = linksByDocumentId.get(documentId);
      const link = links?.[0];
      return (
        links?.length === 1 &&
        link?.containerMetadataDocumentId === null &&
        link.containerOrganizationId === input.organizationId &&
        link.systemSlot === rosterProfileSystemSlot
      );
    }),
  );
}
