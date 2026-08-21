import type {
  ApiDatabase,
  DatabaseSession,
} from "@symcrypt/api-shared/postgres";
import type { VerifiedPrincipalPolicy } from "@symcrypt/crypto";
import type { PrincipalPolicyBundleResponse } from "@symcrypt/validators/response";
import {
  getCurrentPrincipalState,
  type StoredPrincipalState,
} from "../../access/read/principalStateStore";
import { StoredVerificationCache } from "../../utils/storedVerificationCache";
import { buildPrincipalPolicyForStateWithExecutor } from "./principalPolicyBundleRecords";
import { PrincipalPolicyError } from "./shared";
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

export async function getPrincipalPolicyForStateWithExecutor(
  executor: DatabaseSession,
  currentState: StoredPrincipalState,
): Promise<PrincipalPolicyBundleResponse> {
  return (
    await getVerifiedPrincipalPolicyForStateWithExecutor(executor, currentState)
  ).bundle;
}

export async function getCurrentPrincipalPolicyWithExecutor(
  executor: DatabaseSession,
  principalType: "group" | "organization",
  principalId: string,
): Promise<PrincipalPolicyBundleResponse> {
  const currentState = await getCurrentPrincipalState(
    principalType,
    principalId,
    executor,
  );

  if (!currentState) {
    throw new PrincipalPolicyError("Principal state not found", 404);
  }
  return getPrincipalPolicyForStateWithExecutor(executor, currentState);
}

export async function runGetCurrentPrincipalPolicyWorkflow(
  db: ApiDatabase,
  principalType: "group" | "organization",
  principalId: string,
): Promise<PrincipalPolicyBundleResponse> {
  return db.transaction((tx) =>
    getCurrentPrincipalPolicyWithExecutor(tx, principalType, principalId),
  );
}
