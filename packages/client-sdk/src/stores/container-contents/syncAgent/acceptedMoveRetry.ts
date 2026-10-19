import type { AcceptedMoveRetry } from "../../../workflows/container-contents/container-state/types";
import type { ContainerContentsStoreSyncState } from "./syncAgentTypes";

/** Delays before each re-armed replay of one accepted but unsettled move. */
const ACCEPTED_MOVE_RETRY_DELAYS_MS = [1_000, 5_000, 30_000];

const attemptsByState = new WeakMap<
  Pick<ContainerContentsStoreSyncState, "syncLane">,
  Map<string, number>
>();

/**
 * A replay settles an accepted move from its verified head, so one pass
 * normally suffices. The budget is the intent's, across passes: a replay that
 * fails before reaching the server, say on a projection read, resumes it. A
 * failure that repeats past it waits for an unrelated pass, as before, instead
 * of re-arming the lane indefinitely; each attempt has already been reported.
 * One pass schedules each intent at most once.
 */
export function createAcceptedMoveRetry(
  state: Pick<ContainerContentsStoreSyncState, "syncLane">,
): AcceptedMoveRetry {
  const syncLane = state.syncLane;
  let attempts = attemptsByState.get(state);
  if (!attempts) {
    attempts = new Map();
    attemptsByState.set(state, attempts);
  }
  const intentAttempts = attempts;
  const scheduledThisPass = new Set<string>();
  const schedule = (intentId: string) => {
    if (scheduledThisPass.has(intentId)) return;
    scheduledThisPass.add(intentId);
    const attempt = intentAttempts.get(intentId) ?? 0;
    const delayMs = ACCEPTED_MOVE_RETRY_DELAYS_MS[attempt];
    if (delayMs === undefined) return;
    intentAttempts.set(intentId, attempt + 1);
    syncLane?.requestSyncAfter(delayMs);
  };
  return {
    arm: schedule,
    resume: (intentId) => {
      if (intentAttempts.has(intentId)) schedule(intentId);
    },
  };
}
