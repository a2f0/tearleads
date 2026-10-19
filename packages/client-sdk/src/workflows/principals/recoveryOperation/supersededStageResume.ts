import { assertProjectionVerificationCurrent } from "../../../data/keyingProjectionVerification/types";
import { isPrincipalHistoryStageChangedError } from "../../../data/persistence/principalHistory/principalHistoryStagePersistence";

/**
 * An acknowledged publication may supersede the exact head a queued recovery
 * is staging (`persistAcknowledgedPrincipalCurrents` writes outside the
 * recovery queue), and the recovery then loses its progress CAS. Resume once,
 * in the same queue turn, from the stage the publication left, instead of
 * failing the operation that asked for the policy. A second loss propagates.
 */
export async function resumeAfterSupersededStage<T>(
  attempt: () => Promise<T>,
  stillCurrent: () => boolean,
): Promise<T> {
  try {
    return await attempt();
  } catch (error) {
    if (!isPrincipalHistoryStageChangedError(error)) throw error;
    assertProjectionVerificationCurrent(stillCurrent);
    return attempt();
  }
}
