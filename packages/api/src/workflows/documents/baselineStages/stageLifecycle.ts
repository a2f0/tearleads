import type {
  ApiDatabase,
  DatabaseTransaction,
} from "@tearleads/api-shared/postgres";
import {
  documentBaselineStages,
  documentUpdates,
} from "@tearleads/api-shared/schema";
import { startDocumentBaselineSegmentsDigest } from "@tearleads/crypto";
import type { DocumentBaselineStageOpenRequest } from "@tearleads/validators/request";
import type {
  DocumentBaselineStageAbandonResponse,
  DocumentBaselineStageStatusResponse,
} from "@tearleads/validators/response";
import { and, eq } from "drizzle-orm";
import {
  getDocumentContentKeyBundle,
  getLatestDocumentContentKeyEpoch,
} from "../../../access/read/documentContentKeyStore";
import { resolveCurrentDocumentKekTargets } from "../../../access/read/documentKekTargets";
import {
  type DocumentBaselineStageRow,
  documentBaselineStageExpiry,
  judgeDocumentBaselineStage,
} from "../../../documents/documentBaselineStageState";
import {
  type DocumentBaselineStageKey,
  deleteDocumentBaselineStage,
  deleteUncommittedBaselineSegments,
  lockDocumentBaselineStageRow,
  readDocumentBaselineStageRow,
} from "../../../documents/documentBaselineStageStore";
import { assertOrganizationCanSync } from "../../billing/organizationSyncEligibility";
import { ensureCurrentDocumentAccess } from "../mutations/syncAccess";
import {
  documentBaselineStageEpochStale,
  documentBaselineStageIdConflict,
  documentBaselineStageNotFound,
  requireOpenDocumentBaselineStage,
  toDocumentBaselineStageError,
} from "./errors";

export function documentBaselineStageStatus(
  stage: DocumentBaselineStageRow,
): DocumentBaselineStageStatusResponse {
  return {
    baselineId: stage.id,
    contentKeyCommitment: stage.contentKeyCommitment,
    contentKeyEpoch: stage.contentKeyEpoch,
    expiresAt: stage.expiresAt.toISOString(),
    nextSegmentIndex: stage.nextSegmentIndex,
    segmentsDigest: stage.segmentsDigest,
    stagedBytes: stage.stagedBytes,
  };
}

export interface OpenDocumentBaselineStageInput {
  readonly documentId: string;
  /** The instant the stage's expiry counts from; the wall clock if absent. */
  readonly now?: Date | undefined;
  readonly request: DocumentBaselineStageOpenRequest;
  readonly userId: string;
}

/**
 * A stage can only ever commit at the document's current content-key epoch,
 * under that epoch's stored commitment, or at an epoch the committing
 * request opens. One for an epoch the document has left is refused before
 * its writer uploads anything.
 */
async function assertStageEpochCanCommit(
  executor: DatabaseTransaction,
  input: OpenDocumentBaselineStageInput,
): Promise<void> {
  const { contentKeyCommitment, contentKeyEpoch } = input.request;
  const latestEpoch = await getLatestDocumentContentKeyEpoch(
    input.documentId,
    executor,
  );
  if (latestEpoch === null || contentKeyEpoch < latestEpoch) {
    throw documentBaselineStageEpochStale(
      "the document has moved past its content-key epoch",
    );
  }
  if (contentKeyEpoch > latestEpoch) return;
  const bundle = await getDocumentContentKeyBundle(
    input.documentId,
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
 * The caller's stage for the document, if one is open already: the same
 * stage when the request repeats its open, which keeps what it staged, and
 * otherwise an earlier one that the new stage replaces.
 */
async function takeCallersStage(
  executor: DatabaseTransaction,
  input: OpenDocumentBaselineStageInput,
  now: Date,
): Promise<DocumentBaselineStageRow | null> {
  const [held] = await executor
    .select()
    .from(documentBaselineStages)
    .where(
      and(
        eq(documentBaselineStages.documentId, input.documentId),
        eq(documentBaselineStages.ownerUserId, input.userId),
      ),
    )
    .limit(1)
    .for("update");
  if (!held) return null;
  const { request } = input;
  const state = judgeDocumentBaselineStage(held, { now, userId: input.userId });
  if (
    state.status === "open" &&
    held.id === request.baselineId &&
    held.contentKeyEpoch === request.contentKeyEpoch &&
    held.contentKeyCommitment === request.contentKeyCommitment
  ) {
    return held;
  }
  await deleteDocumentBaselineStage(executor, {
    baselineId: held.id,
    documentId: input.documentId,
  });
  return null;
}

async function openDocumentBaselineStageInTransaction(
  executor: DatabaseTransaction,
  input: OpenDocumentBaselineStageInput,
): Promise<DocumentBaselineStageStatusResponse> {
  const now = input.now ?? new Date();
  const targets = await resolveCurrentDocumentKekTargets(
    input.documentId,
    executor,
  );
  await ensureCurrentDocumentAccess({
    containerIds: targets.targets.map((target) => target.containerId),
    executor,
    minimumAccessLevel: "write",
    userId: input.userId,
  });
  await assertOrganizationCanSync(
    executor,
    targets.organizationId,
    input.userId,
  );
  await assertStageEpochCanCommit(executor, input);
  const held = await takeCallersStage(executor, input, now);
  if (held) return documentBaselineStageStatus(held);

  const key = {
    baselineId: input.request.baselineId,
    documentId: input.documentId,
  };
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
      documentId: input.documentId,
      expiresAt: documentBaselineStageExpiry(now, now),
      id: input.request.baselineId,
      organizationId: targets.organizationId,
      ownerUserId: input.userId,
      segmentsDigest: await startDocumentBaselineSegmentsDigest(key),
    })
    .returning();
  if (!stage) throw new Error("Document baseline stage was not inserted");
  return documentBaselineStageStatus(stage);
}

/**
 * Open the stage of one rotation baseline for its writer. The writer must
 * be able to write the document now and sync in its organization, the same
 * as for the request that will commit the stage, which checks both again.
 * Opening replaces the caller's earlier stage for the document, so one user
 * holds at most one open stage per document; repeating an open returns the
 * stage as it stands.
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
    // another user's stage on this document, or the caller opened twice at
    // once.
    throw (
      toDocumentBaselineStageError(error, documentBaselineStageIdConflict) ??
      error
    );
  }
}

export interface DocumentBaselineStageInput extends DocumentBaselineStageKey {
  readonly now?: Date | undefined;
  readonly userId: string;
}

/** The caller's stage as it stands, for a writer resuming an upload. */
export async function readDocumentBaselineStage(
  db: ApiDatabase,
  input: DocumentBaselineStageInput,
): Promise<DocumentBaselineStageStatusResponse> {
  const state = judgeDocumentBaselineStage(
    await readDocumentBaselineStageRow(db, input),
    { now: input.now ?? new Date(), userId: input.userId },
  );
  return documentBaselineStageStatus(requireOpenDocumentBaselineStage(state));
}

/**
 * Delete the caller's stage and what it staged, expired or not. A baseline
 * a request committed has no stage row, so it is never reached from here.
 */
export async function abandonDocumentBaselineStage(
  db: ApiDatabase,
  input: DocumentBaselineStageInput,
): Promise<DocumentBaselineStageAbandonResponse> {
  return db.transaction(async (executor) => {
    const state = judgeDocumentBaselineStage(
      await lockDocumentBaselineStageRow(executor, input),
      { now: input.now ?? new Date(), userId: input.userId },
    );
    if (state.status === "absent") throw documentBaselineStageNotFound();
    await deleteDocumentBaselineStage(executor, input);
    return { baselineId: input.baselineId };
  });
}
