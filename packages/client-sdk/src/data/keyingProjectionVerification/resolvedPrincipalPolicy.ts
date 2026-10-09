import {
  KeyingVerificationError,
  type ReferencedPrincipalHead,
  type VerifiedPrincipalPolicyCurrent,
} from "@tearleads/crypto";
import { loadPrincipalPolicyCheckpoint } from "../persistence/keyingCheckpointPersistence";
import { verifiedPrincipalPolicyMeetsCheckpoint } from "../persistence/principalPolicyCheckpointSelection";
import {
  observePrincipalPolicy,
  type ProjectionCheckpointContext,
} from "./checkpointContext";
import {
  referencedPrincipalPolicyKey,
  verifiedPrincipalPolicyContainsReference,
} from "./principalPolicyCache";
import {
  assertProjectionVerificationCurrent,
  type PrincipalPolicyCache,
  type ReferencedPrincipalPolicyWarmer,
  type ResolvedPrincipalPolicyEvidence,
} from "./types";

// Sparse cache hits must carry the organization binding and every dependency
// into each new admission batch; a bare current-policy capability is insufficient.
// The caller owns this cache. Cross-generation reuse is deliberately disabled by
// the saved guard; a new lifetime restores authenticated persistent evidence.
const recoveredByCache = new WeakMap<
  PrincipalPolicyCache,
  Map<string, ResolvedPrincipalPolicyEvidence>
>();

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

export async function resolveReferencedPrincipalPolicy(input: {
  readonly recoveryBatch?: object | undefined;
  readonly checkpointContext: ProjectionCheckpointContext;
  readonly organizationId: string;
  readonly stillCurrent?: (() => boolean) | undefined;
  readonly principalPolicyCache: PrincipalPolicyCache;
  readonly reference: ReferencedPrincipalHead;
  readonly warmReferencedPrincipalPolicies?:
    | ReferencedPrincipalPolicyWarmer
    | undefined;
}): Promise<VerifiedPrincipalPolicyCurrent | null> {
  assertProjectionVerificationCurrent(input.stillCurrent);
  const key = referencedPrincipalPolicyKey(input.reference);
  const remembered = recoveredByCache.get(input.principalPolicyCache)?.get(key);
  let result =
    remembered?.organizationId === input.organizationId &&
    remembered.policy === input.principalPolicyCache.get(key) &&
    remembered.stillCurrent()
      ? remembered
      : undefined;
  if (
    result &&
    !(await meetsCheckpoints(input.checkpointContext, result, true))
  )
    result = undefined;
  if (!result) {
    const resolve = input.warmReferencedPrincipalPolicies?.resolveReference;
    if (!resolve) return null;
    const read = async (recoveryBatch: object | undefined) => {
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
    result = await read(input.recoveryBatch);
    // A concurrent admission may advance a pin after recovery verified it.
    // Refresh once outside the old batch's pinned directory view; the fresh
    // recovery and final checkpoint check still reject rollback/equivocation.
    if (!(await meetsCheckpoints(input.checkpointContext, result, true))) {
      assertProjectionVerificationCurrent(result.stillCurrent);
      result = await read({});
      await meetsCheckpoints(input.checkpointContext, result, false);
    }
  }
  assertProjectionVerificationCurrent(input.stillCurrent);
  assertProjectionVerificationCurrent(result.stillCurrent);
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
  let rememberedPolicies = recoveredByCache.get(input.principalPolicyCache);
  if (!rememberedPolicies) {
    rememberedPolicies = new Map();
    recoveredByCache.set(input.principalPolicyCache, rememberedPolicies);
  }
  rememberedPolicies.set(key, {
    ...result,
    dependencies: [...result.dependencies],
  });
  input.principalPolicyCache.set(key, result.policy);
  return result.policy;
}
