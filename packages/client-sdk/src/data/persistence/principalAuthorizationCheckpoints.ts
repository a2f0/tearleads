import {
  KeyingVerificationError,
  type VerifiedPrincipalPolicySelection,
  verifyPrincipalPolicyCheckpoint,
} from "@tearleads/crypto";
import type { ClientSQLiteTransactionScope } from "../sqlite/sqlitePersistenceRuntime";
import { loadStoredPrincipalPolicyCheckpoint } from "./keyingCheckpointPersistence";

export class PrincipalAuthorizationCheckpointUnavailableError extends KeyingVerificationError {
  constructor() {
    super(
      "missing_dependency",
      "Public authorization cannot connect to the latest durable checkpoint",
    );
  }
}

/** Historical capabilities validate trust but never advance current-policy pins. */
export async function validatePrincipalAuthorizationCheckpoints(
  tx: ClientSQLiteTransactionScope,
  policies: readonly VerifiedPrincipalPolicySelection[],
): Promise<void> {
  for (const policy of policies) {
    const checkpoint = await loadStoredPrincipalPolicyCheckpoint(tx, policy);
    if (!checkpoint) continue;
    const matchingHead = policies.filter(
      (other) =>
        other.principalType === policy.principalType &&
        other.principalId === policy.principalId &&
        other.stateHash === policy.stateHash,
    );
    const chain = matchingHead.flatMap((other) => other.retainedHistory);
    if (
      checkpoint.version > policy.version ||
      (checkpoint.version < policy.version &&
        !chain.some(({ state }) => state.version === checkpoint.version))
    )
      throw new PrincipalAuthorizationCheckpointUnavailableError();
    verifyPrincipalPolicyCheckpoint({
      chain,
      currentState: policy.state,
      localCheckpoint: checkpoint,
    });
  }
}
