import { assertProjectionVerificationCurrent } from "../../data/keyingProjectionVerification/types";
import { ownPrincipalHistoryProtection } from "../../data/principals/principalHistoryProtection";
import {
  type PrincipalRecoveryContext,
  recoverPolicyDirectory,
} from "./principalRecoveryDirectory";
import { isPrincipalRecoveryOutage } from "./principalRecoveryOutage";

/** Discover and verify current directory artifacts, including protected offline recovery. */
export async function recoverCurrentOrganizationPolicy(
  options: PrincipalRecoveryContext,
) {
  const input = {
    ...options,
    protection: ownPrincipalHistoryProtection(options.protection),
  };
  try {
    let directory: Awaited<ReturnType<typeof recoverPolicyDirectory>>;
    try {
      directory = await recoverPolicyDirectory(input, []);
    } catch (error) {
      assertProjectionVerificationCurrent(input.stillCurrent);
      if (input.offline || !isPrincipalRecoveryOutage(error)) throw error;
      directory = await recoverPolicyDirectory({ ...input, offline: true }, []);
    }
    assertProjectionVerificationCurrent(input.stillCurrent);
    return {
      current: directory.current,
      policy: directory.policy,
      dependencies: [],
    };
  } finally {
    input.protection.localKey.fill(0);
  }
}
