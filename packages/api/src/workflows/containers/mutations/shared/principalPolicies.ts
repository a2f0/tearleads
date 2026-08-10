import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import { gatherWithExecutor } from "@tearleads/api-shared/postgres";
import type {
  PrincipalProjectionMember,
  ReferencedPrincipalHead,
  VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import {
  getCurrentPrincipalStates,
  listPrincipalProjectionMembersForStates,
  type StoredPrincipalProjectionMember,
  type StoredPrincipalState,
} from "../../../../access/read/principalStateStore";
import { canonicalJsonEquals } from "../../../../utils/canonicalJson";
import {
  getCurrentPrincipalPolicyWithExecutor,
  getVerifiedPrincipalPolicyForStateWithExecutor,
} from "../../../principals/getCurrentPrincipalPolicy";
import { ContainerMutationError } from "../errors";

function projectionMemberKey(
  member: Pick<PrincipalProjectionMember, "userId" | "role">,
): string {
  return [member.userId, member.role].join(":");
}

function projectionMemberFromStored(
  member: StoredPrincipalProjectionMember,
): PrincipalProjectionMember {
  return {
    userId: member.userId,
    role: member.role,
  };
}

function principalPolicyKey(
  policy: Pick<VerifiedPrincipalPolicy, "principalId" | "principalType">,
): string {
  return `${policy.principalType}:${policy.principalId}`;
}

function principalProjectionStateKey(input: {
  readonly principalId: string;
  readonly stateHash: string;
}): string {
  return `${input.principalId}:${input.stateHash}`;
}

interface PrincipalPolicyArtifacts {
  readonly currentStateByPolicyKey: Map<string, StoredPrincipalState>;
  readonly projectionByPolicyKey: Map<
    string,
    StoredPrincipalProjectionMember[]
  >;
}

async function loadPrincipalPolicyArtifacts(
  executor: DatabaseTransaction,
  principalPolicies: readonly VerifiedPrincipalPolicy[],
): Promise<PrincipalPolicyArtifacts> {
  const currentStateByPolicyKey = new Map<string, StoredPrincipalState>();
  const projectionByPolicyKey = new Map<
    string,
    StoredPrincipalProjectionMember[]
  >();

  for (const principalType of [
    ...new Set(principalPolicies.map((policy) => policy.principalType)),
  ]) {
    const policiesForType = principalPolicies.filter(
      (policy) => policy.principalType === principalType,
    );
    const currentStates = await getCurrentPrincipalStates(
      principalType,
      policiesForType.map((policy) => policy.principalId),
      executor,
    );

    for (const policy of policiesForType) {
      const currentState = currentStates.get(policy.principalId);
      if (currentState) {
        currentStateByPolicyKey.set(principalPolicyKey(policy), currentState);
      }
    }

    const projections = await listPrincipalProjectionMembersForStates(
      principalType,
      [...currentStates.values()],
      executor,
    );

    for (const policy of policiesForType) {
      const currentState = currentStates.get(policy.principalId);
      if (currentState) {
        projectionByPolicyKey.set(
          principalPolicyKey(policy),
          projections.get(principalProjectionStateKey(currentState)) ?? [],
        );
      }
    }
  }

  return { currentStateByPolicyKey, projectionByPolicyKey };
}

function principalPolicyMatchesReference(
  policy: VerifiedPrincipalPolicy,
  reference: ReferencedPrincipalHead,
): boolean {
  return (
    policy.principalType === reference.principalType &&
    policy.principalId === reference.principalId &&
    policy.version === reference.version &&
    policy.keyEpoch === reference.keyEpoch &&
    policy.stateHash === reference.stateHash &&
    policy.state.keyFingerprint === reference.keyFingerprint
  );
}

function principalPolicyNeedsStoredHistory(
  policy: VerifiedPrincipalPolicy,
  referencedPrincipalHeads: readonly ReferencedPrincipalHead[],
): boolean {
  return referencedPrincipalHeads.some(
    (reference) =>
      policy.principalType === reference.principalType &&
      policy.principalId === reference.principalId &&
      !principalPolicyMatchesReference(policy, reference),
  );
}

function isPrincipalPolicyStateCurrent(
  policy: VerifiedPrincipalPolicy,
  currentState: StoredPrincipalState | undefined,
): boolean {
  return Boolean(
    currentState &&
      currentState.version === policy.version &&
      currentState.keyEpoch === policy.keyEpoch &&
      currentState.stateHash === policy.stateHash &&
      currentState.keyFingerprint === policy.state.keyFingerprint,
  );
}

function isPrincipalPolicyProjectionCurrent(
  policy: VerifiedPrincipalPolicy,
  storedProjection: readonly StoredPrincipalProjectionMember[],
): boolean {
  const storedProjectionKeys = storedProjection
    .map(projectionMemberFromStored)
    .map(projectionMemberKey)
    .sort();
  const policyProjectionKeys = policy.projection
    .map(projectionMemberKey)
    .sort();

  return (
    storedProjectionKeys.length === policyProjectionKeys.length &&
    !storedProjectionKeys.some(
      (storedKey, index) => storedKey !== policyProjectionKeys[index],
    )
  );
}

async function stalePrincipalPolicyError(input: {
  readonly artifacts: PrincipalPolicyArtifacts;
  readonly executor: DatabaseTransaction;
  readonly message: string;
  readonly policies: readonly VerifiedPrincipalPolicy[];
}): Promise<ContainerMutationError> {
  const seenPrincipalPolicyKeys = new Set<string>();
  const policiesToFetch: VerifiedPrincipalPolicy[] = [];

  // Stale-policy rejects are repairable: return the server's current signed
  // bundles so the client can verify, cache, rebuild the mutation, and retry.
  for (const policy of input.policies) {
    const key = principalPolicyKey(policy);
    if (
      seenPrincipalPolicyKeys.has(key) ||
      !input.artifacts.currentStateByPolicyKey.has(key)
    ) {
      continue;
    }

    seenPrincipalPolicyKeys.add(key);
    policiesToFetch.push(policy);
  }

  const principalPolicies = await gatherWithExecutor(
    input.executor,
    policiesToFetch,
    (policy) =>
      getCurrentPrincipalPolicyWithExecutor(
        input.executor,
        policy.principalType,
        policy.principalId,
      ),
  );

  return new ContainerMutationError(input.message, 409, {
    error: input.message,
    code: "principal_policy_stale",
    principalPolicies,
  });
}

export async function assertPrincipalPoliciesCurrent(
  executor: DatabaseTransaction,
  principalPolicies: readonly VerifiedPrincipalPolicy[],
  options: {
    readonly referencedPrincipalHeads?: readonly ReferencedPrincipalHead[];
  } = {},
): Promise<VerifiedPrincipalPolicy[]> {
  const artifacts = await loadPrincipalPolicyArtifacts(
    executor,
    principalPolicies,
  );
  const stalePolicies: VerifiedPrincipalPolicy[] = [];
  let staleMessage = "Principal policy is stale";

  for (const policy of principalPolicies) {
    const key = principalPolicyKey(policy);
    const currentState = artifacts.currentStateByPolicyKey.get(key);
    if (!isPrincipalPolicyStateCurrent(policy, currentState)) {
      stalePolicies.push(policy);
      continue;
    }

    if (
      !isPrincipalPolicyProjectionCurrent(
        policy,
        artifacts.projectionByPolicyKey.get(key) ?? [],
      )
    ) {
      staleMessage = "Principal policy projection is stale";
      stalePolicies.push(policy);
    }
  }

  if (stalePolicies.length > 0) {
    throw await stalePrincipalPolicyError({
      artifacts,
      executor,
      message: staleMessage,
      policies: stalePolicies,
    });
  }

  const referencedPrincipalHeads = options.referencedPrincipalHeads ?? [];
  return gatherWithExecutor(executor, principalPolicies, async (policy) => {
    const currentState = artifacts.currentStateByPolicyKey.get(
      principalPolicyKey(policy),
    );
    if (!currentState) {
      throw new ContainerMutationError("Principal policy is stale", 409);
    }

    const stored = await getVerifiedPrincipalPolicyForStateWithExecutor(
      executor,
      currentState,
    );
    const { createdAt: _createdAt, ...storedSignedState } =
      stored.bundle.currentState;
    if (!canonicalJsonEquals(policy.state, storedSignedState)) {
      throw new ContainerMutationError(
        "Principal policy payload does not match stored policy",
        409,
      );
    }
    if (
      principalPolicyNeedsStoredHistory(policy, referencedPrincipalHeads) &&
      !stored.policy.history
    ) {
      throw new ContainerMutationError(
        "Stored principal policy history is missing",
        409,
      );
    }
    return stored.policy;
  });
}
