import type {
  ApiDatabase,
  DatabaseTransaction,
} from "@tearleads/api-shared/postgres";
import {
  documentBaselineStages,
  documents,
  documentUpdates,
} from "@tearleads/api-shared/schema";
import { startDocumentBaselineSegmentsDigest } from "@tearleads/crypto";
import type { DocumentBaselineStageOpenRequest } from "@tearleads/validators/request";
import type { DocumentBaselineStageStatusResponse } from "@tearleads/validators/response";
import { MAX_OPEN_DOCUMENT_BASELINE_STAGES_PER_USER } from "@tearleads/validators/util";
import { and, eq, sql } from "drizzle-orm";
import {
  getDocumentContentKeyBundle,
  getLatestDocumentContentKeyEpoch,
} from "../../../access/read/documentContentKeyStore";
import {
  type DocumentBaselineStageRow,
  documentBaselineStageExpiry,
  judgeDocumentBaselineStage,
} from "../../../documents/documentBaselineStageState";
import {
  type DocumentBaselineStageKey,
  deleteDocumentBaselineStage,
  deleteUncommittedBaselineSegments,
  readDocumentBaselineStageRow,
} from "../../../documents/documentBaselineStageStore";
import {
  acquireTransactionLock,
  advisoryLockKey,
} from "../../../utils/transactionLocks";
import { lockDocumentLifecycleInTransaction } from "../mutations/documentLifecycleLock";
import {
  DocumentBaselineStageError,
  documentBaselineStageEpochStale,
  documentBaselineStageIdConflict,
  documentBaselineStageLimitReached,
  toDocumentBaselineStageError,
} from "./errors";
import { requireStageWriter } from "./stageAccess";
import { documentBaselineStageStatus } from "./stageLifecycle";

export interface OpenDocumentBaselineStageInput {
  readonly documentId: string;
  /** The instant the stage's expiry counts from; the wall clock if absent. */
  readonly now?: Date | undefined;
  readonly request: DocumentBaselineStageOpenRequest;
  readonly userId: string;
}

/**
 * The document's id as its row stores it. Everything a stage keeps or
 * derives is rooted in this spelling, never in the request's: the digest a
 * final segment signs starts from the document id, and a reader starts its
 * own from the id it holds, so a stage rooted in another spelling would
 * commit a group no reader can reproduce. The row also proves the document
 * exists, under the lifecycle lock the caller holds.
 */
async function readStoredDocumentId(
  executor: DatabaseTransaction,
  documentId: string,
): Promise<string> {
  const [document] = await executor
    .select({ id: documents.id })
    .from(documents)
    .where(eq(documents.id, documentId))
    .limit(1);
  if (!document) {
    throw new DocumentBaselineStageError("Document not found", 409);
  }
  return document.id;
}

/**
 * A stage can only ever commit at the document's current content-key epoch,
 * under that epoch's stored commitment, or at an epoch the committing
 * request opens. One for an epoch the document has left is refused before
 * its writer uploads anything.
 */
async function assertStageEpochCanCommit(
  executor: DatabaseTransaction,
  documentId: string,
  request: DocumentBaselineStageOpenRequest,
): Promise<void> {
  const { contentKeyCommitment, contentKeyEpoch } = request;
  const latestEpoch = await getLatestDocumentContentKeyEpoch(
    documentId,
    executor,
  );
  if (latestEpoch === null || contentKeyEpoch < latestEpoch) {
    throw documentBaselineStageEpochStale(
      "the document has moved past its content-key epoch",
    );
  }
  if (contentKeyEpoch > latestEpoch) return;
  const bundle = await getDocumentContentKeyBundle(
    documentId,
    contentKeyEpoch,
    executor,
  );
  if (bundle?.contentKeyCommitment !== contentKeyCommitment) {
    throw documentBaselineStageEpochStale(
      "it names another content key for its epoch",
    );
  }
}

/**
 * A baseline id names one group in its document: one the document already
 * committed can never name a stage, and one that is another user's open
 * stage is theirs. The caller's own earlier stage is gone by now.
 */
async function assertBaselineIdFree(
  executor: DatabaseTransaction,
  key: DocumentBaselineStageKey,
): Promise<void> {
  if (await readDocumentBaselineStageRow(executor, key)) {
    throw documentBaselineStageIdConflict();
  }
  const [committed] = await executor
    .select({ id: documentUpdates.id })
    .from(documentUpdates)
    .where(
      and(
        eq(documentUpdates.documentId, key.documentId),
        eq(documentUpdates.baselineId, key.baselineId),
      ),
    )
    .limit(1);
  if (committed) throw documentBaselineStageIdConflict();
}

/**
 * One user's opens run one at a time, so two of them cannot both count the
 * user's stages before either inserts its own.
 */
async function lockStageOwner(
  executor: DatabaseTransaction,
  userId: string,
): Promise<void> {
  const digest = new DataView(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`document-baseline-stage-owner:${userId}`),
    ),
  );
  const keys: readonly [number, number] = [
    digest.getInt32(0, false),
    digest.getInt32(4, false),
  ];
  await acquireTransactionLock(
    executor,
    advisoryLockKey(keys),
    "exclusive",
    () =>
      executor.execute(
        sql`select pg_advisory_xact_lock(${keys[0]}, ${keys[1]})`,
      ),
  );
}

/**
 * Make room for the stage the caller is opening, or return the stage it
 * already holds. Of the caller's stages, across every document:
 *
 * - the same stage, opened again, is returned as it stands and keeps what it
 *   staged;
 * - its earlier stage for this document is replaced, and its expired stages
 *   anywhere are dead, so both are deleted with what they staged;
 * - the live ones left, on other documents, count against what one user may
 *   hold open.
 */
async function takeCallersStages(
  executor: DatabaseTransaction,
  input: OpenDocumentBaselineStageInput & { readonly documentId: string },
  now: Date,
): Promise<DocumentBaselineStageRow | null> {
  await lockStageOwner(executor, input.userId);
  const held = await executor
    .select()
    .from(documentBaselineStages)
    .where(eq(documentBaselineStages.ownerUserId, input.userId))
    .for("update");
  const { request } = input;
  let live = 0;
  for (const stage of held) {
    const open =
      judgeDocumentBaselineStage(stage, { now, userId: input.userId })
        .status === "open";
    if (stage.documentId !== input.documentId && open) {
      live += 1;
      continue;
    }
    if (
      open &&
      stage.id === request.baselineId &&
      stage.contentKeyEpoch === request.contentKeyEpoch &&
      stage.contentKeyCommitment === request.contentKeyCommitment
    ) {
      return stage;
    }
    await deleteDocumentBaselineStage(executor, {
      baselineId: stage.id,
      documentId: stage.documentId,
    });
  }
  if (live >= MAX_OPEN_DOCUMENT_BASELINE_STAGES_PER_USER) {
    throw documentBaselineStageLimitReached();
  }
  return null;
}

async function openDocumentBaselineStageInTransaction(
  executor: DatabaseTransaction,
  input: OpenDocumentBaselineStageInput,
): Promise<DocumentBaselineStageStatusResponse> {
  const now = input.now ?? new Date();
  // A purge of the document holds this lock from before it deletes the
  // document's stages until it commits, so an open runs wholly before a
  // purge, which then deletes its stage, or wholly after, and finds no
  // document.
  await lockDocumentLifecycleInTransaction(executor, input.documentId);
  const documentId = await readStoredDocumentId(executor, input.documentId);
  const { organizationId } = await requireStageWriter({
    documentId,
    executor,
    userId: input.userId,
  });
  await assertStageEpochCanCommit(executor, documentId, input.request);
  const held = await takeCallersStages(executor, { ...input, documentId }, now);
  if (held) return documentBaselineStageStatus(held);

  const key = { baselineId: input.request.baselineId, documentId };
  await assertBaselineIdFree(executor, key);
  // Nothing uncommitted may sit under a new stage's id: its segments are
  // staged from index zero.
  await deleteUncommittedBaselineSegments(executor, key);
  const [stage] = await executor
    .insert(documentBaselineStages)
    .values({
      contentKeyCommitment: input.request.contentKeyCommitment,
      contentKeyEpoch: input.request.contentKeyEpoch,
      createdAt: now,
      documentId,
      expiresAt: documentBaselineStageExpiry(now, now),
      id: input.request.baselineId,
      organizationId,
      ownerUserId: input.userId,
      segmentsDigest: await startDocumentBaselineSegmentsDigest(key),
    })
    .returning();
  if (!stage) throw new Error("Document baseline stage was not inserted");
  return documentBaselineStageStatus(stage);
}

/**
 * Open the stage of one rotation baseline for its writer. The writer must
 * be able to write the document now and sync in its organization, as every
 * later stage request and the commit must. Opening replaces the caller's
 * earlier stage for the document, so one user holds at most one open stage
 * per document, and a bounded number across documents; repeating an open
 * returns the stage as it stands.
 */
export async function openDocumentBaselineStage(
  db: ApiDatabase,
  input: OpenDocumentBaselineStageInput,
): Promise<DocumentBaselineStageStatusResponse> {
  try {
    return await db.transaction((executor) =>
      openDocumentBaselineStageInTransaction(executor, input),
    );
  } catch (error) {
    // The only unique rows an open writes are the stage's own: its id is
    // another user's stage on this document, taken since the check above.
    throw (
      toDocumentBaselineStageError(error, documentBaselineStageIdConflict) ??
      error
    );
  }
}
