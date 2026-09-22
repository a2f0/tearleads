import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import type { VerifiedPrincipalPolicy } from "@tearleads/crypto";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import type { StoredPrincipalState } from "../../access/read/principalStateStore";
import { StoredVerificationCache } from "../../utils/storedVerificationCache";
import { buildPrincipalPolicyForStateWithExecutor } from "./principalPolicyBundleRecords";
import { loadStoredPrincipalPolicyVerificationSource } from "./storedPrincipalPolicySource";
import { verifyStoredPrincipalPolicyBundle } from "./storedPrincipalPolicyVerification";

interface VerifiedPrincipalPolicyBundle {
  readonly bundle: PrincipalPolicyBundleResponse;
  readonly policy: VerifiedPrincipalPolicy;
}

const verifiedStoredPrincipalPolicies =
  new StoredVerificationCache<VerifiedPrincipalPolicy>(2_048);

export async function getVerifiedPrincipalPolicyForStateWithExecutor(
  executor: DatabaseSession,
  currentState: StoredPrincipalState,
): Promise<VerifiedPrincipalPolicyBundle> {
  const bundle = await buildPrincipalPolicyForStateWithExecutor(
    executor,
    currentState,
  );
  const source = await loadStoredPrincipalPolicyVerificationSource({
    bundle,
    executor,
  });
  const cached = verifiedStoredPrincipalPolicies.get(
    currentState.stateHash,
    source,
  );
  if (cached) {
    return { bundle, policy: cached };
  }
  const policy = await verifyStoredPrincipalPolicyBundle({ source });
  verifiedStoredPrincipalPolicies.set(currentState.stateHash, source, policy);
  return {
    bundle,
    policy,
  };
}

/**
 * Re-verifies a just-stored state from its rows inside the caller's
 * transaction WITHOUT touching the process-wide verified cache: the rows are
 * not committed yet, so a cache entry minted here would let a concurrent
 * request treat an uncommitted (or later rolled back) chain as verified.
 */
export async function verifyStoredPrincipalPolicyForStateWithExecutor(
  executor: DatabaseSession,
  currentState: StoredPrincipalState,
): Promise<VerifiedPrincipalPolicy> {
  const bundle = await buildPrincipalPolicyForStateWithExecutor(
    executor,
    currentState,
  );
  const source = await loadStoredPrincipalPolicyVerificationSource({
    bundle,
    executor,
  });
  return verifyStoredPrincipalPolicyBundle({ source });
}

export async function getPrincipalPolicyForStateWithExecutor(
  executor: DatabaseSession,
  currentState: StoredPrincipalState,
): Promise<PrincipalPolicyBundleResponse> {
  return (
    await getVerifiedPrincipalPolicyForStateWithExecutor(executor, currentState)
  ).bundle;
}
