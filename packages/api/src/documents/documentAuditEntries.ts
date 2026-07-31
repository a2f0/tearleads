import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  documentAuditEntries,
  documents,
  documentUpdateAuditEvents,
} from "@tearleads/api-shared/schema";
import { desc, eq } from "drizzle-orm";
import { sha256Hex } from "../utils/sha256";
import { isSqliteApiDatabase } from "../utils/sqlDialect";
import { serializeAuditHashField } from "./auditHashField";

const textEncoder = new TextEncoder();
export const DOCUMENT_AUDIT_EVENT_TYPE_LORO_UPDATE = "loro_update";

interface DocumentAuditUpdateInput {
  id: string;
  encryptedData: string;
  partialStartVersionVector: string;
  partialEndVersionVector: string;
  plaintextHash: string;
  sourceVersionVector?: string | undefined;
}

interface DocumentAuditUpdateMetadata {
  auditEntryId: string;
  id: string;
  encryptedUpdateByteLength: number;
  encryptedUpdateSha256: string;
  partialEndVersionVector: string;
  partialStartVersionVector: string;
  plaintextHash: string;
  sourceVersionVector: string | null;
}

function buildDocumentUpdateAuditEntryHashPayload(input: {
  accessEpoch: number;
  accessManifestHash: string;
  accessStateHash?: string | null;
  actorFingerprint: string;
  actorUserId: string;
  documentId: string;
  encryptedUpdateByteLength: number;
  encryptedUpdateSha256: string;
  eventType: typeof DOCUMENT_AUDIT_EVENT_TYPE_LORO_UPDATE;
  liveUpdateId: string;
  partialEndVersionVector: string;
  partialStartVersionVector: string;
  plaintextHash: string;
  previousEntryHash: string | null;
  sourceVersionVector: string | null;
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
    serializeAuditHashField("liveUpdateId", input.liveUpdateId),
    serializeAuditHashField(
      "partialStartVersionVector",
      input.partialStartVersionVector,
    ),
    serializeAuditHashField(
      "partialEndVersionVector",
      input.partialEndVersionVector,
    ),
    serializeAuditHashField(
      "sourceVersionVector",
      input.sourceVersionVector ?? "",
    ),
    serializeAuditHashField("plaintextHash", input.plaintextHash),
    serializeAuditHashField(
      "encryptedUpdateSha256",
      input.encryptedUpdateSha256,
    ),
    serializeAuditHashField(
      "encryptedUpdateByteLength",
      String(input.encryptedUpdateByteLength),
    ),
  );
  return fields.join("\n");
}

export async function computeDocumentUpdateAuditEntryHash(input: {
  accessEpoch: number;
  accessManifestHash: string;
  accessStateHash?: string | null;
  actorFingerprint: string;
  actorUserId: string;
  documentId: string;
  encryptedUpdateByteLength: number;
  encryptedUpdateSha256: string;
  liveUpdateId: string;
  partialEndVersionVector: string;
  partialStartVersionVector: string;
  plaintextHash: string;
  previousEntryHash: string | null;
  sourceVersionVector: string | null;
}) {
  return sha256Hex(
    buildDocumentUpdateAuditEntryHashPayload({
      ...input,
      eventType: DOCUMENT_AUDIT_EVENT_TYPE_LORO_UPDATE,
    }),
  );
}

export async function appendDocumentUpdateAuditEntries(
  executor: DatabaseSession,
  input: {
    accessEpoch: number;
    accessManifestHash: string;
    accessStateHash: string | null;
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

  const documentLockQuery = executor
    .select({ id: documents.id })
    .from(documents)
    .where(eq(documents.id, input.documentId))
    .limit(1);
  if (isSqliteApiDatabase()) {
    await documentLockQuery;
  } else {
    await documentLockQuery.for("update");
  }

  const [latest] = await executor
    .select({ entryHash: documentAuditEntries.entryHash })
    .from(documentAuditEntries)
    .where(eq(documentAuditEntries.documentId, input.documentId))
    .orderBy(desc(documentAuditEntries.sequence))
    .limit(1);

  const updatesWithMetadata: DocumentAuditUpdateMetadata[] = await Promise.all(
    input.updates.map(async (update) => ({
      ...update,
      auditEntryId: crypto.randomUUID(),
      encryptedUpdateByteLength: textEncoder.encode(update.encryptedData)
        .byteLength,
      encryptedUpdateSha256: await sha256Hex(update.encryptedData),
      sourceVersionVector: update.sourceVersionVector ?? null,
    })),
  );

  let previousEntryHash = latest?.entryHash ?? null;
  const auditEntries: Array<typeof documentAuditEntries.$inferInsert> = [];
  const auditEvents: Array<typeof documentUpdateAuditEvents.$inferInsert> = [];

  for (const update of updatesWithMetadata) {
    const entryHash = await computeDocumentUpdateAuditEntryHash({
      accessEpoch: input.accessEpoch,
      accessManifestHash: input.accessManifestHash,
      accessStateHash: input.accessStateHash,
      actorFingerprint: input.actorFingerprint,
      actorUserId: input.actorUserId,
      documentId: input.documentId,
      encryptedUpdateByteLength: update.encryptedUpdateByteLength,
      encryptedUpdateSha256: update.encryptedUpdateSha256,
      liveUpdateId: update.id,
      partialEndVersionVector: update.partialEndVersionVector,
      partialStartVersionVector: update.partialStartVersionVector,
      plaintextHash: update.plaintextHash,
      previousEntryHash,
      sourceVersionVector: update.sourceVersionVector,
    });

    auditEntries.push({
      id: update.auditEntryId,
      documentId: input.documentId,
      eventType: DOCUMENT_AUDIT_EVENT_TYPE_LORO_UPDATE,
      accessEpoch: input.accessEpoch,
      accessManifestHash: input.accessManifestHash,
      accessStateHash: input.accessStateHash,
      actorUserId: input.actorUserId,
      actorFingerprint: input.actorFingerprint,
      prevEntryHash: previousEntryHash,
      entryHash,
    });
    auditEvents.push({
      auditEntryId: update.auditEntryId,
      liveUpdateId: update.id,
      partialStartVersionVector: update.partialStartVersionVector,
      partialEndVersionVector: update.partialEndVersionVector,
      sourceVersionVector: update.sourceVersionVector,
      plaintextHash: update.plaintextHash,
      encryptedUpdateSha256: update.encryptedUpdateSha256,
      encryptedUpdateByteLength: update.encryptedUpdateByteLength,
    });

    entryHashByUpdateId.set(update.id, entryHash);
    previousEntryHash = entryHash;
  }

  await executor.insert(documentAuditEntries).values(auditEntries);
  await executor.insert(documentUpdateAuditEvents).values(auditEvents);

  return entryHashByUpdateId;
}
