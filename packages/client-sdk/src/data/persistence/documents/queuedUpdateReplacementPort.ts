import type { ExecSql } from "../../sqlite/sqlSchema";
import type { QueuedUpdateReplacement } from "./records";

export interface ReplaceQueuedPendingUpdatesInput
  extends QueuedUpdateReplacement {
  localId: string;
}

/** The `DocumentsPersistence` member that merges queued local updates. */
export interface QueuedPendingUpdateReplacementPort {
  /**
   * Replace a contiguous run of queued local updates with one merged update,
   * all or nothing. Inside one mutation, check that the document still has
   * `expectedDocumentId` and `expectedRecoveryGeneration`, and that every
   * member is still queued under its id as an ordinary local row (not an
   * outbox row, not a rotation checkpoint), the members are contiguous in
   * queue order with no other queued row between them, and the first listed
   * member is first. On success, update the first member in place (same row,
   * same queue and history position) with a fresh update id, the merged data
   * and vectors, and `rekeyCount`, delete the other members, and resolve to
   * the new update id. When any check fails, change nothing and resolve null.
   */
  replaceQueuedPendingUpdates: (
    execSql: ExecSql,
    input: ReplaceQueuedPendingUpdatesInput,
  ) => Promise<string | null>;
}
