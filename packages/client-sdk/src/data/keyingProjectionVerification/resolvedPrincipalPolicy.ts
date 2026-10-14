import {
  KeyingVerificationError,
  type ReferencedPrincipalHead,
  type VerifiedPrincipalPolicyCurrent,
} from "@tearleads/crypto";
import { loadPrincipalPolicyCheckpoint } from "../persistence/keyingCheckpointPersistence";
import { verifiedPrincipalPolicyMeetsCheckpoint } from "../persistence/principalPolicyCheckpointSelection";
import { principalRecoveryEpoch } from "../principals/principalRecoveryEpoch";
import {
  observePrincipalPolicy,
  type ProjectionCheckpointContext,
} from "./checkpointContext";
import {
  referencedPrincipalPolicyKey,
  verifiedPrincipalPolicyContainsReference,
} from "./principalPolicyCache";
import { observeProjectionLifetime } from "./projectionLifetimes";
import {
  assertProjectionVerificationCurrent,
  type PrincipalPolicyCache,
  principalPolicyWarmerOperation,
  type ReferencedPrincipalPolicyWarmer,
  type ResolvedPrincipalPolicyEvidence,
} from "./types";

// Sparse cache hits must carry the organization binding and every dependency
// into each new admission batch; a bare current-policy capability is insufficient.
// The caller owns this cache, but a remembered entry is bound to the workflow
// operation and organization hint epoch that produced it, like the warmer's
// recovery memo: a shared cache never carries evidence into another operation
// or past a hint, and an ended producer lifetime disables reuse.
interface RememberedPrincipalPolicyEvidence
  extends ResolvedPrincipalPolicyEvidence {
  readonly operation: object;
  /** Organization hint epoch observed before the reads that produced it. */
  readonly epoch: number;
}

const recoveredByCache = new WeakMap<
  PrincipalPolicyCache,
  Map<string, RememberedPrincipalPolicyEvidence>
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

function recoveryEpoch(input: ResolveReferencedPrincipalPolicyInput): number {
  return principalRecoveryEpoch(
    input.checkpointContext.execSql,
    input.organizationId,
  );
}

/** Reuse only this operation's live evidence that still meets durable pins. */
async function rememberedEvidence(
  input: ResolveReferencedPrincipalPolicyInput,
  key: string,
  operation: object | undefined,
): Promise<RememberedPrincipalPolicyEvidence | undefined> {
  const remembered = recoveredByCache.get(input.principalPolicyCache)?.get(key);
  const live = (entry: RememberedPrincipalPolicyEvidence) =>
    operation !== undefined &&
    entry.operation === operation &&
    entry.epoch === recoveryEpoch(input) &&
    entry.stillCurrent();
  if (
    !remembered ||
    remembered.organizationId !== input.organizationId ||
    remembered.policy !== input.principalPolicyCache.get(key) ||
    !live(remembered)
  )
    return undefined;
  if (!(await meetsCheckpoints(input.checkpointContext, remembered, true)))
    return undefined;
  // A hint or lifetime end during the pin reads also disables reuse.
  return live(remembered) ? remembered : undefined;
}

async function recoverEvidence(
  input: ResolveReferencedPrincipalPolicyInput,
  resolve: NonNullable<ReferencedPrincipalPolicyWarmer["resolveReference"]>,
): Promise<{ result: ResolvedPrincipalPolicyEvidence; epoch: number }> {
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
  let epoch = recoveryEpoch(input);
  let result = await read();
  // A concurrent admission may advance a pin after recovery verified it.
  // Refresh once outside the operation's directory view; the fresh
  // recovery and final checkpoint check still reject rollback/equivocation.
  if (!(await meetsCheckpoints(input.checkpointContext, result, true))) {
    assertProjectionVerificationCurrent(result.stillCurrent);
    epoch = recoveryEpoch(input);
    result = await read({});
    await meetsCheckpoints(input.checkpointContext, result, false);
  }
  return { result, epoch };
}

export async function resolveReferencedPrincipalPolicy(
  input: ResolveReferencedPrincipalPolicyInput,
): Promise<VerifiedPrincipalPolicyCurrent | null> {
  assertProjectionVerificationCurrent(input.stillCurrent);
  const key = referencedPrincipalPolicyKey(input.reference);
  const operation = principalPolicyWarmerOperation(
    input.warmReferencedPrincipalPolicies,
  );
  const candidate = await rememberedEvidence(input, key, operation);
  // Recheck synchronously with use: a hint may land while awaiting.
  const remembered =
    candidate?.epoch === recoveryEpoch(input) && candidate.stillCurrent()
      ? candidate
      : undefined;
  let result: ResolvedPrincipalPolicyEvidence | undefined = remembered;
  let epoch = remembered?.epoch;
  if (!result) {
    const resolve = input.warmReferencedPrincipalPolicies?.resolveReference;
    if (!resolve) return null;
    ({ result, epoch } = await recoverEvidence(input, resolve));
  }
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
  if (operation && epoch !== undefined)
    rememberEvidence(input, key, { ...result, operation, epoch });
  input.principalPolicyCache.set(key, result.policy);
  return result.policy;
}

function rememberEvidence(
  input: ResolveReferencedPrincipalPolicyInput,
  key: string,
  evidence: RememberedPrincipalPolicyEvidence,
): void {
  let rememberedPolicies = recoveredByCache.get(input.principalPolicyCache);
  if (!rememberedPolicies) {
    rememberedPolicies = new Map();
    recoveredByCache.set(input.principalPolicyCache, rememberedPolicies);
  }
  rememberedPolicies.set(key, {
    ...evidence,
    dependencies: [...evidence.dependencies],
  });
}
