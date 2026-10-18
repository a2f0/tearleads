import { assertProjectionVerificationCurrent } from "../../../data/keyingProjectionVerification/types";
import { ownPrincipalHistoryProtection } from "../../../data/principals/principalHistoryProtection";
import type {
  PrincipalRecoveryContext,
  RecoveredPolicyDirectory,
} from "../recoveryOperation/principalRecoveryDirectory";
import {
  createPrincipalRecoveryReader,
  type PrincipalRecoveryMemo,
} from "../recoveryOperation/principalRecoveryMemo";
import { isPrincipalRecoveryOutage } from "../recoveryOperation/principalRecoveryOutage";

/** Discover and verify current directory artifacts, including protected offline recovery. */
export async function recoverCurrentOrganizationPolicy(
  options: PrincipalRecoveryContext,
  memo?: PrincipalRecoveryMemo,
) {
  const input = {
    ...options,
    protection: ownPrincipalHistoryProtection(options.protection),
  };
  try {
    let directory: RecoveredPolicyDirectory;
    let reader = createPrincipalRecoveryReader(input, memo);
    try {
      directory = await reader.directory([]);
    } catch (error) {
      assertProjectionVerificationCurrent(input.stillCurrent);
      if (input.offline || !isPrincipalRecoveryOutage(error)) throw error;
      reader = createPrincipalRecoveryReader({ ...input, offline: true }, memo);
      directory = await reader.directory([]);
    }
    // A reused directory keeps its producer's lifetime to the point of use.
    const stillCurrent = () => input.stillCurrent() && reader.stillCurrent();
    assertProjectionVerificationCurrent(stillCurrent);
    return {
      current: directory.current,
      policy: directory.policy,
      dependencies: [],
      stillCurrent,
    };
  } finally {
    input.protection.localKey.fill(0);
  }
}
