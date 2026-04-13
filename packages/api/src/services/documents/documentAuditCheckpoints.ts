import type {
  DocumentCheckpointKind,
  DocumentRecipientEnvelopeAction,
} from "@tearleads/loro/shared";
import { desc, eq } from "drizzle-orm";
import type { DatabaseExecutor } from "../../adapters/postgres";
import { documentAuditCheckpoints, documents } from "../../schema";
import { sha256Hex } from "../../utils/sha256";

interface CheckpointInput {
  checkpointKind?: DocumentCheckpointKind | undefined;
  id: string;
  sourceVersionVector?: string | undefined;
}

interface DocumentCheckpointInputError {
  message: string;
  status: 400;
}

function serializeCheckpointHashField(name: string, value: string) {
  return `${name}:${value.length}:${value}`;
}

function buildCheckpointHashPayload(input: {
  accessEpoch: number;
  accessFingerprint: string;
  actorFingerprint: string;
  actorUserId: string;
  baselineUpdateId: string;
  checkpointKind: DocumentCheckpointKind;
  coveredAuditEntryHash: string | null;
  documentId: string;
  previousCheckpointHash: string | null;
  sourceVersionVector: string;
}) {
  return [
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
    serializeCheckpointHashField("accessFingerprint", input.accessFingerprint),
    serializeCheckpointHashField("actorUserId", input.actorUserId),
    serializeCheckpointHashField("actorFingerprint", input.actorFingerprint),
  ].join("\n");
}

export async function computeDocumentAuditCheckpointHash(input: {
  accessEpoch: number;
  accessFingerprint: string;
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

export function getDocumentCheckpointInputError(input: {
  documentRecipientEnvelopeAction: DocumentRecipientEnvelopeAction;
  updates: ReadonlyArray<CheckpointInput>;
}): DocumentCheckpointInputError | null {
  const checkpointUpdates = input.updates.filter(
    (update) =>
      update.checkpointKind !== undefined ||
      update.sourceVersionVector !== undefined,
  );
  if (checkpointUpdates.length === 0) {
    return null;
  }

  if (input.updates.length !== 1 || checkpointUpdates.length !== 1) {
    return {
      message: "Checkpoint writes require exactly one document update",
      status: 400,
    };
  }

  const [update] = checkpointUpdates;
  if (!update) {
    return null;
  }

  if (!update.checkpointKind) {
    return {
      message: "sourceVersionVector requires checkpointKind",
      status: 400,
    };
  }

  if (!update.sourceVersionVector) {
    return {
      message: "Checkpoint writes require source version vector",
      status: 400,
    };
  }

  if (
    update.checkpointKind === "rotate_baseline" &&
    input.documentRecipientEnvelopeAction !== "rotate"
  ) {
    return {
      message: "Rotate baseline checkpoint requires rotate access transition",
      status: 400,
    };
  }

  if (
    input.documentRecipientEnvelopeAction === "rotate" &&
    update.checkpointKind !== "rotate_baseline"
  ) {
    return {
      message: "Rotate baseline requires checkpointKind rotate_baseline",
      status: 400,
    };
  }

  return null;
}

export async function maybeWriteDocumentAuditCheckpoint(
  executor: DatabaseExecutor,
  input: {
    accessEpoch: number;
    accessFingerprint: string;
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
    accessFingerprint: input.accessFingerprint,
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
    accessFingerprint: input.accessFingerprint,
    actorUserId: input.actorUserId,
    actorFingerprint: input.actorFingerprint,
  });
}
