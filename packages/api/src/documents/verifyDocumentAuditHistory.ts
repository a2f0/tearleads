import type { DatabaseSession } from "@symcrypt/api-shared/postgres";
import {
  type BlobAuditRetentionMode,
  type DocumentAttachmentAuditAction,
  documentAttachmentAuditEvents,
  documentAuditCheckpoints,
  documentAuditEntries,
  documentUpdateAuditEvents,
} from "@symcrypt/api-shared/schema";
import { eq } from "drizzle-orm";
import {
  computeDocumentAttachmentAuditEntryHash,
  DOCUMENT_AUDIT_EVENT_TYPE_ATTACHMENT,
} from "./documentAttachmentAuditEvents";
import { computeDocumentAuditCheckpointHash } from "./documentAuditCheckpoints";
import {
  computeDocumentUpdateAuditEntryHash,
  DOCUMENT_AUDIT_EVENT_TYPE_LORO_UPDATE,
} from "./documentAuditEntries";

interface VerifyDocumentAuditHistoryResult {
  attachmentEventCount: number;
  auditEntryCount: number;
  checkpointCount: number;
  documentId: string;
  errors: string[];
  isValid: boolean;
  updateEventCount: number;
}

interface AuditEntryRow {
  accessEpoch: number;
  accessManifestHash: string;
  accessStateHash: string | null;
  actorFingerprint: string;
  actorUserId: string;
  documentId: string;
  entryHash: string;
  eventType: string;
  id: string;
  prevEntryHash: string | null;
  sequence: number;
}

interface UpdateAuditEventRow {
  auditEntryId: string;
  encryptedUpdateByteLength: number;
  encryptedUpdateSha256: string;
  liveUpdateId: string;
  partialEndVersionVector: string;
  partialStartVersionVector: string;
  plaintextHash: string;
  sourceVersionVector: string | null;
}

interface AttachmentAuditEventRow {
  action: DocumentAttachmentAuditAction;
  auditEntryId: string;
  bindingId: string | null;
  blobId: string | null;
  previousBindingId: string | null;
  previousBlobId: string | null;
  retentionMode: BlobAuditRetentionMode;
  slotId: string;
}

interface CheckpointRow {
  accessEpoch: number;
  accessManifestHash: string;
  accessStateHash: string | null;
  actorFingerprint: string;
  actorUserId: string;
  baselineUpdateId: string;
  checkpointHash: string;
  checkpointKind: string;
  coveredAuditEntryHash: string | null;
  previousCheckpointHash: string | null;
  sequence: number;
  sourceVersionVector: string;
}

async function listAuditEntries(
  executor: DatabaseSession,
  documentId: string,
): Promise<AuditEntryRow[]> {
  return executor
    .select({
      accessEpoch: documentAuditEntries.accessEpoch,
      accessManifestHash: documentAuditEntries.accessManifestHash,
      accessStateHash: documentAuditEntries.accessStateHash,
      actorFingerprint: documentAuditEntries.actorFingerprint,
      actorUserId: documentAuditEntries.actorUserId,
      documentId: documentAuditEntries.documentId,
      entryHash: documentAuditEntries.entryHash,
      eventType: documentAuditEntries.eventType,
      id: documentAuditEntries.id,
      prevEntryHash: documentAuditEntries.prevEntryHash,
      sequence: documentAuditEntries.sequence,
    })
    .from(documentAuditEntries)
    .where(eq(documentAuditEntries.documentId, documentId))
    .orderBy(documentAuditEntries.sequence);
}

async function listUpdateAuditEvents(
  executor: DatabaseSession,
  documentId: string,
): Promise<UpdateAuditEventRow[]> {
  return executor
    .select({
      auditEntryId: documentUpdateAuditEvents.auditEntryId,
      encryptedUpdateByteLength:
        documentUpdateAuditEvents.encryptedUpdateByteLength,
      encryptedUpdateSha256: documentUpdateAuditEvents.encryptedUpdateSha256,
      liveUpdateId: documentUpdateAuditEvents.liveUpdateId,
      partialEndVersionVector:
        documentUpdateAuditEvents.partialEndVersionVector,
      partialStartVersionVector:
        documentUpdateAuditEvents.partialStartVersionVector,
      plaintextHash: documentUpdateAuditEvents.plaintextHash,
      sourceVersionVector: documentUpdateAuditEvents.sourceVersionVector,
    })
    .from(documentUpdateAuditEvents)
    .innerJoin(
      documentAuditEntries,
      eq(documentAuditEntries.id, documentUpdateAuditEvents.auditEntryId),
    )
    .where(eq(documentAuditEntries.documentId, documentId));
}

async function listAttachmentAuditEvents(
  executor: DatabaseSession,
  documentId: string,
): Promise<AttachmentAuditEventRow[]> {
  return executor
    .select({
      action: documentAttachmentAuditEvents.action,
      auditEntryId: documentAttachmentAuditEvents.auditEntryId,
      bindingId: documentAttachmentAuditEvents.bindingId,
      blobId: documentAttachmentAuditEvents.blobId,
      previousBindingId: documentAttachmentAuditEvents.previousBindingId,
      previousBlobId: documentAttachmentAuditEvents.previousBlobId,
      retentionMode: documentAttachmentAuditEvents.retentionMode,
      slotId: documentAttachmentAuditEvents.slotId,
    })
    .from(documentAttachmentAuditEvents)
    .innerJoin(
      documentAuditEntries,
      eq(documentAuditEntries.id, documentAttachmentAuditEvents.auditEntryId),
    )
    .where(eq(documentAuditEntries.documentId, documentId));
}

async function listCheckpoints(
  executor: DatabaseSession,
  documentId: string,
): Promise<CheckpointRow[]> {
  return executor
    .select({
      accessEpoch: documentAuditCheckpoints.accessEpoch,
      accessManifestHash: documentAuditCheckpoints.accessManifestHash,
      accessStateHash: documentAuditCheckpoints.accessStateHash,
      actorFingerprint: documentAuditCheckpoints.actorFingerprint,
      actorUserId: documentAuditCheckpoints.actorUserId,
      baselineUpdateId: documentAuditCheckpoints.baselineUpdateId,
      checkpointHash: documentAuditCheckpoints.checkpointHash,
      checkpointKind: documentAuditCheckpoints.checkpointKind,
      coveredAuditEntryHash: documentAuditCheckpoints.coveredAuditEntryHash,
      previousCheckpointHash: documentAuditCheckpoints.previousCheckpointHash,
      sequence: documentAuditCheckpoints.sequence,
      sourceVersionVector: documentAuditCheckpoints.sourceVersionVector,
    })
    .from(documentAuditCheckpoints)
    .where(eq(documentAuditCheckpoints.documentId, documentId))
    .orderBy(documentAuditCheckpoints.sequence);
}

function verifyPreviousAuditEntryHash(input: {
  entry: AuditEntryRow;
  expectedPrevEntryHash: string | null;
  errors: string[];
}) {
  if (input.entry.prevEntryHash === input.expectedPrevEntryHash) {
    return;
  }

  input.errors.push(
    `Audit entry sequence ${input.entry.sequence} has prevEntryHash ${input.entry.prevEntryHash ?? "null"} but expected ${input.expectedPrevEntryHash ?? "null"}`,
  );
}

async function verifyDocumentUpdateEntry(input: {
  attachmentAuditEventByEntryId: Map<string, AttachmentAuditEventRow>;
  entry: AuditEntryRow;
  errors: string[];
  updateAuditEventByEntryId: Map<string, UpdateAuditEventRow>;
}) {
  const updateEvent = input.updateAuditEventByEntryId.get(input.entry.id);
  if (!updateEvent) {
    input.errors.push(
      `Audit entry sequence ${input.entry.sequence} is missing a document update payload`,
    );
    return;
  }

  if (input.attachmentAuditEventByEntryId.has(input.entry.id)) {
    input.errors.push(
      `Audit entry sequence ${input.entry.sequence} unexpectedly has an attachment payload`,
    );
  }

  const expectedEntryHash = await computeDocumentUpdateAuditEntryHash({
    accessEpoch: input.entry.accessEpoch,
    accessManifestHash: input.entry.accessManifestHash,
    accessStateHash: input.entry.accessStateHash,
    actorFingerprint: input.entry.actorFingerprint,
    actorUserId: input.entry.actorUserId,
    documentId: input.entry.documentId,
    encryptedUpdateByteLength: updateEvent.encryptedUpdateByteLength,
    encryptedUpdateSha256: updateEvent.encryptedUpdateSha256,
    liveUpdateId: updateEvent.liveUpdateId,
    partialEndVersionVector: updateEvent.partialEndVersionVector,
    partialStartVersionVector: updateEvent.partialStartVersionVector,
    plaintextHash: updateEvent.plaintextHash,
    previousEntryHash: input.entry.prevEntryHash,
    sourceVersionVector: updateEvent.sourceVersionVector,
  });
  if (input.entry.entryHash !== expectedEntryHash) {
    input.errors.push(
      `Document update audit entry hash mismatch at sequence ${input.entry.sequence}`,
    );
  }
}

async function verifyAttachmentEntry(input: {
  attachmentAuditEventByEntryId: Map<string, AttachmentAuditEventRow>;
  entry: AuditEntryRow;
  errors: string[];
  updateAuditEventByEntryId: Map<string, UpdateAuditEventRow>;
}) {
  const attachmentEvent = input.attachmentAuditEventByEntryId.get(
    input.entry.id,
  );
  if (!attachmentEvent) {
    input.errors.push(
      `Audit entry sequence ${input.entry.sequence} is missing an attachment payload`,
    );
    return;
  }

  if (input.updateAuditEventByEntryId.has(input.entry.id)) {
    input.errors.push(
      `Audit entry sequence ${input.entry.sequence} unexpectedly has a document update payload`,
    );
  }

  const expectedEntryHash = await computeDocumentAttachmentAuditEntryHash({
    accessEpoch: input.entry.accessEpoch,
    accessManifestHash: input.entry.accessManifestHash,
    accessStateHash: input.entry.accessStateHash,
    action: attachmentEvent.action,
    actorFingerprint: input.entry.actorFingerprint,
    actorUserId: input.entry.actorUserId,
    bindingId: attachmentEvent.bindingId,
    blobId: attachmentEvent.blobId,
    documentId: input.entry.documentId,
    previousBindingId: attachmentEvent.previousBindingId,
    previousBlobId: attachmentEvent.previousBlobId,
    previousEntryHash: input.entry.prevEntryHash,
    retentionMode: attachmentEvent.retentionMode,
    slotId: attachmentEvent.slotId,
  });
  if (input.entry.entryHash !== expectedEntryHash) {
    input.errors.push(
      `Attachment audit entry hash mismatch at sequence ${input.entry.sequence}`,
    );
  }
}

async function verifyAuditEntries(input: {
  attachmentAuditEvents: AttachmentAuditEventRow[];
  auditEntries: AuditEntryRow[];
  errors: string[];
  updateAuditEvents: UpdateAuditEventRow[];
}) {
  const updateAuditEventByEntryId = new Map(
    input.updateAuditEvents.map((event) => [event.auditEntryId, event]),
  );
  const attachmentAuditEventByEntryId = new Map(
    input.attachmentAuditEvents.map((event) => [event.auditEntryId, event]),
  );
  let previousEntryHash: string | null = null;

  for (const entry of input.auditEntries) {
    verifyPreviousAuditEntryHash({
      entry,
      errors: input.errors,
      expectedPrevEntryHash: previousEntryHash,
    });

    if (entry.eventType === DOCUMENT_AUDIT_EVENT_TYPE_LORO_UPDATE) {
      await verifyDocumentUpdateEntry({
        attachmentAuditEventByEntryId,
        entry,
        errors: input.errors,
        updateAuditEventByEntryId,
      });
      previousEntryHash = entry.entryHash;
      continue;
    }

    if (entry.eventType === DOCUMENT_AUDIT_EVENT_TYPE_ATTACHMENT) {
      await verifyAttachmentEntry({
        attachmentAuditEventByEntryId,
        entry,
        errors: input.errors,
        updateAuditEventByEntryId,
      });
      previousEntryHash = entry.entryHash;
      continue;
    }

    input.errors.push(
      `Audit entry sequence ${entry.sequence} has unsupported eventType ${entry.eventType}`,
    );
    previousEntryHash = entry.entryHash;
  }
}

function isSupportedCheckpointKind(
  checkpointKind: string,
): checkpointKind is "rotate_baseline" {
  return checkpointKind === "rotate_baseline";
}

function verifyCheckpointCoverage(input: {
  auditEntryHashSet: Set<string>;
  checkpoint: CheckpointRow;
  errors: string[];
}) {
  if (!input.checkpoint.coveredAuditEntryHash) {
    input.errors.push(
      `Checkpoint sequence ${input.checkpoint.sequence} is missing coveredAuditEntryHash`,
    );
    return;
  }

  if (input.auditEntryHashSet.has(input.checkpoint.coveredAuditEntryHash)) {
    return;
  }

  input.errors.push(
    `Checkpoint sequence ${input.checkpoint.sequence} covers unknown audit entry hash ${input.checkpoint.coveredAuditEntryHash}`,
  );
}

function verifyPreviousCheckpointHash(input: {
  checkpoint: CheckpointRow;
  errors: string[];
  expectedPreviousCheckpointHash: string | null;
}) {
  if (
    input.checkpoint.previousCheckpointHash ===
    input.expectedPreviousCheckpointHash
  ) {
    return;
  }

  input.errors.push(
    `Checkpoint sequence ${input.checkpoint.sequence} has previousCheckpointHash ${input.checkpoint.previousCheckpointHash ?? "null"} but expected ${input.expectedPreviousCheckpointHash ?? "null"}`,
  );
}

async function verifyCheckpoint(input: {
  auditEntryHashSet: Set<string>;
  checkpoint: CheckpointRow;
  documentId: string;
  errors: string[];
  expectedPreviousCheckpointHash: string | null;
}) {
  verifyPreviousCheckpointHash({
    checkpoint: input.checkpoint,
    errors: input.errors,
    expectedPreviousCheckpointHash: input.expectedPreviousCheckpointHash,
  });
  verifyCheckpointCoverage({
    auditEntryHashSet: input.auditEntryHashSet,
    checkpoint: input.checkpoint,
    errors: input.errors,
  });

  if (!isSupportedCheckpointKind(input.checkpoint.checkpointKind)) {
    input.errors.push(
      `Checkpoint sequence ${input.checkpoint.sequence} has unsupported checkpointKind ${input.checkpoint.checkpointKind}`,
    );
    return;
  }

  const expectedCheckpointHash = await computeDocumentAuditCheckpointHash({
    accessEpoch: input.checkpoint.accessEpoch,
    accessManifestHash: input.checkpoint.accessManifestHash,
    accessStateHash: input.checkpoint.accessStateHash,
    actorFingerprint: input.checkpoint.actorFingerprint,
    actorUserId: input.checkpoint.actorUserId,
    baselineUpdateId: input.checkpoint.baselineUpdateId,
    checkpointKind: input.checkpoint.checkpointKind,
    coveredAuditEntryHash: input.checkpoint.coveredAuditEntryHash,
    documentId: input.documentId,
    previousCheckpointHash: input.checkpoint.previousCheckpointHash,
    sourceVersionVector: input.checkpoint.sourceVersionVector,
  });
  if (input.checkpoint.checkpointHash !== expectedCheckpointHash) {
    input.errors.push(
      `Checkpoint hash mismatch at sequence ${input.checkpoint.sequence}`,
    );
  }
}

async function verifyCheckpoints(input: {
  auditEntryHashSet: Set<string>;
  checkpoints: CheckpointRow[];
  documentId: string;
  errors: string[];
}) {
  for (let index = 0; index < input.checkpoints.length; index += 1) {
    const checkpoint = input.checkpoints[index];
    if (!checkpoint) {
      continue;
    }

    const expectedPreviousCheckpointHash =
      index === 0
        ? null
        : (input.checkpoints[index - 1]?.checkpointHash ?? null);
    await verifyCheckpoint({
      auditEntryHashSet: input.auditEntryHashSet,
      checkpoint,
      documentId: input.documentId,
      errors: input.errors,
      expectedPreviousCheckpointHash,
    });
  }
}

export async function verifyDocumentAuditHistory(
  executor: DatabaseSession,
  input: { documentId: string },
): Promise<VerifyDocumentAuditHistoryResult> {
  const errors: string[] = [];
  const auditEntries = await listAuditEntries(executor, input.documentId);
  const [updateAuditEvents, attachmentAuditEvents, checkpoints] =
    await Promise.all([
      listUpdateAuditEvents(executor, input.documentId),
      listAttachmentAuditEvents(executor, input.documentId),
      listCheckpoints(executor, input.documentId),
    ]);
  const auditEntryHashSet = new Set(
    auditEntries.map((entry) => entry.entryHash),
  );

  await verifyAuditEntries({
    attachmentAuditEvents,
    auditEntries,
    errors,
    updateAuditEvents,
  });
  await verifyCheckpoints({
    auditEntryHashSet,
    checkpoints,
    documentId: input.documentId,
    errors,
  });

  return {
    attachmentEventCount: attachmentAuditEvents.length,
    auditEntryCount: auditEntries.length,
    checkpointCount: checkpoints.length,
    documentId: input.documentId,
    errors,
    isValid: errors.length === 0,
    updateEventCount: updateAuditEvents.length,
  };
}
