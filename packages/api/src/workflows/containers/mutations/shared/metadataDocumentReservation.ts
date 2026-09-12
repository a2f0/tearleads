import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import {
  containerMetadataDocuments,
  documents,
} from "@tearleads/api-shared/schema";
import { eq } from "drizzle-orm";
import { ContainerMutationError } from "../errors";
import type { VerifiedContainerAccessState } from "../types";

export async function assertMetadataDocumentAvailable(
  executor: DatabaseTransaction,
  metadataDocumentId: string,
): Promise<void> {
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
  if (existingMetadataDocument || reservation) {
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
