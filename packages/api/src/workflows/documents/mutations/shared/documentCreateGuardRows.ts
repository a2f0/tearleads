import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import {
  accessEvents,
  accessManifestHeads,
  containerMetadataDocuments,
  containers,
  organizationRosterEntries,
} from "@tearleads/api-shared/schema";
import { and, eq, sql } from "drizzle-orm";

type CreateGuardKind = "roster" | "metadata" | "purge" | "head";

/**
 * Read after the document lifecycle lock. Each arm has its own bound (the
 * purge arm keeps two rows to detect corruption). Never depend on UNION order.
 * The false joins supply typed null event columns without serializing dates or
 * JSON differently from the existing event reader. PostgreSQL eliminates them.
 */
export function readDocumentCreateGuardRows(
  executor: DatabaseTransaction,
  documentId: string,
) {
  const absentId = sql<string | null>`null`;
  return executor
    .select({
      kind: sql<CreateGuardKind>`'roster'`,
      rosterId: sql<string | null>`${organizationRosterEntries.id}`,
      containerId: absentId,
      liveContainerId: absentId,
      event: accessEvents,
    })
    .from(organizationRosterEntries)
    .leftJoin(accessEvents, sql`false`)
    .where(eq(organizationRosterEntries.profileDocumentId, documentId))
    .limit(1)
    .unionAll(
      executor
        .select({
          kind: sql<CreateGuardKind>`'metadata'`,
          rosterId: absentId,
          containerId: sql<
            string | null
          >`${containerMetadataDocuments.containerId}`,
          liveContainerId: sql<string | null>`${containers.id}`,
          event: accessEvents,
        })
        .from(containerMetadataDocuments)
        .leftJoin(
          containers,
          eq(containers.id, containerMetadataDocuments.containerId),
        )
        .leftJoin(accessEvents, sql`false`)
        .where(eq(containerMetadataDocuments.documentId, documentId))
        .limit(1),
    )
    .unionAll(
      executor
        .select({
          kind: sql<CreateGuardKind>`'purge'`,
          rosterId: absentId,
          containerId: absentId,
          liveContainerId: absentId,
          event: accessEvents,
        })
        .from(accessEvents)
        .where(
          and(
            eq(accessEvents.eventType, "document.purge"),
            eq(accessEvents.objectKind, "document"),
            eq(accessEvents.objectId, documentId),
          ),
        )
        .limit(2),
    )
    .unionAll(
      executor
        .select({
          kind: sql<CreateGuardKind>`'head'`,
          rosterId: absentId,
          containerId: absentId,
          liveContainerId: absentId,
          event: accessEvents,
        })
        .from(accessManifestHeads)
        .leftJoin(accessEvents, sql`false`)
        .where(
          and(
            eq(accessManifestHeads.objectKind, "document"),
            eq(accessManifestHeads.objectId, documentId),
          ),
        )
        .limit(1),
    );
}
