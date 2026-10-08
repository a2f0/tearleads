import { assertProjectionVerificationCurrent } from "../../data/keyingProjectionVerification/types";
import { ownPrincipalHistoryProtection } from "../../data/principals/principalHistoryProtection";
import type {
  PrincipalRecoveryContext,
  RecoveredPolicyDirectory,
} from "./principalRecoveryDirectory";
import {
  createPrincipalRecoveryReader,
  type PrincipalRecoveryMemo,
} from "./principalRecoveryMemo";
import { isPrincipalRecoveryOutage } from "./principalRecoveryOutage";

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
    try {
      directory = await createPrincipalRecoveryReader(input, memo).directory(
        [],
      );
    } catch (error) {
      assertProjectionVerificationCurrent(input.stillCurrent);
      if (input.offline || !isPrincipalRecoveryOutage(error)) throw error;
      directory = await createPrincipalRecoveryReader(
        { ...input, offline: true },
        memo,
      ).directory([]);
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
