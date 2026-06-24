import {
  type PruneDominatedUpdatesInput,
  type PruneDominatedUpdatesResult,
  runPruneDominatedUpdatesWorkflow,
} from "../../workflows/documents/gc/pruneDominatedUpdates";
import type { ApiServiceRuntime } from "../runtime";

interface DocumentCompactionSummary {
  readonly prunedDominatedUpdates: PruneDominatedUpdatesResult;
}

/**
 * One entrypoint for scheduled document storage compaction. Currently reclaims
 * the payload of rotate_baseline-dominated pre-rotation updates; intended to be
 * invoked by an out-of-process trigger (see scripts/documentCompaction.ts).
 * Nothing schedules it in the app process.
 */
export async function runDocumentCompaction(
  runtime: ApiServiceRuntime,
  input: PruneDominatedUpdatesInput = {},
): Promise<DocumentCompactionSummary> {
  const prunedDominatedUpdates = await runPruneDominatedUpdatesWorkflow(
    runtime.db,
    input,
  );
  return { prunedDominatedUpdates };
}
