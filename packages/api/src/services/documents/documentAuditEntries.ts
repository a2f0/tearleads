import { desc, eq } from "drizzle-orm";
import type { DatabaseExecutor } from "../../adapters/postgres";
import {
  documentAuditEntries,
  documents,
  documentUpdateAuditEvents,
} from "../../schema";
import { sha256Hex } from "../../utils/sha256";

const textEncoder = new TextEncoder();
const DOCUMENT_AUDIT_EVENT_TYPE_LORO_UPDATE = "loro_update";

interface DocumentAuditUpdateInput {
  id: string;
  encryptedData: string;
  partialStartVersionVector: string;
  partialEndVersionVector: string;
  sourceVersionVector?: string | undefined;
}

function serializeAuditEntryHashField(name: string, value: string) {
  return `${name}:${value.length}:${value}`;
}

function buildDocumentUpdateAuditEntryHashPayload(input: {
  accessEpoch: number;
  accessFingerprint: string;
  actorFingerprint: string;
  actorUserId: string;
  documentId: string;
  encryptedUpdateByteLength: number;
  encryptedUpdateSha256: string;
  eventType: typeof DOCUMENT_AUDIT_EVENT_TYPE_LORO_UPDATE;
  liveUpdateId: string;
  partialEndVersionVector: string;
  partialStartVersionVector: string;
  previousEntryHash: string | null;
  sourceVersionVector: string | null;
}) {
  return [
    serializeAuditEntryHashField("documentId", input.documentId),
    serializeAuditEntryHashField("eventType", input.eventType),
    serializeAuditEntryHashField("accessEpoch", String(input.accessEpoch)),
    serializeAuditEntryHashField("accessFingerprint", input.accessFingerprint),
    serializeAuditEntryHashField("actorUserId", input.actorUserId),
    serializeAuditEntryHashField("actorFingerprint", input.actorFingerprint),
    serializeAuditEntryHashField(
      "previousEntryHash",
      input.previousEntryHash ?? "",
    ),
    serializeAuditEntryHashField("liveUpdateId", input.liveUpdateId),
    serializeAuditEntryHashField(
      "partialStartVersionVector",
      input.partialStartVersionVector,
    ),
    serializeAuditEntryHashField(
      "partialEndVersionVector",
      input.partialEndVersionVector,
    ),
    serializeAuditEntryHashField(
      "sourceVersionVector",
      input.sourceVersionVector ?? "",
    ),
    serializeAuditEntryHashField(
      "encryptedUpdateSha256",
      input.encryptedUpdateSha256,
    ),
    serializeAuditEntryHashField(
      "encryptedUpdateByteLength",
      String(input.encryptedUpdateByteLength),
    ),
  ].join("\n");
}

export async function appendDocumentUpdateAuditEntries(
  executor: DatabaseExecutor,
  input: {
    accessEpoch: number;
    accessFingerprint: string;
    actorFingerprint: string;
    actorUserId: string;
    documentId: string;
    updates: ReadonlyArray<DocumentAuditUpdateInput>;
  },
): Promise<Map<string, string>> {
  const entryHashByUpdateId = new Map<string, string>();
  if (input.updates.length === 0) {
    return entryHashByUpdateId;
  }

  await executor
    .select({ id: documents.id })
    .from(documents)
    .where(eq(documents.id, input.documentId))
    .limit(1)
    .for("update");

  const [latest] = await executor
    .select({ entryHash: documentAuditEntries.entryHash })
    .from(documentAuditEntries)
    .where(eq(documentAuditEntries.documentId, input.documentId))
    .orderBy(desc(documentAuditEntries.sequence))
    .limit(1);

  let previousEntryHash = latest?.entryHash ?? null;

  for (const update of input.updates) {
    const encryptedUpdateSha256 = await sha256Hex(update.encryptedData);
    const encryptedUpdateByteLength = textEncoder.encode(
      update.encryptedData,
    ).byteLength;
    const entryHash = await sha256Hex(
      buildDocumentUpdateAuditEntryHashPayload({
        accessEpoch: input.accessEpoch,
        accessFingerprint: input.accessFingerprint,
        actorFingerprint: input.actorFingerprint,
        actorUserId: input.actorUserId,
        documentId: input.documentId,
        encryptedUpdateByteLength,
        encryptedUpdateSha256,
        eventType: DOCUMENT_AUDIT_EVENT_TYPE_LORO_UPDATE,
        liveUpdateId: update.id,
        partialEndVersionVector: update.partialEndVersionVector,
        partialStartVersionVector: update.partialStartVersionVector,
        previousEntryHash,
        sourceVersionVector: update.sourceVersionVector ?? null,
      }),
    );

    const [auditEntry] = await executor
      .insert(documentAuditEntries)
      .values({
        documentId: input.documentId,
        eventType: DOCUMENT_AUDIT_EVENT_TYPE_LORO_UPDATE,
        accessEpoch: input.accessEpoch,
        accessFingerprint: input.accessFingerprint,
        actorUserId: input.actorUserId,
        actorFingerprint: input.actorFingerprint,
        prevEntryHash: previousEntryHash,
        entryHash,
      })
      .returning({ id: documentAuditEntries.id });
    if (!auditEntry) {
      throw new Error(`Failed to insert audit entry for update ${update.id}`);
    }

    await executor.insert(documentUpdateAuditEvents).values({
      auditEntryId: auditEntry.id,
      liveUpdateId: update.id,
      partialStartVersionVector: update.partialStartVersionVector,
      partialEndVersionVector: update.partialEndVersionVector,
      sourceVersionVector: update.sourceVersionVector ?? null,
      encryptedUpdateSha256,
      encryptedUpdateByteLength,
    });

    entryHashByUpdateId.set(update.id, entryHash);
    previousEntryHash = entryHash;
  }

  return entryHashByUpdateId;
}
