import { Buffer } from "node:buffer";
import type {
  ApiDatabase,
  DatabaseTransaction,
} from "@tearleads/api-shared/postgres";
import {
  documentBaselineSegmentSpans,
  documentBaselineSegments,
  documentBaselineStages,
  documentUpdates,
} from "@tearleads/api-shared/schema";
import {
  extendDocumentBaselineSegmentsDigest,
  type VerifiedWriteHeader,
} from "@tearleads/crypto";
import type { DocumentOutgoingUpdate } from "@tearleads/validators/request";
import type { DocumentBaselineStageStatusResponse } from "@tearleads/validators/response";
import { classifyDocumentBaselineSegmentFields } from "@tearleads/validators/util";
import { and, eq, sql } from "drizzle-orm";
import {
  type BaselineSegmentHistory,
  baselineSegmentContinues,
  readBaselineSegmentHistory,
} from "../../../documents/documentBaselineGroup";
import {
  type DocumentBaselineStageRow,
  documentBaselineStageExpiry,
  judgeDocumentBaselineStage,
  placeStagedSegment,
} from "../../../documents/documentBaselineStageState";
import {
  type DocumentBaselineStageKey,
  lockDocumentBaselineStageRow,
  readStagedBaselineFrontier,
} from "../../../documents/documentBaselineStageStore";
import { chunkDocumentPeerRows } from "../../../documents/documentPeerRowChunks";
import { writeHeaderAuthorizationHash } from "../../../documents/writeHeaderAuthorizationHash";
import { loadSignerPublicKey } from "../../signerPublicKey";
import { DocumentMutationError } from "../mutations/errors";
import { verifyStagedSegmentWriteHeader } from "../mutations/outgoingUpdateVerification";
import { readWriteHeader } from "../mutations/shared/records";
import {
  requireOpenDocumentBaselineStage,
  stagedSegmentConflict,
  stagedSegmentInvalid,
  stagedSegmentOutOfOrder,
  toDocumentBaselineStageError,
} from "./errors";
import { documentBaselineStageStatus } from "./stageLifecycle";

export interface StageDocumentBaselineSegmentInput
  extends DocumentBaselineStageKey {
  readonly fingerprint: string;
  readonly now?: Date | undefined;
  readonly segment: DocumentOutgoingUpdate;
  readonly segmentIndex: number;
  readonly userId: string;
}

/**
 * A staged segment names its stage and its place, and is never the final
 * one: the count, the digest and the cursor travel with the request that
 * commits the stage, whose writer does not know them until it stops
 * staging.
 */
function assertSegmentNamesItsPlace(
  input: StageDocumentBaselineSegmentInput,
): void {
  const { segment } = input;
  if (classifyDocumentBaselineSegmentFields(segment) !== "segment") {
    throw stagedSegmentInvalid(
      "only a segment that is not its baseline's final one is staged",
    );
  }
  if (
    segment.baselineId !== input.baselineId ||
    segment.baselineSegmentIndex !== input.segmentIndex
  ) {
    throw stagedSegmentInvalid("it names another baseline or index");
  }
}

/**
 * A segment sent again at an index the stage holds is acknowledged when it
 * is the segment held there, by update id and signed ciphertext hash, and
 * refused otherwise. Nothing is written either way.
 */
async function assertSegmentIsTheOneStaged(
  executor: DatabaseTransaction,
  input: StageDocumentBaselineSegmentInput,
): Promise<void> {
  const [held] = await executor
    .select({
      header: documentBaselineSegments.header,
      updateId: documentBaselineSegments.updateId,
    })
    .from(documentBaselineSegments)
    .where(
      and(
        eq(documentBaselineSegments.documentId, input.documentId),
        eq(documentBaselineSegments.baselineId, input.baselineId),
        eq(documentBaselineSegments.segmentIndex, input.segmentIndex),
      ),
    )
    .limit(1);
  const sent = readWriteHeader(
    input.segment.writeHeader,
    "Document write header",
  );
  if (
    !held ||
    held.updateId !== input.segment.id ||
    held.header.ciphertextHash !== sent.ciphertextHash
  ) {
    throw stagedSegmentConflict();
  }
}

/**
 * Walk the segment against what the stage holds, as the group rules walk a
 * request's segments (`baselineSegmentContinues`): it carries at least one
 * operation, starts every peer where the staged segments left it, and
 * depends only on operations they carry. The stage's frontier is read for
 * just the peers the segment names.
 */
async function requireSegmentContinuesStage(
  executor: DatabaseTransaction,
  input: StageDocumentBaselineSegmentInput,
): Promise<BaselineSegmentHistory> {
  const history = readBaselineSegmentHistory(input.segment);
  if (!history || history.spans.length === 0) {
    throw stagedSegmentInvalid(
      "its vectors do not name the operations it carries",
    );
  }
  const frontier = await readStagedBaselineFrontier(executor, input, [
    ...history.spans.map((span) => span.peerId),
    ...history.dependencies.map(([peerId]) => peerId),
  ]);
  if (
    !baselineSegmentContinues((peerId) => frontier.get(peerId) ?? 0, history)
  ) {
    throw stagedSegmentInvalid(
      "it does not continue the staged segments gapless, depending only on them",
    );
  }
  return history;
}

/** An update id names one update everywhere: a committed one is taken. */
async function assertUpdateIdUncommitted(
  executor: DatabaseTransaction,
  updateId: string,
): Promise<void> {
  const [committed] = await executor
    .select({ id: documentUpdates.id })
    .from(documentUpdates)
    .where(eq(documentUpdates.id, updateId))
    .limit(1);
  if (committed) throw stagedSegmentConflict();
}

async function insertStagedSegment(
  executor: DatabaseTransaction,
  input: StageDocumentBaselineSegmentInput & {
    readonly history: BaselineSegmentHistory;
    readonly verified: VerifiedWriteHeader;
  },
): Promise<number> {
  const { segment } = input;
  const byteLength = Buffer.byteLength(segment.encryptedData, "utf8");
  await executor.insert(documentBaselineSegments).values({
    authorizationHash: writeHeaderAuthorizationHash(input.verified.header),
    baselineId: input.baselineId,
    byteLength,
    dependencyVersionVector: segment.dependencyVersionVector,
    documentId: input.documentId,
    encryptedData: segment.encryptedData,
    header: input.verified.header,
    headerHash: input.verified.headerHash,
    partialEndVersionVector: segment.partialEndVersionVector,
    partialStartVersionVector: segment.partialStartVersionVector,
    plaintextHash: segment.plaintextHash,
    segmentIndex: input.segmentIndex,
    updateId: segment.id,
  });
  const spanRows = input.history.spans.map((span) => ({
    baselineId: input.baselineId,
    documentId: input.documentId,
    endCounter: span.endCounter,
    peerId: span.peerId,
    startCounter: span.startCounter,
    updateId: segment.id,
  }));
  for (const chunk of chunkDocumentPeerRows(spanRows)) {
    await executor.insert(documentBaselineSegmentSpans).values(chunk);
  }
  return byteLength;
}

async function appendStagedSegment(
  executor: DatabaseTransaction,
  input: StageDocumentBaselineSegmentInput,
  stage: DocumentBaselineStageRow,
  now: Date,
): Promise<DocumentBaselineStageRow> {
  const verified = await verifyStagedSegmentWriteHeader({
    contentKeyCommitment: stage.contentKeyCommitment,
    contentKeyEpoch: stage.contentKeyEpoch,
    documentId: input.documentId,
    organizationId: stage.organizationId,
    signingPublicKey: await loadSignerPublicKey(executor, {
      ...input,
      error: (message, status) => new DocumentMutationError(message, status),
    }),
    update: input.segment,
    userId: input.userId,
  });
  const history = await requireSegmentContinuesStage(executor, input);
  await assertUpdateIdUncommitted(executor, input.segment.id);
  const byteLength = await insertStagedSegment(executor, {
    ...input,
    history,
    verified,
  });
  const [advanced] = await executor
    .update(documentBaselineStages)
    .set({
      expiresAt: documentBaselineStageExpiry(stage.createdAt, now),
      nextSegmentIndex: stage.nextSegmentIndex + 1,
      segmentsDigest: await extendDocumentBaselineSegmentsDigest(
        stage.segmentsDigest,
        {
          ciphertextHash: verified.header.ciphertextHash,
          metadataHash: verified.header.metadataHash,
          segmentIndex: input.segmentIndex,
          updateId: input.segment.id,
        },
      ),
      stagedBytes: sql`${documentBaselineStages.stagedBytes} + ${byteLength}`,
    })
    .where(
      and(
        eq(documentBaselineStages.documentId, input.documentId),
        eq(documentBaselineStages.id, input.baselineId),
      ),
    )
    .returning();
  if (!advanced) throw new Error("Document baseline stage was not advanced");
  return advanced;
}

/**
 * Stage one segment of a rotation baseline, strictly in order. Under the
 * stage's row lock the segment is verified as any update is, apart from the
 * authorization only the committing request can check, and walked against
 * the stage's frontier; then it is stored with its spans, and the stage's
 * next index, digest, byte count and expiry move with it. Sending a staged
 * index again with the same ciphertext is acknowledged without a write.
 */
export async function stageDocumentBaselineSegment(
  db: ApiDatabase,
  input: StageDocumentBaselineSegmentInput,
): Promise<DocumentBaselineStageStatusResponse> {
  const now = input.now ?? new Date();
  try {
    return await db.transaction(async (executor) => {
      const stage = requireOpenDocumentBaselineStage(
        judgeDocumentBaselineStage(
          await lockDocumentBaselineStageRow(executor, input),
          { now, userId: input.userId },
        ),
      );
      assertSegmentNamesItsPlace(input);
      const placement = placeStagedSegment(stage, input.segmentIndex);
      if (placement.status === "out_of_order") {
        throw stagedSegmentOutOfOrder(placement.nextSegmentIndex);
      }
      if (placement.status === "staged") {
        await assertSegmentIsTheOneStaged(executor, input);
        return documentBaselineStageStatus(stage);
      }
      return documentBaselineStageStatus(
        await appendStagedSegment(executor, input, stage, now),
      );
    });
  } catch (error) {
    // The unique rows a staged segment writes are keyed by its update id or
    // its place: another stage holds the id.
    throw toDocumentBaselineStageError(error, stagedSegmentConflict) ?? error;
  }
}
