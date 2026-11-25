import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import {
  accessEvents,
  accessManifestHeads,
  containerMetadataDocuments,
  containers,
  organizationRosterEntries,
  purgedObjectReservations,
} from "@tearleads/api-shared/schema";
import { and, eq, type SQL, sql } from "drizzle-orm";

type CreateGuardKind = "roster" | "metadata" | "purge" | "head" | "reserved";

type AbsentId = SQL<string | null>;

function headArm(
  executor: DatabaseTransaction,
  documentId: string,
  absentId: AbsentId,
) {
  return executor
    .select({
      kind: sql<CreateGuardKind>`'head'`,
      rosterId: absentId,
      containerId: absentId,
      liveContainerId: absentId,
      reservedForUserId: absentId,
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
    .limit(1);
}

/** The user an organization purge reserved this freed id for, if any. */
function reservedArm(
  executor: DatabaseTransaction,
  documentId: string,
  absentId: AbsentId,
) {
  return executor
    .select({
      kind: sql<CreateGuardKind>`'reserved'`,
      rosterId: absentId,
      containerId: absentId,
      liveContainerId: absentId,
      // Earlier arms' nulls resolve to text.
      reservedForUserId: sql<
        string | null
      >`${purgedObjectReservations.ownerUserId}::text`,
      event: accessEvents,
    })
    .from(purgedObjectReservations)
    .leftJoin(accessEvents, sql`false`)
    .where(
      and(
        eq(purgedObjectReservations.objectKind, "document"),
        eq(purgedObjectReservations.objectId, documentId),
      ),
    )
    .limit(1);
}

/**
 * Read after the document lifecycle lock. Each arm has its own bound (the
 * purge arm keeps two rows to detect corruption). Never depend on UNION order.
 * One statement reads the head and the organization-purge reservation, so it
 * sees a purge that frees this id either before or after, never in between.
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
      reservedForUserId: absentId,
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
          reservedForUserId: absentId,
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
          reservedForUserId: absentId,
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
    .unionAll(headArm(executor, documentId, absentId))
    .unionAll(reservedArm(executor, documentId, absentId));
}
