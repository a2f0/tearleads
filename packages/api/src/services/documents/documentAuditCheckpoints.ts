import type { DocumentCheckpointKind } from "@tearleads/loro/shared";
import { desc, eq } from "drizzle-orm";
import type { DatabaseExecutor } from "../../adapters/postgres";
import { documentAuditCheckpoints, documents } from "../../schema";
import { sha256Hex } from "../../utils/sha256";

interface CheckpointInput {
  checkpointKind?: DocumentCheckpointKind | undefined;
  id: string;
  sourceVersionVector?: string | undefined;
}

function serializeCheckpointHashField(name: string, value: string) {
  return `${name}:${value.length}:${value}`;
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
    serializeCheckpointHashField("documentId", input.documentId),
    serializeCheckpointHashField("baselineUpdateId", input.baselineUpdateId),
    serializeCheckpointHashField("checkpointKind", input.checkpointKind),
    serializeCheckpointHashField(
      "sourceVersionVector",
      input.sourceVersionVector,
    ),
    serializeCheckpointHashField(
      "coveredAuditEntryHash",
      input.coveredAuditEntryHash ?? "",
    ),
    serializeCheckpointHashField(
      "previousCheckpointHash",
      input.previousCheckpointHash ?? "",
    ),
    serializeCheckpointHashField("accessEpoch", String(input.accessEpoch)),
    serializeCheckpointHashField(
      "accessManifestHash",
      input.accessManifestHash,
    ),
  ];
  if (input.accessStateHash !== null && input.accessStateHash !== undefined) {
    fields.push(
      serializeCheckpointHashField("accessStateHash", input.accessStateHash),
    );
  }
  fields.push(
    serializeCheckpointHashField("actorUserId", input.actorUserId),
    serializeCheckpointHashField("actorFingerprint", input.actorFingerprint),
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
  executor: DatabaseExecutor,
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

  await executor
    .select({ id: documents.id })
    .from(documents)
    .where(eq(documents.id, input.documentId))
    .limit(1)
    .for("update");

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
