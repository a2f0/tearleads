import type {
  DocumentBaselineStageAbandonResponse,
  DocumentBaselineStageStatusResponse,
} from "@tearleads/validators/response";
import {
  abandonDocumentBaselineStage as abandonStageWorkflow,
  type CleanupExpiredDocumentBaselineStagesInput,
  cleanupExpiredDocumentBaselineStages,
  type DocumentBaselineStageInput,
  type OpenDocumentBaselineStageInput,
  openDocumentBaselineStage as openStageWorkflow,
  type ResignStagedBaselineSegmentHeaderInput,
  readDocumentBaselineStage as readStageWorkflow,
  resignStagedBaselineSegmentHeader as resignHeaderWorkflow,
  type StageDocumentBaselineSegmentInput,
  stageDocumentBaselineSegment as stageSegmentWorkflow,
} from "../../workflows/documents/baselineStages";
import { createDatabaseWorkflowService } from "../databaseWorkflowService";
import type { ApiServiceRuntime } from "../runtime";

export {
  DocumentBaselineStageBusyError,
  DocumentBaselineStageError,
  DocumentBaselineStageNotFoundError,
} from "../../workflows/documents/baselineStages";

export const openDocumentBaselineStage = createDatabaseWorkflowService<
  OpenDocumentBaselineStageInput,
  DocumentBaselineStageStatusResponse
>(openStageWorkflow);

export const getDocumentBaselineStage = createDatabaseWorkflowService<
  DocumentBaselineStageInput,
  DocumentBaselineStageStatusResponse
>(readStageWorkflow);

export const abandonDocumentBaselineStage = createDatabaseWorkflowService<
  DocumentBaselineStageInput,
  DocumentBaselineStageAbandonResponse
>(abandonStageWorkflow);

export const stageDocumentBaselineSegment = createDatabaseWorkflowService<
  StageDocumentBaselineSegmentInput,
  DocumentBaselineStageStatusResponse
>(stageSegmentWorkflow);

export const resignDocumentBaselineSegmentHeader =
  createDatabaseWorkflowService<
    ResignStagedBaselineSegmentHeaderInput,
    DocumentBaselineStageStatusResponse
  >(resignHeaderWorkflow);

/**
 * The hourly sweep of expired rotation baseline stages. A stage that failed
 * to delete is counted under `failed`, which the maintenance run reads to
 * record the phase as failed; the next run retries it. A run that stopped at
 * its budget with expired stages still stored says so under `remaining` and
 * in the log, so a backlog shows before it grows.
 */
export async function runDocumentBaselineStageMaintenance(
  runtime: ApiServiceRuntime,
  input: CleanupExpiredDocumentBaselineStagesInput = {},
): Promise<{
  readonly deleted: number;
  readonly failed: number;
  readonly remaining: number;
  readonly scanned: number;
}> {
  const result = await cleanupExpiredDocumentBaselineStages(runtime.db, input);
  for (const failure of result.failures) {
    console.error("Expired document baseline stage cleanup failed:", failure);
  }
  if (result.remainingStages > 0) {
    console.warn(
      `Expired document baseline stage cleanup left ${result.remainingStages} stage(s) for the next run`,
    );
  }
  return {
    deleted: result.deletedStages,
    failed: result.failures.length,
    remaining: result.remainingStages,
    scanned: result.scannedStages,
  };
}
