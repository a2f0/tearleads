import { and, inArray, isNull } from "drizzle-orm";
import { refreshBlobAccesses } from "../../access/blobAccess";
import { refreshDocumentAccesses } from "../../access/documentAccess";
import type { DatabaseTransaction } from "../../adapters/postgres";
import { attachmentBindings, documentContainerLinks } from "../../schema";
import { uniqueSortedStrings } from "../../utils/array";

/**
 * Returns the unique sorted document IDs linked to the given containers.
 */
async function listLinkedDocumentIdsForContainers(
  containerIds: ReadonlyArray<string>,
  tx: DatabaseTransaction,
): Promise<string[]> {
  const uniqueContainerIds = uniqueSortedStrings(Array.from(containerIds));

  if (uniqueContainerIds.length === 0) {
    return [];
  }

  const rows = await tx
    .select({
      documentId: documentContainerLinks.documentId,
    })
    .from(documentContainerLinks)
    .where(inArray(documentContainerLinks.containerId, uniqueContainerIds));

  return uniqueSortedStrings(rows.map((row) => row.documentId));
}

async function listActiveBlobIdsForDocuments(
  documentIds: ReadonlyArray<string>,
  tx: DatabaseTransaction,
): Promise<string[]> {
  const uniqueDocumentIds = uniqueSortedStrings(Array.from(documentIds));

  if (uniqueDocumentIds.length === 0) {
    return [];
  }

  const rows = await tx
    .select({
      blobId: attachmentBindings.blobId,
    })
    .from(attachmentBindings)
    .where(
      and(
        inArray(attachmentBindings.documentId, uniqueDocumentIds),
        isNull(attachmentBindings.detachedAt),
      ),
    );

  return uniqueSortedStrings(rows.map((row) => row.blobId));
}

export async function refreshLinkedDocumentAndBlobAccess(
  documentIds: ReadonlyArray<string>,
  tx: DatabaseTransaction,
): Promise<void> {
  const uniqueDocumentIds = uniqueSortedStrings(Array.from(documentIds));

  if (uniqueDocumentIds.length === 0) {
    return;
  }

  await refreshDocumentAccesses(uniqueDocumentIds, tx);
  const activeBlobIds = await listActiveBlobIdsForDocuments(
    uniqueDocumentIds,
    tx,
  );
  await refreshBlobAccesses(activeBlobIds, tx);
}

export async function refreshAccessForLinkedContainers(
  containerIds: ReadonlyArray<string>,
  tx: DatabaseTransaction,
): Promise<void> {
  const linkedDocumentIds = await listLinkedDocumentIdsForContainers(
    containerIds,
    tx,
  );

  await refreshLinkedDocumentAndBlobAccess(linkedDocumentIds, tx);
}
