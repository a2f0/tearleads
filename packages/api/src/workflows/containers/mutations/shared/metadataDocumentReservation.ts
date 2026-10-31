import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import {
  accessEvents,
  accessManifestHeads,
  containerMetadataDocuments,
  documents,
} from "@tearleads/api-shared/schema";
import { and, eq, sql } from "drizzle-orm";
import { lockDocumentLifecycleInTransaction } from "../../../documents/mutations/documentLifecycleLock";
import { ContainerMutationError } from "../errors";
import type { VerifiedContainerAccessState } from "../types";

type ReservationEvidence = "document" | "head" | "purge" | "reservation";

/**
 * A metadata document id must be unused by every document lifecycle stage.
 * Purge deletes the document row but keeps its terminal event, so the row
 * check alone would let a container claim a purged id whose document can
 * never be created again. The document lifecycle lock orders this check
 * against a concurrent create of the same id. One statement reads all four
 * kinds of evidence; a purge event still refuses first, and more than one is
 * corruption.
 */
export async function assertMetadataDocumentAvailable(
  executor: DatabaseTransaction,
  metadataDocumentId: string,
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
  if (kinds.length > 0) {
    throw new ContainerMutationError(
      "Container metadata document already exists",
      409,
    );
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
