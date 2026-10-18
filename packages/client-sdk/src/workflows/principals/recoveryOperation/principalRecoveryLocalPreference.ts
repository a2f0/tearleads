import { KeyingVerificationError } from "@tearleads/crypto";
import { assertProjectionVerificationCurrent } from "../../../data/keyingProjectionVerification/types";
import { principalHeadMatchesReference } from "../../../data/principals/organizationAuthorityDescriptor";
import { PrincipalHistoryRecoveryRaceError } from "../historyRecovery/principalHistoryRecoveryTypes";
import type {
  RecoverScopedPrincipalPolicyHistoryOptions,
  ScopedPrincipalPolicyRecoveryBatch,
} from "../historyRecovery/recoverScopedPrincipalPolicyHistory";
import { recoverWithPrincipalOutageFallback } from "./principalRecoveryOutage";

/** Reuse exact current artifacts, or a proved historical page within a newer prefix. */
export async function recoverWithPrincipalLocalPreference(
  recover: ScopedPrincipalPolicyRecoveryBatch,
  options: RecoverScopedPrincipalPolicyHistoryOptions,
  preferLocalCurrent: boolean,
  allowHistoricalReference = false,
) {
  if (preferLocalCurrent && !options.offline) {
    try {
      const local = await recover({
        ...options,
        offline: true,
      });
      assertProjectionVerificationCurrent(options.stillCurrent);
      if (
        allowHistoricalReference ||
        options.historyPage ||
        principalHeadMatchesReference(local.policy.state, options.reference)
      )
        return local;
    } catch (error) {
      assertProjectionVerificationCurrent(options.stillCurrent);
      if (
        !(error instanceof PrincipalHistoryRecoveryRaceError) &&
        !(
          error instanceof KeyingVerificationError &&
          error.code === "missing_dependency"
        )
      )
        throw error;
    }
  }
  return recoverWithPrincipalOutageFallback(recover, options);
}
