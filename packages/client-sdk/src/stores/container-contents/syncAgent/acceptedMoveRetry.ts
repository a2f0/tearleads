import type { ContainerContentsStoreSyncState } from "./syncAgentTypes";

/** Delays before each re-armed replay of one accepted but unsettled move. */
const ACCEPTED_MOVE_RETRY_DELAYS_MS = [1_000, 5_000, 30_000];

const retriesByState = new WeakMap<
  Pick<ContainerContentsStoreSyncState, "syncLane">,
  Map<string, number>
>();

/**
 * A replay settles an accepted move from its verified head, so one pass
 * normally suffices. A failure that repeats past these few waits for an
 * unrelated pass, as before, instead of re-arming the lane indefinitely; each
 * attempt has already been reported.
 */
export function createAcceptedMoveRetry(
  state: Pick<ContainerContentsStoreSyncState, "syncLane">,
): (intentId: string) => void {
  const syncLane = state.syncLane;
  return (intentId) => {
    let attempts = retriesByState.get(state);
    if (!attempts) {
      attempts = new Map();
      retriesByState.set(state, attempts);
    }
    const attempt = attempts.get(intentId) ?? 0;
    const delayMs = ACCEPTED_MOVE_RETRY_DELAYS_MS[attempt];
    if (delayMs === undefined) return;
    attempts.set(intentId, attempt + 1);
    syncLane?.requestSyncAfter(delayMs);
  };
}
