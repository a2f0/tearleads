import {
  KeyingVerificationError,
  principalPolicyMatchesReference,
  type VerifiedPrincipalPolicyCurrent,
  type VerifiedPrincipalPolicySelection,
} from "@tearleads/crypto";
import { loadPrincipalPolicyCheckpoint } from "../persistence/keyingCheckpointPersistence";
import type { ProjectionCheckpointContext } from "./checkpointContext";
import {
  observeProjectionLifetime,
  projectionLifetimeGuard,
} from "./projectionLifetimes";
import {
  assertProjectionVerificationCurrent,
  type ReferencedPrincipalPolicyWarmer,
} from "./types";

export type PurgePolicyCurrencyEvidence =
  | VerifiedPrincipalPolicySelection
  | VerifiedPrincipalPolicyCurrent;

/** Authenticate connections to newer device pins without extending terminal grants or admitting heads. */
export async function recoverDocumentPurgePolicyCurrency(input: {
  readonly context: ProjectionCheckpointContext;
  readonly organizationId: string;
  readonly policies: readonly VerifiedPrincipalPolicySelection[];
  readonly warmer: ReferencedPrincipalPolicyWarmer | undefined;
  readonly stillCurrent: () => boolean;
}): Promise<PurgePolicyCurrencyEvidence[]> {
  const resolve = input.warmer?.resolveReference;
  if (!resolve) return [...input.policies];
  const recoveryBatch = {};
  const recovered = new Map<string, VerifiedPrincipalPolicyCurrent>();
  const policies: PurgePolicyCurrencyEvidence[] = [];
  for (const policy of input.policies) {
    // Returned leases may include their caller predicate. Pass the original
    // lifetime, not the growing context guard, to avoid a recursive guard graph.
    const stillCurrent = input.stillCurrent;
    assertProjectionVerificationCurrent(projectionLifetimeGuard(input.context));
    const checkpoint = await loadPrincipalPolicyCheckpoint(
      input.context.execSql,
      policy.principalType,
      policy.principalId,
    );
    if (!checkpoint || checkpoint.version <= policy.version) {
      policies.push(policy);
      continue;
    }
    const key = `${policy.principalType}:${policy.principalId}:${policy.stateHash}`;
    let bridge = recovered.get(key);
    if (!bridge) {
      const reference = {
        principalType: policy.principalType,
        principalId: policy.principalId,
        version: policy.version,
        stateHash: policy.stateHash,
        keyEpoch: policy.keyEpoch,
        keyFingerprint: policy.state.keyFingerprint,
      };
      const result = await resolve({
        organizationId: input.organizationId,
        reference,
        recoveryBatch,
        preferLocalHistory: true,
        stillCurrent,
      });
      assertProjectionVerificationCurrent(
        projectionLifetimeGuard(input.context),
      );
      assertProjectionVerificationCurrent(result.stillCurrent);
      if (
        result.organizationId !== input.organizationId ||
        !principalPolicyMatchesReference({ policy: result.policy, reference })
      )
        throw new KeyingVerificationError(
          "object_mismatch",
          "Purge currency recovery does not bind its historical policy",
        );
      observeProjectionLifetime(input.context, result.stillCurrent);
      bridge = result.policy;
      recovered.set(key, bridge);
    }
    policies.push(bridge);
  }
  assertProjectionVerificationCurrent(projectionLifetimeGuard(input.context));
  return policies;
}
