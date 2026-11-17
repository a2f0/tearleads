import type { ContainerMoveIntentSyncInput } from "../types";

/**
 * Settle a queued move whose request the server refused or could not take.
 *
 * The billing gate learns that an organization cannot sync only from a 402, so
 * the refused request may itself be that first one. The intent then stays
 * pending with no error, exactly as the preflight holds it on every later pass
 * (sync-edge-cases row 19): a recorded error would replace the queue's
 * "billing paused" note and outlive the pause. Anything else is recorded.
 */
export async function settleRefusedContainerMove(
  input: ContainerMoveIntentSyncInput,
  organizationId: string,
): Promise<"blocked" | "failed"> {
  if (input.isRemoteSyncBlocked(organizationId)) return "blocked";
  const { intent, state } = input;
  await state.persistence.recordMoveIntentError(state.runtime.infra.execSql, {
    containerId: intent.containerId,
    expectedIntentId: intent.id,
    expectedUpdatedAt: intent.updatedAt,
    message: "Remote container move was rejected or unavailable",
    stillCurrent: input.isCurrent,
  });
  return "failed";
}
