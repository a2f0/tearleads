import { KeyingVerificationError } from "@tearleads/crypto";
import { assertProjectionVerificationCurrent } from "../../data/keyingProjectionVerification/types";
import { principalHeadMatchesReference } from "../../data/principals/organizationAuthorityDescriptor";
import { PrincipalHistoryRecoveryRaceError } from "./principalHistoryRecoveryTypes";
import { recoverWithPrincipalOutageFallback } from "./principalRecoveryOutage";
import type { recoverScopedPrincipalPolicyHistory } from "./recoverScopedPrincipalPolicyHistory";

/** Reuse authenticated local artifacts only for the exact current head a caller selected. */
export async function recoverWithPrincipalLocalPreference(
  recover: typeof recoverScopedPrincipalPolicyHistory,
  options: Parameters<typeof recoverScopedPrincipalPolicyHistory>[0],
  preferLocalCurrent: boolean,
) {
  if (preferLocalCurrent && !options.offline) {
    try {
      const local = await recover({
        ...options,
        offline: true,
      });
      assertProjectionVerificationCurrent(options.stillCurrent);
      if (principalHeadMatchesReference(local.policy.state, options.reference))
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
