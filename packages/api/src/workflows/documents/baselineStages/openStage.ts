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
import { and, eq, lte, ne, sql } from "drizzle-orm";
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
import { isLockNotAvailable } from "../../../utils/databaseErrors";
import {
  acquireTransactionLock,
  advisoryLockKey,
} from "../../../utils/transactionLocks";
import { lockDocumentLifecycleInTransaction } from "../mutations/documentLifecycleLock";
import {
  DocumentBaselineStageError,
  documentBaselineStageBusy,
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
 * The document as its row stores it, for a caller who can write it now and
 * whose organization may sync (`requireStageWriter`). Everything a stage
 * keeps or derives is rooted in the stored spelling of the id, never in the
 * request's: the digest a final segment signs starts from the document id,
 * and a reader starts its own from the id it holds, so a stage rooted in
 * another spelling would commit a group no reader can reproduce.
 */
async function requireWritableDocument(
  executor: DatabaseTransaction,
  input: OpenDocumentBaselineStageInput,
): Promise<{ readonly documentId: string; readonly organizationId: string }> {
  const [document] = await executor
    .select({ id: documents.id })
    .from(documents)
    .where(eq(documents.id, input.documentId))
    .limit(1);
  if (!document) {
    throw new DocumentBaselineStageError("Document not found", 409);
  }
  const { organizationId } = await requireStageWriter({
    documentId: document.id,
    executor,
    userId: input.userId,
  });
  return { documentId: document.id, organizationId };
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
 * user's stages before either inserts its own. Nothing else takes this
 * lock.
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
 * The caller's stage on this document, if it is the one being opened again:
 * it is returned as it stands and keeps what it staged. Any other stage of
 * the caller's here, an earlier baseline's or an expired one, is replaced,
 * so it is deleted with what it staged.
 *
 * The caller holds the document's lifecycle lock, so the row is locked
 * without waiting: a request of the caller's own that holds it, a segment
 * being staged or a commit, may run long, and an open that waited for it
 * here would keep a purge of the document and other users' opens waiting
 * too. The open is refused instead, to be sent again.
 */
async function takeCallersStageHere(
  executor: DatabaseTransaction,
  input: OpenDocumentBaselineStageInput & { readonly documentId: string },
  now: Date,
): Promise<DocumentBaselineStageRow | null> {
  const [stage] = await executor
    .select()
    .from(documentBaselineStages)
    .where(
      and(
        eq(documentBaselineStages.ownerUserId, input.userId),
        eq(documentBaselineStages.documentId, input.documentId),
      ),
    )
    .for("update", { noWait: true })
    .catch((error: unknown) => {
      throw isLockNotAvailable(error) ? documentBaselineStageBusy() : error;
    });
  if (!stage) return null;
  const { request } = input;
  if (
    judgeDocumentBaselineStage(stage, { now, userId: input.userId }).status ===
      "open" &&
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
  return null;
}

/**
 * The caller's stages on other documents, which count against what one user
 * may hold open. No row is waited for. An expired stage is dead and is
 * deleted with what it staged, unless another request holds its row, which
 * is skipped. Every row left counts, whatever holds it: a stage a commit,
 * an abandon or the sweep is deleting at this moment still counts, so an
 * open at the cap may be refused a moment early and never admitted late.
 * The count is exact because only an open adds a stage and the caller's
 * opens run one at a time (`lockStageOwner`).
 */
async function countCallersStagesElsewhere(
  executor: DatabaseTransaction,
  input: OpenDocumentBaselineStageInput,
  now: Date,
): Promise<DocumentBaselineStageRow[]> {
  const elsewhere = and(
    eq(documentBaselineStages.ownerUserId, input.userId),
    ne(documentBaselineStages.documentId, input.documentId),
  );
  const expired = await executor
    .select({
      baselineId: documentBaselineStages.id,
      documentId: documentBaselineStages.documentId,
    })
    .from(documentBaselineStages)
    .where(and(elsewhere, lte(documentBaselineStages.expiresAt, now)))
    .for("update", { skipLocked: true });
  for (const stage of expired) {
    await deleteDocumentBaselineStage(executor, stage);
  }
  return executor.select().from(documentBaselineStages).where(elsewhere);
}

/**
 * An open waits in two places and holds no row lock in either. It waits for
 * the caller's own lock while it holds nothing, and for the document's
 * lifecycle lock while it holds only the caller's own, which nothing but
 * the caller's other opens asks for. Under the lifecycle lock it waits for
 * no lock at all: the caller's stage here is taken without waiting, and the
 * rows of its expired stages elsewhere are skipped when held. So an open
 * closes no cycle of waits, and nothing waits behind an open for longer
 * than its own statements take, apart from the caller's other opens.
 *
 * A purge of the document holds the lifecycle lock from before it deletes
 * the document's stages until it commits, so an open runs wholly before a
 * purge, which then deletes its stage, or wholly after, and finds no
 * document.
 */
async function openDocumentBaselineStageInTransaction(
  executor: DatabaseTransaction,
  input: OpenDocumentBaselineStageInput,
): Promise<DocumentBaselineStageStatusResponse> {
  const now = input.now ?? new Date();
  // Refused before any lock is asked for: a caller who cannot write the
  // document never holds its lifecycle lock, which a create and a purge of
  // it wait for.
  await requireWritableDocument(executor, input);
  await lockStageOwner(executor, input.userId);
  await lockDocumentLifecycleInTransaction(executor, input.documentId);
  // Asked again under the lifecycle lock, where the answer holds until the
  // stage is stored: no purge can run between this and the insert.
  const { documentId, organizationId } = await requireWritableDocument(
    executor,
    input,
  );
  await assertStageEpochCanCommit(executor, documentId, input.request);
  const held = await takeCallersStageHere(
    executor,
    { ...input, documentId },
    now,
  );
  if (held) return documentBaselineStageStatus(held);
  const elsewhere = await countCallersStagesElsewhere(executor, input, now);
  if (elsewhere.length >= MAX_OPEN_DOCUMENT_BASELINE_STAGES_PER_USER) {
    throw documentBaselineStageLimitReached(
      elsewhere.map((stage) => ({
        baselineId: stage.id,
        documentId: stage.documentId,
        expiresAt: stage.expiresAt.toISOString(),
      })),
    );
  }

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
