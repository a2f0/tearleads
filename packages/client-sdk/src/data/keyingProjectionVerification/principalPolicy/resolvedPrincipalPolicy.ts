import {
  KeyingVerificationError,
  type ReferencedPrincipalHead,
  type VerifiedPrincipalPolicyCurrent,
} from "@tearleads/crypto";
import { loadPrincipalPolicyCheckpoint } from "../../persistence/keyingCheckpoints/keyingCheckpointPersistence";
import { verifiedPrincipalPolicyMeetsCheckpoint } from "../../persistence/principalPolicy/principalPolicyCheckpointSelection";
import {
  observePrincipalPolicy,
  type ProjectionCheckpointContext,
} from "../checkpoints/checkpointContext";
import { observeProjectionLifetime } from "../projectionLifetimes";
import {
  assertProjectionVerificationCurrent,
  type PrincipalPolicyCache,
  type ReferencedPrincipalPolicyWarmer,
  type ResolvedPrincipalPolicyEvidence,
} from "../types";
import {
  referencedPrincipalPolicyKey,
  verifiedPrincipalPolicyContainsReference,
} from "./principalPolicyCache";

// Scoped evidence is always resolved through the warmer: its operation memo is
// the only reuse of recovered directory and Admins evidence, with one set of
// validity rules. The caller's policy cache keeps bare verified policies; it
// never stands in for organization, dependency or lifetime bindings.
async function meetsCheckpoints(
  context: ProjectionCheckpointContext,
  result: ResolvedPrincipalPolicyEvidence,
  refreshMissing: boolean,
): Promise<boolean> {
  for (const policy of [...result.dependencies, result.policy]) {
    const checkpoint = await loadPrincipalPolicyCheckpoint(
      context.execSql,
      policy.principalType,
      policy.principalId,
    );
    if (
      refreshMissing &&
      checkpoint &&
      (policy.version < checkpoint.version ||
        (policy.version > checkpoint.version &&
          !policy.retainedHistory.some(
            (entry) => entry.state.version === checkpoint.version,
          )))
    )
      return false;
    if (!verifiedPrincipalPolicyMeetsCheckpoint(policy, checkpoint))
      throw new KeyingVerificationError(
        "rollback",
        "Recovered principal evidence predates the durable checkpoint",
      );
  }
  return true;
}

interface ResolveReferencedPrincipalPolicyInput {
  readonly checkpointContext: ProjectionCheckpointContext;
  readonly organizationId: string;
  readonly stillCurrent?: (() => boolean) | undefined;
  readonly principalPolicyCache: PrincipalPolicyCache;
  readonly reference: ReferencedPrincipalHead;
  readonly warmReferencedPrincipalPolicies?:
    | ReferencedPrincipalPolicyWarmer
    | undefined;
}

async function recoverEvidence(
  input: ResolveReferencedPrincipalPolicyInput,
  resolve: NonNullable<ReferencedPrincipalPolicyWarmer["resolveReference"]>,
): Promise<ResolvedPrincipalPolicyEvidence> {
  const read = async (recoveryBatch?: object) => {
    assertProjectionVerificationCurrent(input.stillCurrent);
    const recovered = await resolve({
      recoveryBatch,
      organizationId: input.organizationId,
      reference: input.reference,
      stillCurrent: input.stillCurrent,
    });
    assertProjectionVerificationCurrent(input.stillCurrent);
    assertProjectionVerificationCurrent(recovered.stillCurrent);
    return recovered;
  };
  let result = await read();
  // A concurrent admission may advance a pin after recovery verified it.
  // Refresh once outside the operation's directory view; the fresh
  // recovery and final checkpoint check still reject rollback/equivocation.
  if (!(await meetsCheckpoints(input.checkpointContext, result, true))) {
    assertProjectionVerificationCurrent(result.stillCurrent);
    result = await read({});
    await meetsCheckpoints(input.checkpointContext, result, false);
  }
  return result;
}

export async function resolveReferencedPrincipalPolicy(
  input: ResolveReferencedPrincipalPolicyInput,
): Promise<VerifiedPrincipalPolicyCurrent | null> {
  assertProjectionVerificationCurrent(input.stillCurrent);
  const key = referencedPrincipalPolicyKey(input.reference);
  const resolve = input.warmReferencedPrincipalPolicies?.resolveReference;
  if (!resolve) return null;
  const result = await recoverEvidence(input, resolve);
  const evidenceCurrent = result.stillCurrent;
  // The consumer's and every producer's lifetime guard the evidence where it
  // is used: projection admission rechecks them through the context.
  const lifetime = () => input.stillCurrent?.() !== false && evidenceCurrent();
  assertProjectionVerificationCurrent(lifetime);
  observeProjectionLifetime(input.checkpointContext, lifetime);
  if (result.organizationId !== input.organizationId)
    throw new KeyingVerificationError(
      "object_mismatch",
      "Recovered principal evidence belongs to another organization",
    );
  if (!verifiedPrincipalPolicyContainsReference(result.policy, input.reference))
    throw new KeyingVerificationError(
      "object_mismatch",
      "Recovered principal evidence does not contain the exact citation",
    );
  for (const policy of [...result.dependencies, result.policy])
    observePrincipalPolicy(
      input.checkpointContext,
      policy,
      input.organizationId,
    );
  input.principalPolicyCache.set(key, result.policy);
  return result.policy;
}
