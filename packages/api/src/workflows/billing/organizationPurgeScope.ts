import type { DatabaseSession } from "@symcrypt/api-shared/postgres";
import {
  accessManifests,
  attachmentBindings,
  blobAuditObjects,
  blobContentWriteHeaders,
  containerMetadataDocuments,
  containers,
  documentAttachmentAuditEvents,
  documentAuditEntries,
  documentContainerLinks,
  documentContentWriteHeaders,
  documents,
} from "@symcrypt/api-shared/schema";
import { and, eq, inArray } from "drizzle-orm";

async function selectStrings(
  query: PromiseLike<ReadonlyArray<Record<string, string>>>,
): Promise<string[]> {
  return (await query).flatMap((row) => Object.values(row));
}

async function loadContainerDocumentIds(
  executor: DatabaseSession,
  containerIds: readonly string[],
): Promise<string[]> {
  if (containerIds.length === 0) return [];
  const [metadataIds, linkedIds] = await Promise.all([
    selectStrings(
      executor
        .select({ id: containerMetadataDocuments.documentId })
        .from(containerMetadataDocuments)
        .where(inArray(containerMetadataDocuments.containerId, containerIds)),
    ),
    selectStrings(
      executor
        .select({ id: documentContainerLinks.documentId })
        .from(documentContainerLinks)
        .where(inArray(documentContainerLinks.containerId, containerIds)),
    ),
  ]);
  return [...metadataIds, ...linkedIds];
}

async function loadDocumentBlobIds(
  executor: DatabaseSession,
  documentIds: readonly string[],
): Promise<string[]> {
  if (documentIds.length === 0) return [];
  const bindingRows = await executor
    .select({ blobId: attachmentBindings.blobId })
    .from(attachmentBindings)
    .where(inArray(attachmentBindings.documentId, documentIds));
  const auditRows = await executor
    .select({
      blobId: documentAttachmentAuditEvents.blobId,
      previousBlobId: documentAttachmentAuditEvents.previousBlobId,
    })
    .from(documentAttachmentAuditEvents)
    .innerJoin(
      documentAuditEntries,
      eq(documentAttachmentAuditEvents.auditEntryId, documentAuditEntries.id),
    )
    .where(inArray(documentAuditEntries.documentId, documentIds));
  return [
    ...bindingRows.map((row) => row.blobId),
    ...auditRows.flatMap((row) =>
      [row.blobId, row.previousBlobId].filter(
        (id): id is string => id !== null,
      ),
    ),
  ];
}

export interface OrganizationRemotePurgeScope {
  readonly blobIds: string[];
  readonly containerIds: string[];
  readonly documentIds: string[];
}

export async function loadOrganizationRemotePurgeScope(input: {
  readonly executor: DatabaseSession;
  readonly organizationId: string;
}): Promise<OrganizationRemotePurgeScope> {
  const containerIds = await selectStrings(
    input.executor
      .select({ id: containers.id })
      .from(containers)
      .where(eq(containers.organizationId, input.organizationId)),
  );
  const [headerDocumentIds, containerDocumentIds, manifestDocumentIds] =
    await Promise.all([
      selectStrings(
        input.executor
          .select({ id: documentContentWriteHeaders.documentId })
          .from(documentContentWriteHeaders)
          .where(
            eq(
              documentContentWriteHeaders.organizationId,
              input.organizationId,
            ),
          ),
      ),
      loadContainerDocumentIds(input.executor, containerIds),
      selectStrings(
        input.executor
          .select({ id: accessManifests.objectId })
          .from(accessManifests)
          .where(
            and(
              eq(accessManifests.organizationId, input.organizationId),
              eq(accessManifests.objectKind, "document"),
            ),
          ),
      ),
    ]);
  const candidateDocumentIds = [
    ...new Set([
      ...headerDocumentIds,
      ...containerDocumentIds,
      ...manifestDocumentIds,
    ]),
  ];
  const documentIds =
    candidateDocumentIds.length === 0
      ? []
      : await selectStrings(
          input.executor
            .select({ id: documents.id })
            .from(documents)
            .where(inArray(documents.id, candidateDocumentIds)),
        );
  const [headerBlobIds, auditBlobIds, documentBlobIds] = await Promise.all([
    selectStrings(
      input.executor
        .select({ id: blobContentWriteHeaders.blobId })
        .from(blobContentWriteHeaders)
        .where(
          eq(blobContentWriteHeaders.organizationId, input.organizationId),
        ),
    ),
    selectStrings(
      input.executor
        .select({ id: blobAuditObjects.blobId })
        .from(blobAuditObjects)
        .where(eq(blobAuditObjects.organizationId, input.organizationId)),
    ),
    loadDocumentBlobIds(input.executor, documentIds),
  ]);
  return {
    blobIds: [
      ...new Set([...headerBlobIds, ...auditBlobIds, ...documentBlobIds]),
    ],
    containerIds,
    documentIds,
  };
}
