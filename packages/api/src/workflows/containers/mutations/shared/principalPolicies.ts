import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import { gatherWithExecutor } from "@tearleads/api-shared/postgres";
import type {
  PrincipalPolicySignedState,
  PrincipalProjectionMember,
  ReferencedPrincipalHead,
  VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import {
  normalizePrincipalContainerGrants,
  normalizePrincipalProjectionMembers,
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
import { ContainerMutationError, mutationStateStale } from "../errors";
import type { PrincipalPolicyRequestArtifact } from "./principalPolicyRecords";

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
  policy: Pick<PrincipalPolicyRequestArtifact, "principalId" | "principalType">,
): string {
  return `${policy.principalType}:${policy.principalId}`;
}

function principalPolicyArtifactRecord(
  policy: PrincipalPolicyRequestArtifact,
  state: PrincipalPolicySignedState = policy.state,
): Record<string, unknown> {
  return {
    checkpoint: policy.checkpoint,
    grants: normalizePrincipalContainerGrants(policy.grants),
    keyEpoch: policy.keyEpoch,
    principalId: policy.principalId,
    principalType: policy.principalType,
    projection: normalizePrincipalProjectionMembers(policy.projection),
    state,
    stateHash: policy.stateHash,
    version: policy.version,
  };
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
  principalPolicies: readonly PrincipalPolicyRequestArtifact[],
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
  policy: PrincipalPolicyRequestArtifact,
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
  policy: PrincipalPolicyRequestArtifact,
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
  policy: PrincipalPolicyRequestArtifact,
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
  policy: PrincipalPolicyRequestArtifact,
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
  readonly policies: readonly PrincipalPolicyRequestArtifact[];
}): Promise<ContainerMutationError> {
  const seenPrincipalPolicyKeys = new Set<string>();
  const policiesToFetch: PrincipalPolicyRequestArtifact[] = [];

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

  return mutationStateStale(input.message, {
    code: "principal_policy_stale",
    error: input.message,
    principalPolicies,
  });
}

export async function assertPrincipalPoliciesCurrent(
  executor: DatabaseTransaction,
  principalPolicies: readonly PrincipalPolicyRequestArtifact[],
  options: {
    readonly referencedPrincipalHeads?: readonly ReferencedPrincipalHead[];
  } = {},
): Promise<VerifiedPrincipalPolicy[]> {
  const artifacts = await loadPrincipalPolicyArtifacts(
    executor,
    principalPolicies,
  );
  const stalePolicies: PrincipalPolicyRequestArtifact[] = [];
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
      throw mutationStateStale("Principal policy is stale");
    }

    const stored = await getVerifiedPrincipalPolicyForStateWithExecutor(
      executor,
      currentState,
    );
    const { createdAt: _createdAt, ...storedSignedState } =
      stored.bundle.currentState;
    if (
      !canonicalJsonEquals(
        principalPolicyArtifactRecord(policy),
        principalPolicyArtifactRecord(stored.policy, storedSignedState),
      )
    ) {
      throw new ContainerMutationError(
        "Principal policy artifact does not match verified stored policy",
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
