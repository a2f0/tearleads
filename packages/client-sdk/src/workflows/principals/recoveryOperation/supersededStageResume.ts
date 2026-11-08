import { assertProjectionVerificationCurrent } from "../../../data/keyingProjectionVerification/types";
import { isPrincipalHistoryStageChangedError } from "../../../data/persistence/principalHistory/principalHistoryStagePersistence";
import { PrincipalHeadAdmittedDuringRecoveryError } from "../historyRecovery/principalHistoryRecoveryTypes";

/**
 * Writers outside the recovery queue can supersede what a queued recovery
 * started from. An acknowledged publication may save the exact head it is
 * staging (`persistAcknowledgedPrincipalCurrents`), so the recovery loses its
 * progress CAS. Another verifier may admit exactly that head to the local
 * checkpoint while it reads history (`advanceKeyingCheckpointsAtomically`).
 * Resume once, in the same queue turn, from the state the other writer left,
 * instead of failing the operation that asked for the policy. The resumed
 * attempt verifies against that state from scratch. A second loss propagates,
 * as does a checkpoint that moved anywhere else.
 */
export async function resumeAfterSupersededStage<T>(
  attempt: () => Promise<T>,
  stillCurrent: () => boolean,
): Promise<T> {
  try {
    return await attempt();
  } catch (error) {
    if (
      !isPrincipalHistoryStageChangedError(error) &&
      !(error instanceof PrincipalHeadAdmittedDuringRecoveryError)
    )
      throw error;
    assertProjectionVerificationCurrent(stillCurrent);
    return attempt();
  }
}
