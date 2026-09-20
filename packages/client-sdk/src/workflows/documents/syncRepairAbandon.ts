import type { AncestorRepairAbandonReason } from "./syncTrace";

/**
 * A repair that cannot proceed for a routine reason: the organization's writes
 * are gated, the server refused the rekey, a peer rotated an ancestor mid-pass,
 * the refreshed projection was unavailable, or the pass exhausted its repair
 * budget. None is a defect, so the sync lane abandons the attempt rather than
 * reporting a failed run; the next trigger re-plans from a fresh projection.
 *
 * Lives apart from both the planner and the preparation loop: each throws it,
 * and preparation already imports the planner, so declaring it in either would
 * close a dependency cycle.
 */
export class DocumentAncestorRepairAbandonedError extends Error {
  constructor(readonly reason: AncestorRepairAbandonReason) {
    super(`Document ancestor repair abandoned: ${reason}`);
    this.name = "DocumentAncestorRepairAbandonedError";
  }
}
