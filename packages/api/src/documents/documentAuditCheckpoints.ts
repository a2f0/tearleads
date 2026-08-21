import type { DatabaseSession } from "@symcrypt/api-shared/postgres";
import {
  documentAuditCheckpoints,
  documents,
} from "@symcrypt/api-shared/schema";
import type { DocumentCheckpointKind } from "@symcrypt/loro/shared";
import { desc, eq } from "drizzle-orm";
import { sha256Hex } from "../utils/sha256";
import { lockRowForUpdate } from "../utils/sqlDialect";
import { serializeAuditHashField } from "./auditHashField";

interface CheckpointInput {
  checkpointKind?: DocumentCheckpointKind | undefined;
  id: string;
  sourceVersionVector?: string | undefined;
}

function buildCheckpointHashPayload(input: {
  accessEpoch: number;
  accessManifestHash: string;
  accessStateHash?: string | null;
  actorFingerprint: string;
  actorUserId: string;
  baselineUpdateId: string;
  checkpointKind: DocumentCheckpointKind;
  coveredAuditEntryHash: string | null;
  documentId: string;
  previousCheckpointHash: string | null;
  sourceVersionVector: string;
}) {
  const fields = [
    serializeAuditHashField("documentId", input.documentId),
    serializeAuditHashField("baselineUpdateId", input.baselineUpdateId),
    serializeAuditHashField("checkpointKind", input.checkpointKind),
    serializeAuditHashField("sourceVersionVector", input.sourceVersionVector),
    serializeAuditHashField(
      "coveredAuditEntryHash",
      input.coveredAuditEntryHash ?? "",
    ),
    serializeAuditHashField(
      "previousCheckpointHash",
      input.previousCheckpointHash ?? "",
    ),
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
  );
  return fields.join("\n");
}

export async function computeDocumentAuditCheckpointHash(input: {
  accessEpoch: number;
  accessManifestHash: string;
  accessStateHash?: string | null;
  actorFingerprint: string;
  actorUserId: string;
  baselineUpdateId: string;
  checkpointKind: DocumentCheckpointKind;
  coveredAuditEntryHash: string | null;
  documentId: string;
  previousCheckpointHash: string | null;
  sourceVersionVector: string;
}) {
  return sha256Hex(buildCheckpointHashPayload(input));
}

export async function maybeWriteDocumentAuditCheckpoint(
  executor: DatabaseSession,
  input: {
    accessEpoch: number;
    accessManifestHash: string;
    accessStateHash: string | null;
    actorFingerprint: string;
    actorUserId: string;
    checkpointUpdate: CheckpointInput;
    coveredAuditEntryHash: string | null;
    documentId: string;
  },
): Promise<void> {
  const checkpointKind = input.checkpointUpdate.checkpointKind;
  const sourceVersionVector = input.checkpointUpdate.sourceVersionVector;
  if (!checkpointKind || !sourceVersionVector) {
    return;
  }

  const documentLockQuery = executor
    .select({ id: documents.id })
    .from(documents)
    .where(eq(documents.id, input.documentId))
    .limit(1);
  await lockRowForUpdate(documentLockQuery);

  const [existing] = await executor
    .select({ id: documentAuditCheckpoints.id })
    .from(documentAuditCheckpoints)
    .where(
      eq(documentAuditCheckpoints.baselineUpdateId, input.checkpointUpdate.id),
    )
    .limit(1);
  if (existing) {
    return;
  }

  const [latest] = await executor
    .select({
      checkpointHash: documentAuditCheckpoints.checkpointHash,
    })
    .from(documentAuditCheckpoints)
    .where(eq(documentAuditCheckpoints.documentId, input.documentId))
    .orderBy(desc(documentAuditCheckpoints.sequence))
    .limit(1);

  const previousCheckpointHash = latest?.checkpointHash ?? null;
  const coveredAuditEntryHash = input.coveredAuditEntryHash;
  const checkpointHash = await computeDocumentAuditCheckpointHash({
    accessEpoch: input.accessEpoch,
    accessManifestHash: input.accessManifestHash,
    accessStateHash: input.accessStateHash,
    actorFingerprint: input.actorFingerprint,
    actorUserId: input.actorUserId,
    baselineUpdateId: input.checkpointUpdate.id,
    checkpointKind,
    coveredAuditEntryHash,
    documentId: input.documentId,
    previousCheckpointHash,
    sourceVersionVector,
  });

  await executor.insert(documentAuditCheckpoints).values({
    documentId: input.documentId,
    baselineUpdateId: input.checkpointUpdate.id,
    checkpointKind,
    sourceVersionVector,
    coveredAuditEntryHash,
    previousCheckpointHash,
    checkpointHash,
    accessEpoch: input.accessEpoch,
    accessManifestHash: input.accessManifestHash,
    accessStateHash: input.accessStateHash,
    actorUserId: input.actorUserId,
    actorFingerprint: input.actorFingerprint,
  });
}
