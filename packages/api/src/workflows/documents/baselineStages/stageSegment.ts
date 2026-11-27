import type {
  ApiDatabase,
  DatabaseTransaction,
} from "@tearleads/api-shared/postgres";
import {
  documentBaselineStages,
  documentUpdates,
} from "@tearleads/api-shared/schema";
import { extendDocumentBaselineSegmentsDigest } from "@tearleads/crypto";
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
  readStagedSegmentAt,
} from "../../../documents/documentBaselineStageStore";
import { extendsPeerOwnedByOthers } from "../../../documents/documentPeerOwners";
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
import { requireStageWriter } from "./stageAccess";
import {
  assertContentRecordUnused,
  assertSegmentFitsStage,
  insertStagedSegment,
} from "./stagedSegmentRows";
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
  stage: DocumentBaselineStageRow,
  input: StageDocumentBaselineSegmentInput,
): void {
  const { segment } = input;
  if (classifyDocumentBaselineSegmentFields(segment) !== "segment") {
    throw stagedSegmentInvalid(
      "only a segment that is not its baseline's final one is staged",
    );
  }
  if (
    segment.baselineId !== stage.id ||
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
  stage: DocumentBaselineStageRow,
  input: StageDocumentBaselineSegmentInput,
): Promise<void> {
  const held = await readStagedSegmentAt(executor, stage, input.segmentIndex);
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
  stage: DocumentBaselineStageRow,
  segment: DocumentOutgoingUpdate,
): Promise<BaselineSegmentHistory> {
  const history = readBaselineSegmentHistory(segment);
  if (!history || history.spans.length === 0) {
    throw stagedSegmentInvalid(
      "its vectors do not name the operations it carries",
    );
  }
  const frontier = await readStagedBaselineFrontier(
    executor,
    { baselineId: stage.id, documentId: stage.documentId },
    [
      ...history.spans.map((span) => span.peerId),
      ...history.dependencies.map(([peerId]) => peerId),
    ],
  );
  if (
    !baselineSegmentContinues((peerId) => frontier.get(peerId) ?? 0, history)
  ) {
    throw stagedSegmentInvalid(
      "it does not continue the staged segments gapless, depending only on them",
    );
  }
  return history;
}

/**
 * A commit extends only peers its writer owns or that nobody does
 * (`assertStagedBaselinePromotable`), so a segment that extends another
 * user's peer now belongs to a stage that could not commit as things
 * stand, and is refused before it is stored. This read holds no document
 * lock: the commit's own check, under the head lock, is the one that
 * decides.
 */
async function assertSegmentExtendsNoForeignPeer(
  executor: DatabaseTransaction,
  stage: DocumentBaselineStageRow,
  history: BaselineSegmentHistory,
  userId: string,
): Promise<void> {
  const refused = await extendsPeerOwnedByOthers(executor, {
    documentId: stage.documentId,
    spans: history.spans,
    userId,
  });
  if (refused) {
    throw stagedSegmentInvalid("it extends a peer another user owns");
  }
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

/**
 * Verify and store the stage's next segment. Everything a stage keeps is
 * rooted in the stage row's own document id, the stored spelling, never in
 * the request's: the header's object, the signed metadata hash and the
 * digest all name the document, and a reader names it as it is stored.
 */
async function appendStagedSegment(
  executor: DatabaseTransaction,
  input: StageDocumentBaselineSegmentInput,
  stage: DocumentBaselineStageRow,
  now: Date,
): Promise<DocumentBaselineStageRow> {
  const verified = await verifyStagedSegmentWriteHeader({
    contentKeyCommitment: stage.contentKeyCommitment,
    contentKeyEpoch: stage.contentKeyEpoch,
    documentId: stage.documentId,
    organizationId: stage.organizationId,
    signingPublicKey: await loadSignerPublicKey(executor, {
      ...input,
      error: (message, status) => new DocumentMutationError(message, status),
    }),
    update: input.segment,
    userId: input.userId,
  });
  const history = await requireSegmentContinuesStage(
    executor,
    stage,
    input.segment,
  );
  await assertSegmentExtendsNoForeignPeer(
    executor,
    stage,
    history,
    input.userId,
  );
  const stored = assertSegmentFitsStage(stage, {
    header: verified.header,
    history,
    segment: input.segment,
  });
  await assertUpdateIdUncommitted(executor, input.segment.id);
  await assertContentRecordUnused(executor, stage, verified.header);
  await insertStagedSegment(executor, {
    history,
    segment: input.segment,
    segmentIndex: input.segmentIndex,
    stage,
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
      stagedBytes: sql`${documentBaselineStages.stagedBytes} + ${stored.bytes}`,
      stagedSpans: sql`${documentBaselineStages.stagedSpans} + ${stored.spans}`,
    })
    .where(
      and(
        eq(documentBaselineStages.documentId, stage.documentId),
        eq(documentBaselineStages.id, stage.id),
      ),
    )
    .returning();
  if (!advanced) throw new Error("Document baseline stage was not advanced");
  return advanced;
}

/**
 * Stage one segment of a rotation baseline, strictly in order. Under the
 * stage's row lock the caller is held to what any document write is held to
 * now (`requireStageWriter`); the segment is verified as any update is,
 * apart from the authorization only the committing request can check, and
 * walked against the stage's frontier; then it is stored with its spans,
 * and the stage's next index, digest, byte and span counts and expiry move
 * with it. Sending a staged index again with the same ciphertext is
 * acknowledged without a write.
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
      await requireStageWriter({
        documentId: stage.documentId,
        executor,
        userId: input.userId,
      });
      assertSegmentNamesItsPlace(stage, input);
      const placement = placeStagedSegment(stage, input.segmentIndex);
      if (placement.status === "out_of_order") {
        throw stagedSegmentOutOfOrder(placement.nextSegmentIndex);
      }
      if (placement.status === "staged") {
        await assertSegmentIsTheOneStaged(executor, stage, input);
        return documentBaselineStageStatus(stage);
      }
      return documentBaselineStageStatus(
        await appendStagedSegment(executor, input, stage, now),
      );
    });
  } catch (error) {
    // The unique rows a staged segment writes are keyed by its update id,
    // its place or its content record: another stage holds the id.
    throw toDocumentBaselineStageError(error, stagedSegmentConflict) ?? error;
  }
}
