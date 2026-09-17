import { KeyingVerificationError } from "@tearleads/crypto";
import { persistVerifiedPrincipalPolicyBundlesAtomically } from "../../data/persistence/keyingCheckpointAdvancePersistence";

class PolicyCacheAdvanceRace extends Error {
  constructor(readonly verificationError: KeyingVerificationError) {
    super(verificationError.message);
  }
}

/** Only a fully verified candidate losing the atomic commit race can retry. */
export async function persistPrincipalPolicyCacheEntries(
  input: Parameters<typeof persistVerifiedPrincipalPolicyBundlesAtomically>[0],
): Promise<void> {
  try {
    await persistVerifiedPrincipalPolicyBundlesAtomically(input);
  } catch (error) {
    if (error instanceof KeyingVerificationError && error.code === "rollback")
      throw new PolicyCacheAdvanceRace(error);
    throw error;
  }
}

/** Discard stale snapshots once; the replacement must pass every normal check. */
export async function retryPrincipalPolicyCacheAdvance<Result>(
  operation: (fresh: boolean) => Promise<Result>,
): Promise<Result> {
  try {
    return await operation(false);
  } catch (error) {
    if (!(error instanceof PolicyCacheAdvanceRace)) throw error;
  }
  try {
    return await operation(true);
  } catch (error) {
    throw error instanceof PolicyCacheAdvanceRace
      ? error.verificationError
      : error;
  }
}
