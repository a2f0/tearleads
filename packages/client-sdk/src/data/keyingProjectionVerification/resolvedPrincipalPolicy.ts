import {
  KeyingVerificationError,
  type ReferencedPrincipalHead,
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
  readonly checkpointContext: ProjectionCheckpointContext;
  readonly organizationId: string;
  readonly principalPolicyCache: PrincipalPolicyCache;
  readonly reference: ReferencedPrincipalHead;
  readonly warmReferencedPrincipalPolicies?:
    | ReferencedPrincipalPolicyWarmer
    | undefined;
}) {
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
    result = await resolve({
      organizationId: input.organizationId,
      reference: input.reference,
    });
    await meetsCheckpoints(input.checkpointContext, result, false);
  }
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
