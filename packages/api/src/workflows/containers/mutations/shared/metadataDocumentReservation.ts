import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import {
  accessEvents,
  accessManifestHeads,
  containerMetadataDocuments,
  documents,
  purgedObjectReservations,
} from "@tearleads/api-shared/schema";
import { and, eq, sql } from "drizzle-orm";
import {
  PURGED_DOCUMENT_ID_RESERVED,
  releasePurgedObjectReservation,
} from "../../../billing/purgedObjectReservations";
import { lockDocumentLifecycleInTransaction } from "../../../documents/mutations/documentLifecycleLock";
import { ContainerMutationError } from "../errors";
import type { VerifiedContainerAccessState } from "../types";

type ReservationEvidence =
  | "document"
  | "head"
  | "purge"
  | "purgedForOther"
  | "purgedForRequester"
  | "reservation";

/**
 * A metadata document id must be unused by every document lifecycle stage.
 * Purge deletes the document row but keeps its terminal event, so the row
 * check alone would let a container claim a purged id whose document can
 * never be created again. The document lifecycle lock orders this check
 * against a concurrent create of the same id. One statement reads all five
 * kinds of evidence; a purge event still refuses first, and more than one is
 * corruption. An id an organization purge freed is held for that
 * organization's owner: only `requesterUserId` as that owner may bind it, and
 * the binding consumes the reservation, since from then on it guards the id.
 */
export async function assertMetadataDocumentAvailable(
  executor: DatabaseTransaction,
  metadataDocumentId: string,
  requesterUserId: string,
): Promise<void> {
  await lockDocumentLifecycleInTransaction(executor, metadataDocumentId);
  const kinds = (
    await executor
      .select({ kind: sql<ReservationEvidence>`'purge'` })
      .from(accessEvents)
      .where(
        and(
          eq(accessEvents.eventType, "document.purge"),
          eq(accessEvents.objectKind, "document"),
          eq(accessEvents.objectId, metadataDocumentId),
        ),
      )
      .unionAll(
        executor
          .select({ kind: sql<ReservationEvidence>`'head'` })
          .from(accessManifestHeads)
          .where(
            and(
              eq(accessManifestHeads.objectKind, "document"),
              eq(accessManifestHeads.objectId, metadataDocumentId),
            ),
          ),
      )
      .unionAll(
        executor
          .select({ kind: sql<ReservationEvidence>`'document'` })
          .from(documents)
          .where(eq(documents.id, metadataDocumentId)),
      )
      .unionAll(
        executor
          .select({ kind: sql<ReservationEvidence>`'reservation'` })
          .from(containerMetadataDocuments)
          .where(eq(containerMetadataDocuments.documentId, metadataDocumentId)),
      )
      .unionAll(
        executor
          .select({
            kind: sql<ReservationEvidence>`case when ${purgedObjectReservations.ownerUserId} = ${requesterUserId} then 'purgedForRequester' else 'purgedForOther' end`,
          })
          .from(purgedObjectReservations)
          .where(
            and(
              eq(purgedObjectReservations.objectKind, "document"),
              eq(purgedObjectReservations.objectId, metadataDocumentId),
            ),
          ),
      )
  ).map((row) => row.kind);
  const purgeEvents = kinds.filter((kind) => kind === "purge").length;
  if (purgeEvents > 1) {
    throw new Error("Stored access event type is not unique for its object");
  }
  if (purgeEvents === 1) {
    throw new ContainerMutationError(
      "Container metadata document was permanently purged",
      409,
    );
  }
  if (kinds.includes("purgedForOther")) {
    throw new ContainerMutationError(PURGED_DOCUMENT_ID_RESERVED, 409);
  }
  if (kinds.some((kind) => kind !== "purgedForRequester")) {
    throw new ContainerMutationError(
      "Container metadata document already exists",
      409,
    );
  }
  if (kinds.includes("purgedForRequester")) {
    await releasePurgedObjectReservation(executor, {
      objectId: metadataDocumentId,
      objectKind: "document",
      userId: requesterUserId,
    });
  }
}

export async function insertContainerMetadataBinding(
  executor: DatabaseTransaction,
  state: VerifiedContainerAccessState,
): Promise<void> {
  const [metadataBinding] = await executor
    .insert(containerMetadataDocuments)
    .values({
      containerId: state.containerId,
      documentId: state.metadataDocumentId,
    })
    .onConflictDoNothing()
    .returning({ containerId: containerMetadataDocuments.containerId });
  if (!metadataBinding) {
    throw new ContainerMutationError(
      "Container metadata binding already exists",
      409,
    );
  }
}
