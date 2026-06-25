import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  accessEvents,
  accessManifests,
  attachmentBindings,
  blobContentWriteHeaders,
  blobStages,
  blobs,
  containerMetadataDocuments,
  containers,
  documentAttachmentAuditEvents,
  documentAuditEntries,
  documentContainerLinks,
  documentContentWriteHeaders,
  documentUpdates,
  groups,
} from "@tearleads/api-shared/schema";
import { and, eq, inArray } from "drizzle-orm";
import {
  readExternalBlobBytesRef,
  readMultipartBlobStageRecord,
} from "../../utils/blobStageRecords";
import { selectIds } from "./queryHelpers";
import type {
  MultipartStageObjectCleanup,
  OrganizationPurgeScope,
} from "./types";

async function loadOrganizationBaseScope(input: {
  executor: DatabaseSession;
  organizationId: string;
}): Promise<{
  readonly containerIds: string[];
  readonly eventHashes: string[];
  readonly groupIds: string[];
  readonly manifestHashes: string[];
}> {
  const { executor, organizationId } = input;
  const containerIds = await selectIds(
    executor
      .select({ id: containers.id })
      .from(containers)
      .where(eq(containers.organizationId, organizationId)),
  );
  const groupIds = await selectIds(
    executor
      .select({ id: groups.id })
      .from(groups)
      .where(eq(groups.organizationId, organizationId)),
  );
  const manifestHashes = await selectIds(
    executor
      .select({ id: accessManifests.manifestHash })
      .from(accessManifests)
      .where(eq(accessManifests.organizationId, organizationId)),
  );
  const eventHashes = await selectIds(
    executor
      .select({ id: accessEvents.eventHash })
      .from(accessEvents)
      .where(eq(accessEvents.organizationId, organizationId)),
  );

  return { containerIds, eventHashes, groupIds, manifestHashes };
}

async function loadContainerDocumentIds(input: {
  containerIds: readonly string[];
  executor: DatabaseSession;
}): Promise<string[]> {
  const { containerIds, executor } = input;
  if (containerIds.length === 0) {
    return [];
  }

  const documentIds = await selectIds(
    executor
      .select({ id: containerMetadataDocuments.documentId })
      .from(containerMetadataDocuments)
      .where(inArray(containerMetadataDocuments.containerId, containerIds)),
  );
  documentIds.push(
    ...(await selectIds(
      executor
        .select({ id: documentContainerLinks.documentId })
        .from(documentContainerLinks)
        .where(inArray(documentContainerLinks.containerId, containerIds)),
    )),
  );
  return documentIds;
}

async function loadOrganizationDocumentIds(input: {
  containerIds: readonly string[];
  executor: DatabaseSession;
  organizationId: string;
}): Promise<string[]> {
  const { containerIds, executor, organizationId } = input;
  const documentIds = new Set<string>(
    await selectIds(
      executor
        .select({ id: documentContentWriteHeaders.documentId })
        .from(documentContentWriteHeaders)
        .where(eq(documentContentWriteHeaders.organizationId, organizationId)),
    ),
  );
  for (const id of await loadContainerDocumentIds({ containerIds, executor })) {
    documentIds.add(id);
  }
  for (const id of await selectIds(
    executor
      .select({ id: accessManifests.objectId })
      .from(accessManifests)
      .where(
        and(
          eq(accessManifests.organizationId, organizationId),
          eq(accessManifests.objectKind, "document"),
        ),
      ),
  )) {
    documentIds.add(id);
  }
  return [...documentIds];
}

async function loadDocumentUpdateIds(input: {
  documentIds: readonly string[];
  executor: DatabaseSession;
}): Promise<string[]> {
  const { documentIds, executor } = input;
  if (documentIds.length === 0) {
    return [];
  }

  return selectIds(
    executor
      .select({ id: documentUpdates.id })
      .from(documentUpdates)
      .where(inArray(documentUpdates.documentId, documentIds)),
  );
}

async function loadDocumentBlobIds(input: {
  documentIds: readonly string[];
  executor: DatabaseSession;
}): Promise<string[]> {
  const { documentIds, executor } = input;
  if (documentIds.length === 0) {
    return [];
  }

  const blobIds = await selectIds(
    executor
      .select({ id: attachmentBindings.blobId })
      .from(attachmentBindings)
      .where(inArray(attachmentBindings.documentId, documentIds)),
  );
  const attachmentAuditRows = await executor
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
  for (const row of attachmentAuditRows) {
    if (row.blobId) {
      blobIds.push(row.blobId);
    }
    if (row.previousBlobId) {
      blobIds.push(row.previousBlobId);
    }
  }
  return blobIds;
}

async function loadOrganizationBlobIds(input: {
  documentIds: readonly string[];
  executor: DatabaseSession;
  organizationId: string;
}): Promise<string[]> {
  const { documentIds, executor, organizationId } = input;
  const blobIds = new Set<string>(
    await selectIds(
      executor
        .select({ id: blobContentWriteHeaders.blobId })
        .from(blobContentWriteHeaders)
        .where(eq(blobContentWriteHeaders.organizationId, organizationId)),
    ),
  );
  for (const id of await loadDocumentBlobIds({ documentIds, executor })) {
    blobIds.add(id);
  }
  return [...blobIds];
}

export async function loadOrganizationScope(input: {
  executor: DatabaseSession;
  organizationId: string;
}): Promise<OrganizationPurgeScope> {
  const { executor, organizationId } = input;
  const base = await loadOrganizationBaseScope(input);
  const documentIds = await loadOrganizationDocumentIds({
    containerIds: base.containerIds,
    executor,
    organizationId,
  });
  const [blobIds, updateIds] = await Promise.all([
    loadOrganizationBlobIds({ documentIds, executor, organizationId }),
    loadDocumentUpdateIds({ documentIds, executor }),
  ]);

  return {
    ...base,
    blobIds,
    documentIds,
    updateIds,
  };
}

export async function collectStorageCleanup(input: {
  executor: DatabaseSession;
  blobIds: readonly string[];
  userId: string;
}): Promise<{
  deletedBlobObjectKeys: string[];
  multipartStageObjects: MultipartStageObjectCleanup[];
}> {
  const deletedBlobObjectKeys: string[] = [];
  const multipartStageObjects: MultipartStageObjectCleanup[] = [];

  if (input.blobIds.length > 0) {
    const blobRows = await input.executor
      .select({ encryptedBytes: blobs.encryptedBytes })
      .from(blobs)
      .where(inArray(blobs.id, input.blobIds));
    for (const blob of blobRows) {
      const externalRef = readExternalBlobBytesRef(blob.encryptedBytes);
      if (externalRef) {
        deletedBlobObjectKeys.push(externalRef.storageKey);
      }
    }
  }

  const stageRows = await input.executor
    .select({ encryptedBytes: blobStages.encryptedBytes })
    .from(blobStages)
    .where(eq(blobStages.ownerUserId, input.userId));
  for (const stage of stageRows) {
    const multipartStage = readMultipartBlobStageRecord(stage.encryptedBytes);
    if (multipartStage) {
      multipartStageObjects.push({
        state: multipartStage.state,
        storageKey: multipartStage.storageKey,
        uploadId: multipartStage.uploadId,
      });
    }
  }

  return { deletedBlobObjectKeys, multipartStageObjects };
}
