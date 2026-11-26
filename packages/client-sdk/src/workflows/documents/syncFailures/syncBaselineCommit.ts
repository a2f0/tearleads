import { DOCUMENT_SYNC_ERROR_CODES } from "@tearleads/validators/response";
import {
  type DocumentBaselineStageApi,
  documentBaselineStageApi,
} from "../../../data/documents/shared/sync/baselineStageApi";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import { settleStagedBaselineCommit } from "../baselineStage/rotationBaselineWriter";
import type { StagedBaselineState } from "../baselineStage/stagedBaselineMachine";
import { getOrCreateStagedBaselineUploads } from "../baselineStage/stagedBaselineUploads";

/**
 * Whether a refused commit left a staged baseline in a state that planning
 * again answers within the same pass: its headers are to be signed again,
 * its stage is to be read again, or the stage is gone or worthless and the
 * next plan starts over, against a fresh projection. A coverage refusal is
 * not one: this pass's history is what stopped short, and only a pass that
 * holds more of the document can stage the tail.
 */
function replanAnswers(state: StagedBaselineState): boolean {
  return (
    state.status === "planning" ||
    state.status === "resigningHeaders" ||
    state.status === "resuming" ||
    state.status === "abandoned"
  );
}

/**
 * Tell the document's staged baseline upload what the sync that carried its
 * final segment got, and say whether a refusal is one the pass answers by
 * planning again. A sync that names no stage, or whose upload a later run
 * has taken over, settles nothing.
 */
export async function settleSyncBaselineCommit(input: {
  readonly apiClient: Partial<DocumentBaselineStageApi>;
  readonly baselineStageId: string | undefined;
  readonly documentId: string;
  readonly execSql: ExecSql;
  readonly outcome:
    | { readonly ok: true }
    | {
        readonly baselineStageCode?: string | undefined;
        readonly code?: string | undefined;
        readonly ok: false;
      };
}): Promise<boolean> {
  const api = documentBaselineStageApi(input.apiClient);
  const uploads = getOrCreateStagedBaselineUploads(input.execSql);
  const upload = uploads.get(input.documentId);
  if (
    !api ||
    !upload ||
    upload.state.status !== "committing" ||
    upload.state.baselineId !== input.baselineStageId
  ) {
    return false;
  }
  const { outcome } = input;
  const state = await settleStagedBaselineCommit(
    { api, attempt: upload.state.attempt, upload, uploads },
    outcome.ok
      ? outcome
      : {
          ...outcome,
          coverageCode: DOCUMENT_SYNC_ERROR_CODES.checkpointCoverageConflict,
        },
  );
  return !outcome.ok && replanAnswers(state);
}
