import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import {
  containerMetadataDocuments,
  documents,
} from "@tearleads/api-shared/schema";
import { eq } from "drizzle-orm";
import {
  getCurrentAccessManifestHead,
  getStoredAccessEventByObjectType,
} from "../../../../access/read/accessManifestStore";
import { lockDocumentLifecycleInTransaction } from "../../../documents/mutations/documentLifecycleLock";
import { ContainerMutationError } from "../errors";
import type { VerifiedContainerAccessState } from "../types";

/**
 * A metadata document id must be unused by every document lifecycle stage.
 * Purge deletes the document row but keeps its terminal event, so the row
 * check alone would let a container claim a purged id whose document can
 * never be created again. The document lifecycle lock orders this check
 * against a concurrent create of the same id.
 */
export async function assertMetadataDocumentAvailable(
  executor: DatabaseTransaction,
  metadataDocumentId: string,
): Promise<void> {
  await lockDocumentLifecycleInTransaction(executor, metadataDocumentId);
  const purgeEvent = await getStoredAccessEventByObjectType({
    eventType: "document.purge",
    executor,
    objectId: metadataDocumentId,
    objectKind: "document",
  });
  if (purgeEvent) {
    throw new ContainerMutationError(
      "Container metadata document was permanently purged",
      409,
    );
  }
  const documentHead = await getCurrentAccessManifestHead(
    "document",
    metadataDocumentId,
    executor,
  );
  const [existingMetadataDocument] = await executor
    .select({ id: documents.id })
    .from(documents)
    .where(eq(documents.id, metadataDocumentId))
    .limit(1);
  const [reservation] = await executor
    .select({ documentId: containerMetadataDocuments.documentId })
    .from(containerMetadataDocuments)
    .where(eq(containerMetadataDocuments.documentId, metadataDocumentId))
    .limit(1);
  if (documentHead || existingMetadataDocument || reservation) {
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
