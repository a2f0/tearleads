import type { ApiDatabase } from "@tearleads/api-shared/postgres";
import type {
  DocumentBaselineStageAbandonResponse,
  DocumentBaselineStageStatusResponse,
} from "@tearleads/validators/response";
import {
  type DocumentBaselineStageRow,
  judgeDocumentBaselineStage,
} from "../../../documents/documentBaselineStageState";
import {
  type DocumentBaselineStageKey,
  deleteDocumentBaselineStage,
  lockDocumentBaselineStageRow,
  readDocumentBaselineStageRow,
} from "../../../documents/documentBaselineStageStore";
import {
  documentBaselineStageNotFound,
  requireOpenDocumentBaselineStage,
  toDocumentBaselineStageError,
} from "./errors";
import { requireStageReader } from "./stageAccess";

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

export interface DocumentBaselineStageInput extends DocumentBaselineStageKey {
  readonly now?: Date | undefined;
  readonly userId: string;
}

/**
 * The caller's stage as it stands, for a writer resuming an upload. A
 * missing or expired stage is answered first, with its own code, so a
 * writer whose document was purged learns its stage is gone; a live one is
 * shown only to a caller who can still write the document.
 */
export async function readDocumentBaselineStage(
  db: ApiDatabase,
  input: DocumentBaselineStageInput,
): Promise<DocumentBaselineStageStatusResponse> {
  try {
    return await db.transaction(async (executor) => {
      const stage = requireOpenDocumentBaselineStage(
        judgeDocumentBaselineStage(
          await readDocumentBaselineStageRow(executor, input),
          { now: input.now ?? new Date(), userId: input.userId },
        ),
      );
      await requireStageReader({
        documentId: stage.documentId,
        executor,
        userId: input.userId,
      });
      return documentBaselineStageStatus(stage);
    });
  } catch (error) {
    throw (
      toDocumentBaselineStageError(error, documentBaselineStageNotFound) ??
      error
    );
  }
}

/**
 * Delete the caller's stage and what it staged, expired or not. It asks for
 * no access: a writer who lost it may still take down what it uploaded. A
 * baseline a request committed has no stage row, so it is never reached
 * from here.
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
    await deleteDocumentBaselineStage(executor, {
      baselineId: state.stage.id,
      documentId: state.stage.documentId,
    });
    return { baselineId: state.stage.id };
  });
}
