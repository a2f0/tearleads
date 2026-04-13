import type {
  DocumentRecipientEnvelopeAction,
  SyncDocumentOutgoingUpdate,
} from "@tearleads/loro/shared";
import { desc, eq, sql } from "drizzle-orm";
import type { DatabaseExecutor } from "../../adapters/postgres";
import { documentAuditCheckpoints, documents } from "../../schema";
import { sha256Hex } from "../../utils/sha256";

export type DocumentCheckpointKind = "fresh_baseline" | "rotate_baseline";

interface CheckpointInput {
  checkpointKind?: DocumentCheckpointKind | undefined;
  id: string;
  sourceVersionVector?: string | undefined;
}

interface DocumentCheckpointInputError {
  message: string;
  status: 400;
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
  return JSON.stringify({
    documentId: input.documentId,
    baselineUpdateId: input.baselineUpdateId,
    checkpointKind: input.checkpointKind,
    sourceVersionVector: input.sourceVersionVector,
    coveredAuditEntryHash: input.coveredAuditEntryHash,
    previousCheckpointHash: input.previousCheckpointHash,
    accessEpoch: input.accessEpoch,
    accessFingerprint: input.accessFingerprint,
    actorUserId: input.actorUserId,
    actorFingerprint: input.actorFingerprint,
  });
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
    checkpointUpdate: CheckpointInput & SyncDocumentOutgoingUpdate;
    documentId: string;
  },
): Promise<void> {
  const checkpointKind = input.checkpointUpdate.checkpointKind;
  const sourceVersionVector = input.checkpointUpdate.sourceVersionVector;
  if (!checkpointKind || !sourceVersionVector) {
    return;
  }

  await executor.execute(sql`
    select ${documents.id}
    from ${documents}
    where ${documents.id} = ${input.documentId}::uuid
    for update
  `);

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
    .orderBy(
      desc(documentAuditCheckpoints.createdAt),
      desc(documentAuditCheckpoints.id),
    )
    .limit(1);

  const previousCheckpointHash = latest?.checkpointHash ?? null;
  const coveredAuditEntryHash = null;
  const checkpointHash = await sha256Hex(
    buildCheckpointHashPayload({
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
    }),
  );

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
