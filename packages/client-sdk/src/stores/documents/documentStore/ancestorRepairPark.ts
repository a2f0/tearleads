import type { DocumentStoreState } from "./state";

/** The abandon reason for a stale ancestor only another member can re-key. */
const INACCESSIBLE_ANCESTOR_REPAIR = "inaccessible";

/**
 * Park queued writes behind an ancestor repair this writer cannot perform. The
 * repairing member's rekey reaches this client only as a projection
 * invalidation hint, which drops caches but schedules nothing, so a parked
 * document would otherwise wait for an unrelated trigger.
 *
 * Returns true when a hint already landed while the pass was in flight: that
 * pass may have judged a projection fetched before the repair, and the hint it
 * would wait for has come and gone, so the caller re-runs instead of parking.
 */
export function parkForAncestorRepair(
  state: DocumentStoreState,
  reason: string,
  writerProjectionGenerationAtStart: number,
): boolean {
  if (reason !== INACCESSIBLE_ANCESTOR_REPAIR) return false;
  if (state.writerProjectionGeneration !== writerProjectionGenerationAtStart) {
    return true;
  }
  state.awaitingAncestorRepair = true;
  return false;
}

/** Consume the park on a projection invalidation hint; true means re-run. */
export function resumeAfterAncestorRepairHint(
  state: DocumentStoreState,
): boolean {
  if (!state.awaitingAncestorRepair) return false;
  state.awaitingAncestorRepair = false;
  return true;
}
