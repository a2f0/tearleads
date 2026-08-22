import type { DatabaseSession } from "@symcrypt/api-shared/postgres";
import {
  type BlobAuditRetentionMode,
  blobAuditObjects,
  blobs,
  type DocumentAttachmentAuditAction,
  documentAttachmentAuditEvents,
  documentAuditEntries,
  documents,
} from "@symcrypt/api-shared/schema";
import { desc, eq, inArray } from "drizzle-orm";
import { uniqueSortedStrings } from "../utils/array";
import { sha256Hex } from "../utils/sha256";
import { lockRowForUpdate } from "../utils/sqlDialect";
import { serializeAuditHashField } from "./auditHashField";

export const DOCUMENT_AUDIT_EVENT_TYPE_ATTACHMENT = "attachment_event";
const BLOB_AUDIT_RETENTION_MODE_LIVE_ONLY: BlobAuditRetentionMode = "live_only";

interface DocumentAttachmentAuditEventInput {
  action: DocumentAttachmentAuditAction;
  bindingId: string | null;
  blobId: string | null;
  previousBindingId: string | null;
  previousBlobId: string | null;
  slotId: string;
}

function buildDocumentAttachmentAuditEntryHashPayload(input: {
  accessEpoch: number;
  accessManifestHash: string;
  accessStateHash?: string | null;
  action: DocumentAttachmentAuditAction;
  actorFingerprint: string;
  actorUserId: string;
  bindingId: string | null;
  blobId: string | null;
  documentId: string;
  eventType: typeof DOCUMENT_AUDIT_EVENT_TYPE_ATTACHMENT;
  previousBindingId: string | null;
  previousBlobId: string | null;
  previousEntryHash: string | null;
  retentionMode: BlobAuditRetentionMode;
  slotId: string;
}) {
  const fields = [
    serializeAuditHashField("documentId", input.documentId),
    serializeAuditHashField("eventType", input.eventType),
    serializeAuditHashField("accessEpoch", String(input.accessEpoch)),
    serializeAuditHashField("accessManifestHash", input.accessManifestHash),
  ];
  if (input.accessStateHash !== null && input.accessStateHash !== undefined) {
    fields.push(
      serializeAuditHashField("accessStateHash", input.accessStateHash),
    );
  }
  fields.push(
    serializeAuditHashField("actorUserId", input.actorUserId),
    serializeAuditHashField("actorFingerprint", input.actorFingerprint),
    serializeAuditHashField("previousEntryHash", input.previousEntryHash ?? ""),
    serializeAuditHashField("action", input.action),
    serializeAuditHashField("slotId", input.slotId),
    serializeAuditHashField("bindingId", input.bindingId ?? ""),
    serializeAuditHashField("previousBindingId", input.previousBindingId ?? ""),
    serializeAuditHashField("blobId", input.blobId ?? ""),
    serializeAuditHashField("previousBlobId", input.previousBlobId ?? ""),
    serializeAuditHashField("retentionMode", input.retentionMode),
  );
  return fields.join("\n");
}

export async function computeDocumentAttachmentAuditEntryHash(input: {
  accessEpoch: number;
  accessManifestHash: string;
  accessStateHash?: string | null;
  action: DocumentAttachmentAuditAction;
  actorFingerprint: string;
  actorUserId: string;
  bindingId: string | null;
  blobId: string | null;
  documentId: string;
  previousBindingId: string | null;
  previousBlobId: string | null;
  previousEntryHash: string | null;
  retentionMode: BlobAuditRetentionMode;
  slotId: string;
}) {
  return sha256Hex(
    buildDocumentAttachmentAuditEntryHashPayload({
      ...input,
      eventType: DOCUMENT_AUDIT_EVENT_TYPE_ATTACHMENT,
    }),
  );
}

function listAttachmentEventBlobIds(
  events: ReadonlyArray<DocumentAttachmentAuditEventInput>,
): string[] {
  return uniqueSortedStrings(
    events.flatMap((event) =>
      [event.blobId, event.previousBlobId].filter(
        (blobId): blobId is string => blobId !== null,
      ),
    ),
  );
}

async function ensureBlobAuditObjects(
  executor: DatabaseSession,
  blobIds: string[],
  organizationId: string,
): Promise<void> {
  const uniqueBlobIds = uniqueSortedStrings(blobIds);
  if (uniqueBlobIds.length === 0) {
    return;
  }

  const existingRows = await executor
    .select({
      blobId: blobAuditObjects.blobId,
      organizationId: blobAuditObjects.organizationId,
    })
    .from(blobAuditObjects)
    .where(inArray(blobAuditObjects.blobId, uniqueBlobIds));
  if (existingRows.some((row) => row.organizationId !== organizationId)) {
    throw new Error("Blob audit organization does not match document");
  }
  const existingBlobIds = new Set(existingRows.map((row) => row.blobId));
  const missingBlobIds = uniqueBlobIds.filter(
    (blobId) => !existingBlobIds.has(blobId),
  );
  if (missingBlobIds.length === 0) {
    return;
  }

  const liveBlobRows = await executor
    .select({
      blobId: blobs.id,
      byteLength: blobs.byteLength,
      liveStorageKey: blobs.storageKey,
      sha256: blobs.sha256,
    })
    .from(blobs)
    .where(inArray(blobs.id, missingBlobIds));

  if (liveBlobRows.length !== missingBlobIds.length) {
    throw new Error(
      `Missing live blob rows for audit metadata: ${missingBlobIds.join(", ")}`,
    );
  }

  await executor
    .insert(blobAuditObjects)
    .values(
      liveBlobRows.map((blob) => ({
        blobId: blob.blobId,
        byteLength: blob.byteLength,
        historicalBytesRetained: false,
        liveStorageKey: blob.liveStorageKey,
        organizationId,
        prunedAt: null,
        retentionMode: BLOB_AUDIT_RETENTION_MODE_LIVE_ONLY,
        sha256: blob.sha256,
      })),
    )
    .onConflictDoNothing({ target: blobAuditObjects.blobId });

  // Validate the conflict winner too: concurrent first-audit insertion must
  // never let one blob generation acquire ownership in two organizations.
  const storedRows = await executor
    .select({ organizationId: blobAuditObjects.organizationId })
    .from(blobAuditObjects)
    .where(inArray(blobAuditObjects.blobId, uniqueBlobIds));
  if (
    storedRows.length !== uniqueBlobIds.length ||
    storedRows.some((row) => row.organizationId !== organizationId)
  ) {
    throw new Error("Blob audit organization does not match document");
  }
}

export async function appendDocumentAttachmentAuditEntries(
  executor: DatabaseSession,
  input: {
    accessEpoch: number;
    accessManifestHash: string;
    accessStateHash: string | null;
    actorFingerprint: string;
    actorUserId: string;
    documentId: string;
    events: ReadonlyArray<DocumentAttachmentAuditEventInput>;
    organizationId: string;
  },
): Promise<void> {
  if (input.events.length === 0) {
    return;
  }

  const documentLockQuery = executor
    .select({ id: documents.id })
    .from(documents)
    .where(eq(documents.id, input.documentId))
    .limit(1);
  await lockRowForUpdate(documentLockQuery);

  await ensureBlobAuditObjects(
    executor,
    listAttachmentEventBlobIds(input.events),
    input.organizationId,
  );

  const [latest] = await executor
    .select({ entryHash: documentAuditEntries.entryHash })
    .from(documentAuditEntries)
    .where(eq(documentAuditEntries.documentId, input.documentId))
    .orderBy(desc(documentAuditEntries.sequence))
    .limit(1);

  let previousEntryHash = latest?.entryHash ?? null;
  const auditEntries: Array<typeof documentAuditEntries.$inferInsert> = [];
  const attachmentAuditEvents: Array<
    typeof documentAttachmentAuditEvents.$inferInsert
  > = [];

  for (const event of input.events) {
    const auditEntryId = crypto.randomUUID();
    const entryHash = await computeDocumentAttachmentAuditEntryHash({
      accessEpoch: input.accessEpoch,
      accessManifestHash: input.accessManifestHash,
      accessStateHash: input.accessStateHash,
      action: event.action,
      actorFingerprint: input.actorFingerprint,
      actorUserId: input.actorUserId,
      bindingId: event.bindingId,
      blobId: event.blobId,
      documentId: input.documentId,
      previousBindingId: event.previousBindingId,
      previousBlobId: event.previousBlobId,
      previousEntryHash,
      retentionMode: BLOB_AUDIT_RETENTION_MODE_LIVE_ONLY,
      slotId: event.slotId,
    });

    auditEntries.push({
      id: auditEntryId,
      accessEpoch: input.accessEpoch,
      accessManifestHash: input.accessManifestHash,
      accessStateHash: input.accessStateHash,
      actorFingerprint: input.actorFingerprint,
      actorUserId: input.actorUserId,
      documentId: input.documentId,
      entryHash,
      eventType: DOCUMENT_AUDIT_EVENT_TYPE_ATTACHMENT,
      prevEntryHash: previousEntryHash,
    });
    attachmentAuditEvents.push({
      action: event.action,
      auditEntryId,
      bindingId: event.bindingId,
      blobId: event.blobId,
      previousBindingId: event.previousBindingId,
      previousBlobId: event.previousBlobId,
      retentionMode: BLOB_AUDIT_RETENTION_MODE_LIVE_ONLY,
      slotId: event.slotId,
    });

    previousEntryHash = entryHash;
  }

  await executor.insert(documentAuditEntries).values(auditEntries);
  await executor
    .insert(documentAttachmentAuditEvents)
    .values(attachmentAuditEvents);
}
